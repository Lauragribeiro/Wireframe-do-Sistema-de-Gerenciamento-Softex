<<<<<<< HEAD
// src/generateDocs.js
import express from "express";
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

import { buildPayloadBase } from "./utils/docxPayload.js";
import { ensureFields, REQUIRED_MAPA, REQUIRED_FOLHA } from "./utils/templateGuards.js";
import { ensureOpenAIClient, hasOpenAIKey, invalidateOpenAIClient } from "./openaiProvider.js";
import { extrairCotacoesDeTexto, gerarObjetoEJustificativa } from "./gptMapa.js";
import { escapeXml, renderDocxBuffer } from "./utils/docxTemplate.js";

/** ===== OpenAI opcional (para extrair dados das cotações) ===== */
const hasOpenAI = hasOpenAIKey();

/* ========================= Utils ========================= */
const __dirnameLocal = path.resolve();

const TPL_FOLHA_DIR = path.join(__dirnameLocal, "src", "templates", "folha_rosto");
const TPL_MAPA_DIR  = path.join(__dirnameLocal, "src", "templates", "mapa");
const TPL_JUST_DIR  = path.join(__dirnameLocal, "src", "templates", "dispensa");

function normalizeInst(raw) {
  const s = String(raw || "").toLowerCase();
  return s.includes("vertex") ? "vertex" : "edge";
}
function isCustosIncorridos(rubrica) {
  const s = String(rubrica || "").toLowerCase();
  return s.includes("custo") && s.includes("incorr");
}
function pickFolhaTemplate(instituicao, rubrica) {
  const inst = normalizeInst(instituicao);
  if (isCustosIncorridos(rubrica)) return `custos_incorridos_${inst}.docx`;
  return `folha_rosto_${inst}.docx`;
}
function pickMapaTemplate(instituicao) {
  const inst = normalizeInst(instituicao);
  return `mapa_${inst}.docx`;
}
function fmtBRDate(isoOrDDMMYYYY) {
  if (!isoOrDDMMYYYY) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoOrDDMMYYYY)) return isoOrDDMMYYYY;
  const d = dayjs(isoOrDDMMYYYY);
  return d.isValid() ? d.format("DD/MM/YYYY") : String(isoOrDDMMYYYY);
}
function fmtBRL(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string" && v.trim().startsWith("R$")) return v;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseValorToNumber(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw)
    .replace(/[\sR$]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^0-9+\-\.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFilled(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  return normalized !== "não informado" && normalized !== "nao informado" && normalized !== "—" && normalized !== "-";
}

function normalizeProposal(entry = {}, idx = 0) {
  const rawSelecao = entry.selecao ?? entry.selection ?? entry.rotulo ?? entry.label ?? "";
  let selecao = String(rawSelecao || "").trim();
  if (!selecao) selecao = `Cotação ${idx + 1}`;
  if (/selecionad/i.test(selecao)) selecao = "SELECIONADA";

  const ofertante = String(
    entry.ofertante ?? entry.fornecedor ?? entry.nome ?? entry.razao_social ?? ""
  ).trim();

  const docRaw = String(
    entry.cnpj_ofertante ?? entry.cnpj ?? entry.cnpjCpf ?? entry.cnpj_cpf ?? entry.cpf ?? entry.documento ?? ""
  ).trim();

  const dataRaw = entry.data_cotacao ?? entry.dataCotacao ?? entry.data ?? entry.dataCotacaoBR ?? entry.dataCotacaoISO ?? "";
  const dataFmt = fmtBRDate(dataRaw || "");
  const dataValue = dataFmt || (typeof dataRaw === "string" ? dataRaw.trim() : "");

  const valorNum = parseValorToNumber(
    entry.valor_num ?? entry.valor ?? entry.valor_total ?? entry.total ?? entry.preco ?? entry.valorProposta
  );

  const valorCandidates = [
    entry.valor_formatado,
    entry.valor_label,
    entry.valorBR,
    entry.valor_exibicao,
    entry.valor,
    entry.total,
    entry.valor_total,
  ];

  let valorLabel = "";
  for (const candidate of valorCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      valorLabel = candidate.trim();
      break;
    }
  }
  if (!valorLabel && Number.isFinite(valorNum)) valorLabel = fmtBRL(valorNum);

  return {
    selecao,
    ofertante,
    cnpj: docRaw,
    cnpj_ofertante: docRaw,
    data: dataValue,
    data_cotacao: dataValue,
    valor: valorLabel,
    valor_num: Number.isFinite(valorNum) ? valorNum : null,
  };
}

function mergeProposalFields(base = {}, fallback = {}) {
  const out = { ...base };
  const src = fallback || {};

  if (!isFilled(out.selecao) && isFilled(src.selecao)) out.selecao = src.selecao;
  if (!isFilled(out.ofertante) && isFilled(src.ofertante)) out.ofertante = src.ofertante;

  if (!isFilled(out.cnpj_ofertante) && isFilled(src.cnpj_ofertante)) {
    out.cnpj_ofertante = src.cnpj_ofertante;
  }
  if (!isFilled(out.cnpj) && isFilled(src.cnpj)) {
    out.cnpj = src.cnpj;
  }
  if (!isFilled(out.cnpj) && isFilled(out.cnpj_ofertante)) out.cnpj = out.cnpj_ofertante;
  if (!isFilled(out.cnpj_ofertante) && isFilled(out.cnpj)) out.cnpj_ofertante = out.cnpj;

  if (!isFilled(out.data_cotacao) && isFilled(src.data_cotacao)) {
    out.data_cotacao = src.data_cotacao;
    out.data = src.data_cotacao;
  }
  if (!isFilled(out.data) && isFilled(out.data_cotacao)) out.data = out.data_cotacao;

  if (!isFilled(out.valor) && isFilled(src.valor)) out.valor = src.valor;

  if ((out.valor_num === null || out.valor_num === undefined) && Number.isFinite(src.valor_num)) {
    out.valor_num = src.valor_num;
  }

  return out;
}

function normalizeObjetoTexto(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (!text) return "";
  const normalized = text.replace(/\s+/g, " ").toLowerCase();
  if (normalized === "não informado" || normalized === "nao informado" || normalized === "—" || normalized === "-") {
    return "";
  }
  return text;
}

function avaliarPreenchimentoPropostas(list = []) {
  const rows = Array.isArray(list) ? list : [];
  const relevantes = rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    return (
      isFilled(row.ofertante) ||
      isFilled(row.cnpj) ||
      isFilled(row.cnpj_ofertante) ||
      isFilled(row.valor) ||
      Number.isFinite(row.valor_num) ||
      isFilled(row.data_cotacao) ||
      isFilled(row.data)
    );
  });

  const missing = {
    ofertante: [],
    cnpj: [],
    data: [],
    valor: [],
  };

  relevantes.forEach((row, idx) => {
    const label = `Cotação ${idx + 1}`;
    if (!isFilled(row.ofertante)) missing.ofertante.push(label);
    if (!isFilled(row.cnpj) && !isFilled(row.cnpj_ofertante)) missing.cnpj.push(label);
    const hasData = isFilled(row.data_cotacao) || isFilled(row.data);
    if (!hasData) missing.data.push(label);
    const hasValor = isFilled(row.valor) || Number.isFinite(row.valor_num);
    if (!hasValor) missing.valor.push(label);
  });

  const pendencias = [];
  if (!relevantes.length) {
    pendencias.push("Nenhuma proposta preenchida.");
  }
  if (missing.ofertante.length) pendencias.push(`Ofertante ausente em ${missing.ofertante.join(", ")}.`);
  if (missing.cnpj.length) pendencias.push(`CNPJ/CPF ausente em ${missing.cnpj.join(", ")}.`);
  if (missing.data.length) pendencias.push(`Data da cotação ausente em ${missing.data.join(", ")}.`);
  if (missing.valor.length) pendencias.push(`Valor ausente em ${missing.valor.join(", ")}.`);

  const completo = relevantes.length >= 3 && Object.values(missing).every((arr) => arr.length === 0);

  return {
    completo,
    pendencias,
    missing,
    count: relevantes.length,
  };
}

function encodeHeaderPayload(data) {
  try {
    const json = JSON.stringify(data);
    return Buffer.from(json, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return "";
  }
}

function uniqueCaseInsensitive(list = []) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function buildObjetoFallback(rubrica, proposals = [], cotacoesNomes = []) {
  const rubricaText = String(rubrica || "").trim();
  const fornecedores = uniqueCaseInsensitive(
    proposals.map((p) => (p?.ofertante || p?.fornecedor || "").toString().trim())
  ).slice(0, 3);
  const fornecedoresTxt = fornecedores.length
    ? `, com propostas apresentadas por ${fornecedores.join(", ")}`
    : "";

  if (rubricaText) {
    return `Aquisição de itens e/ou serviços vinculados à rubrica "${rubricaText}"${fornecedoresTxt}, conforme detalhamento das cotações anexas.`;
  }

  if (cotacoesNomes.length) {
    const lista = cotacoesNomes.slice(0, 3).join(", ");
    return `Aquisição com base nas cotações ${lista}${fornecedoresTxt}, seguindo as especificações apresentadas nos orçamentos.`;
  }

  return `Aquisição conforme as especificações técnicas das cotações anexas${fornecedoresTxt}.`;
}

function hasProposalData(p = {}) {
  return (
    isFilled(p.ofertante) ||
    isFilled(p.cnpj_ofertante) ||
    isFilled(p.cnpj) ||
    isFilled(p.data_cotacao) ||
    isFilled(p.valor)
  );
}

function ensureSelecionada(propostas = []) {
  let jaSelecionada = false;
  let menorIdx = -1;
  let menorValor = Number.POSITIVE_INFINITY;

  propostas.forEach((p, idx) => {
    if (/selecionad/i.test(String(p.selecao || ""))) {
      p.selecao = "SELECIONADA";
      jaSelecionada = true;
    }
    const valorNum = parseValorToNumber(p.valor_num ?? p.valor);
    if (Number.isFinite(valorNum) && valorNum < menorValor) {
      menorValor = valorNum;
      menorIdx = idx;
    }
  });

  if (!jaSelecionada && menorIdx >= 0 && propostas[menorIdx]) {
    propostas[menorIdx].selecao = "SELECIONADA";
  }

  propostas.forEach((p) => {
    if (Number.isFinite(p.valor_num) && (!p.valor || !p.valor.trim() || !p.valor.includes("R$"))) {
      p.valor = fmtBRL(p.valor_num);
    }
    if (p.cnpj_ofertante && !p.cnpj) p.cnpj = p.cnpj_ofertante;
    if (!p.cnpj_ofertante && p.cnpj) p.cnpj_ofertante = p.cnpj;
    if (!p.data_cotacao && p.data) p.data_cotacao = p.data;
    if (!p.data && p.data_cotacao) p.data = p.data_cotacao;
  });
}
function sanitizeFilename(name, fallback = "documento") {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}
function renderDocx(templatePath, dataObj, options = {}) {
  const buffer = fs.readFileSync(templatePath);
  return renderDocxBuffer(buffer, dataObj || {}, options);
}

const RUN_PREFIX = '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="4472C4" w:themeColor="accent5"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">';
const RUN_SUFFIX = '</w:t></w:r>';
const RUN_BREAK  = '<w:r><w:br/></w:r>';
const MONTH_NAMES_FULL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

function buildRuns(text) {
  const raw = text == null ? "" : String(text);
  if (!raw) return "";
  const parts = raw.split(/\r?\n/);
  return parts.map((part, index) => {
    const safe = escapeXml(part === "" ? " " : part);
    const run = `${RUN_PREFIX}${safe}${RUN_SUFFIX}`;
    return index < parts.length - 1 ? `${run}${RUN_BREAK}` : run;
  }).join("");
}

function setTableValue(xml, label, value, { fallback = "—" } = {}) {
  const marker = `>${label}</w:t>`;
  const idx = xml.indexOf(marker);
  if (idx === -1) return xml;
  const cellStart = xml.indexOf('<w:tc', idx + marker.length);
  if (cellStart === -1) return xml;
  const paraStart = xml.indexOf('<w:p', cellStart);
  const paraEnd = paraStart === -1 ? -1 : xml.indexOf('</w:p>', paraStart);
  if (paraStart === -1 || paraEnd === -1) return xml;
  const afterPPr = xml.indexOf('</w:pPr>', paraStart);
  if (afterPPr === -1 || afterPPr > paraEnd) return xml;
  const insertPos = afterPPr + '</w:pPr>'.length;
  const content = value == null || value === "" ? fallback : value;
  const runs = buildRuns(content);
  if (!runs) return xml;
  const prefix = xml.slice(0, insertPos);
  const suffix = xml.slice(paraEnd);
  return `${prefix}${runs}${suffix}`;
}

function setParagraphAfterHeading(xml, heading, value, { fallback = "—" } = {}) {
  const marker = `>${heading}</w:t>`;
  const headingIdx = xml.indexOf(marker);
  if (headingIdx === -1) return xml;
  const headingEnd = xml.indexOf('</w:p>', headingIdx);
  if (headingEnd === -1) return xml;
  const paraStart = xml.indexOf('<w:p', headingEnd);
  const paraEnd = paraStart === -1 ? -1 : xml.indexOf('</w:p>', paraStart);
  if (paraStart === -1 || paraEnd === -1) return xml;
  const afterPPr = xml.indexOf('</w:pPr>', paraStart);
  if (afterPPr === -1 || afterPPr > paraEnd) return xml;
  const insertPos = afterPPr + '</w:pPr>'.length;
  const content = value == null || value === "" ? fallback : value;
  const runs = buildRuns(content);
  if (!runs) return xml;
  const prefix = xml.slice(0, insertPos);
  const suffix = xml.slice(paraEnd);
  return `${prefix}${runs}${suffix}`;
}

function parseBrDateToIso(brDate = "") {
  const parts = String(brDate || "").split("/");
  if (parts.length !== 3) return "";
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return "";
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function buildDateExtenso(localidade = "", iso = "", dia = "", mes = "", ano = "") {
  const city = String(localidade || "").trim();
  const isoCandidate = iso || parseBrDateToIso(`${dia}/${mes}/${ano}`);
  if (isoCandidate) {
    const m = dayjs(isoCandidate);
    if (m.isValid()) {
      const prefix = city ? `${city}, ` : "";
      return `${prefix}${m.format('DD [de] MMMM [de] YYYY')}`;
    }
  }
  const dd = String(dia || "").padStart(2, "0");
  const mesNum = Number(mes) || 0;
  const monthName = MONTH_NAMES_FULL[mesNum - 1] || (mes ? String(mes) : "—");
  const year = ano || "—";
  const prefix = city ? `${city}, ` : "";
  const dayPart = dd.trim() ? dd : "—";
  return `${prefix}${dayPart} de ${monthName} de ${year}`;
}

/* ============== Helpers (únicas) para ler PDFs e extrair campos ============== */

// Lê texto de /data/uploads/<fileName>
async function readPdfTextFromUploads(fileName) {
  try {
    const raw = String(fileName || "").trim();
    if (!raw) return "";
    const clean = path.basename(raw.replace(/\\/g, "/"));
    if (!clean) return "";
    const full = path.join(__dirnameLocal, "data", "uploads", clean);
    if (!fs.existsSync(full)) return "";
    const buf = fs.readFileSync(full);
    const pdfParse = (await import("pdf-parse")).default; // import dinâmico (ESM-friendly)
    const data = await pdfParse(buf);
    return (data?.text || "").replace(/\u0000/g, " ").trim();
  } catch (e) {
    console.warn("[readPdfTextFromUploads] falhou:", e?.message || e);
    return "";
  }
}

// Heurísticas simples
function guessFromText(txt = "") {
  const t = String(txt || "");

  const rxCNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  const rxCPF  = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
  const cnpj   = (t.match(rxCNPJ) || [])[0] || "";
  const cpf    = !cnpj ? ((t.match(rxCPF) || [])[0] || "") : "";

  // primeira data DD/MM/AAAA plausível
  const rxDate = /\b([0-3]?\d)\/([01]?\d)\/(\d{4})\b/g;
  let data = "";
  for (const m of t.matchAll(rxDate)) {
    const dd = +m[1], mm = +m[2];
    if (dd>=1 && dd<=31 && mm>=1 && mm<=12) { data = m[0]; break; }
  }

  // maior valor BRL (R$ 1.234,56)
  const rxBRL = /R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
  let valor = "", max = -1;
  for (const m of t.matchAll(rxBRL)) {
    const raw = m[0].replace(/[^\d,]/g, "");
    const n = Number(raw.replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n) && n > max) { max = n; valor = m[0].trim().replace(/^R?\$?\s*/, "R$ "); }
  }

  // ofertante (linha próxima do CNPJ ou "Razão social:")
  let ofertante = "";
  const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const cnpjIdx = lines.findIndex(l => rxCNPJ.test(l));
  if (cnpjIdx > 0) {
    for (let i = Math.max(0, cnpjIdx - 3); i <= cnpjIdx + 1; i++) {
      const L = lines[i] || "";
      const m = L.match(/raz[aã]o social\s*[:\-–]\s*(.+)/i);
      if (m && m[1]) { ofertante = m[1].trim(); break; }
      // linha anterior em CAIXA ALTA costuma ser razão social
      if (!ofertante && /^[A-Z0-9 .,&\-\/]+$/.test(L) && L.length >= 5 && !rxCNPJ.test(L)) {
        ofertante = L.trim();
      }
    }
  }
  if (!ofertante) {
    const m = t.match(/raz[aã]o social\s*[:\-–]\s*([^\n\r]+)/i);
    if (m) ofertante = m[1].trim();
  }

  return {
    ofertante,
    cnpj_ofertante: cnpj || cpf || "",
    data_cotacao: data || "",
    valor: valor || ""
  };
}

// Nome do arquivo como pista do fornecedor
/* ==================== Router padrão ==================== */
const router = express.Router();

/** -------- Folha de Rosto -------- */
router.post("/folha-rosto", async (req, res) => {
  try {
    const payload = buildPayloadBase(req.body);
    ensureFields(payload, REQUIRED_FOLHA, "FOLHA ROSTO");

    const body = req.body || {};
    const meta = body.data || {};

    const instituicao   = payload.instituicao || meta.instituicao || body.instituicao || "EDGE";
    // ✅ Natureza do dispêndio deve vir EXATAMENTE de tipoRubrica
    const naturezaDisp  = (body?.tipoRubrica || "").toString().trim();

    const templateFile = pickFolhaTemplate(instituicao, naturezaDisp);
    const templatePath = path.join(TPL_FOLHA_DIR, templateFile);
    if (!fs.existsSync(templatePath)) {
      console.error("Template ausente:", templatePath);
      return res.status(404).json({ ok: false, error: `Template não encontrado: ${templateFile}` });
    }

    const docData = {
      instituicao:     String(instituicao).toUpperCase(),
      projeto_codigo:  payload.projeto,
      projeto_nome:    payload.projeto,
      pc_numero:       payload.prestacao_contas || "—",
      natureza_disp:   naturezaDisp,          // <- tag correta no DOCX
      rubrica:         naturezaDisp,          // (compat)
      favorecido:      payload.favorecido_nome || "—",
      cnpj:            payload.favorecido_doc || "—",
      n_extrato:       payload.extrato_num || "—",
      nf_recibo:       payload.nf_num || "—",
      data_emissao:    payload.nf_data_emissao_br || payload.nf_data_emissao || "—",
      data_pagamento:  payload.dt_pagamento_br || payload.dt_pagamento || "—",
      valor_pago:      payload.valor_total || "—",
    };

    const out = renderDocx(templatePath, docData);
    const hint = sanitizeFilename(body.filenameHint || `Folha_${docData.projeto_codigo}_${docData.pc_numero || ""}`, "folha_de_rosto");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${hint}.docx"`);
    return res.send(out);
  } catch (err) {
    console.error("[/api/generate/folha-rosto] erro", err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar a Folha de Rosto" });
  }
});

/** -------- Mapa de Cotação -------- */
router.post("/mapa-cotacao", async (req, res) => {
  try {
    const payload = buildPayloadBase(req.body);
    ensureFields(payload, REQUIRED_MAPA, "MAPA COTAÇÃO");

    const body = req.body || {};
    const meta = body.data || {};

    const instituicao     = payload.instituicao || meta.instituicao || body.instituicao || "EDGE";
    const projetoNome     = payload.projeto || meta.projeto || body.projeto || "";
    const projetoCodigo   = meta.codigo || body.codigo || body.projeto_codigo || "";
    const termoParceria   = payload.termo_parceria || body.termoParceria || meta.termoParceria || "";
    const cnpjInstituicao = body.cnpjInstituicao || meta.cnpjInstituicao || payload.cnpj_instituicao || "";

    // ✅ usar EXATAMENTE tipoRubrica
    const tipoRubrica     = (body?.tipoRubrica || "").toString().trim();

    let objetoDesc        = normalizeObjetoTexto(body.objetoDescricao || payload.objeto || "");
    const justBase        = body.justificativa || meta.justificativa || payload.justificativa || "";
    const dataPagamento   = fmtBRDate(body.dataPagamento || meta.dataPagamento || payload.dt_pagamento || "");
    const coordenadorNome = body.coordenadorNome || meta.coordenadorNome || "";

    // ==================== propostas e objeto ====================
    const openaiClient = hasOpenAI ? ensureOpenAIClient() : null;
    const cotacoesMap = new Map();

    const pushCotacao = ({ name, text, filePath }) => {
      const cleanName = String(name || "").trim() || `cotacao_${cotacoesMap.size + 1}`;
      const key = cleanName.toLowerCase();
      const entry = cotacoesMap.get(key);
      if (entry) {
        if (!entry.text && text) entry.text = text;
        if (!entry.path && filePath) entry.path = filePath;
      } else {
        cotacoesMap.set(key, {
          name: cleanName,
          text: String(text || ""),
          path: filePath && fs.existsSync(filePath) ? filePath : null,
        });
      }
    };

    const resolveCotacaoFilePath = (rawEntry) => {
      const candidates = [];
      const pushCandidate = (value) => {
        const clean = String(value || "").trim();
        if (!clean) return;
        candidates.push(clean);
      };

      if (rawEntry && typeof rawEntry === "object") {
        if (rawEntry.path && fs.existsSync(rawEntry.path)) {
          return rawEntry.path;
        }
        pushCandidate(rawEntry.filename || rawEntry.fileName || rawEntry.key);
        pushCandidate(rawEntry.url || rawEntry.link || rawEntry.href);
        pushCandidate(rawEntry.name || rawEntry.originalname);
      } else if (typeof rawEntry === "string") {
        pushCandidate(rawEntry);
      }

      for (const candidate of candidates) {
        try {
          const cleaned = String(candidate)
            .replace(/^https?:\/\/[^/]+\//i, "")
            .replace(/^uploads\//i, "")
            .replace(/^\/+/, "")
            .replace(/\?.*$/, "")
            .split(/[\\/]/)
            .filter(Boolean)
            .pop();
          if (!cleaned) continue;
          const guess = path.join(__dirnameLocal, "data", "uploads", cleaned);
          if (fs.existsSync(guess)) return guess;
        } catch (e) {
          console.warn("[mapa] resolveCotacaoFilePath falhou:", e?.message || e);
        }
      }

      return null;
    };

    if (Array.isArray(body?.docs?.cotacoes)) {
      body.docs.cotacoes.forEach((c, idx) => {
        const name = c?.name || c?.filename || c?.fileName || c?.originalname || `cotacao_${idx + 1}`;
        const text = String(c?.text || "");
        const filePath = resolveCotacaoFilePath(c);
        pushCotacao({ name, text, filePath });
      });
    }

    if (Array.isArray(body.cotacoes) && body.cotacoes.length) {
      const names = body.cotacoes.map((c, idx) => String(c || `cotacao_${idx + 1}`));
      const texts = await Promise.all(names.map((name) => readPdfTextFromUploads(name).catch(() => "")));
      names.forEach((name, idx) => {
        const filePath = resolveCotacaoFilePath(name);
        pushCotacao({ name, text: texts[idx] || "", filePath });
      });
    }

    const cotacoesEntries = Array.from(cotacoesMap.values());
    const cotacoesNomes = cotacoesEntries.map((entry, idx) => entry.name || `Cotação ${idx + 1}`);
    const sections = cotacoesEntries.map((entry, idx) => {
      const header = `### COTAÇÃO ${idx + 1} (${entry.name})`;
      const textSec = String(entry.text || "").trim();
      if (!textSec) {
        return `${header}\n[Sem texto OCR disponível — utilize o arquivo anexado.]`;
      }
      return `${header}\n${textSec.slice(0, 20000)}`;
    });

    const listaCotacoesTexto = sections.join("\n\n");

    const cotacoesArquivos = cotacoesEntries
      .map((entry, idx) =>
        entry.path
          ? {
              index: idx,
              name: entry.name,
              path: entry.path,
            }
          : null
      )
      .filter(Boolean);

    const hasArquivosCotacoes = cotacoesArquivos.length > 0;

    const cotacoesResumo = hasArquivosCotacoes
      ? cotacoesEntries
          .map((entry, idx) => {
            const parts = [`Cotação ${idx + 1}: ${entry.name}`];
            if (entry.path) parts.push("[arquivo anexado]");
            if (!String(entry.text || "").trim()) parts.push("[sem OCR]");
            return parts.join(" ");
          })
          .join("\n")
      : "";

    const propostasManuais = Array.isArray(body.propostas) ? body.propostas : [];
    let propostas = propostasManuais.map((p, idx) => normalizeProposal(p, idx)).filter(hasProposalData);

    const avisosCotacao = Array.isArray(body.cotacoesAvisos) ? [...body.cotacoesAvisos] : [];
    let cotacoesIAStatus = { tentativas: [], completo: false, pendencias: [] };

    if (!objetoDesc) {
      objetoDesc = normalizeObjetoTexto(body.objeto || meta.objeto || payload.objeto || "");
    }

    const hasTextoCotacoes = typeof listaCotacoesTexto === "string" && listaCotacoesTexto.trim().length > 0;

    if (openaiClient && (hasTextoCotacoes || hasArquivosCotacoes)) {
      try {
        const analise = await extrairCotacoesDeTexto({
          instituicao,
          codigo_projeto: projetoCodigo || payload.projeto || "",
          rubrica: tipoRubrica || "",
          lista_cotacoes_texto: listaCotacoesTexto,
          cotacoes_anexos: cotacoesResumo,
          cotacoes_arquivos: cotacoesArquivos,
        }, { maxAttempts: 3 });

        if (Array.isArray(analise?.avisos)) avisosCotacao.push(...analise.avisos);
        if (Array.isArray(analise?.pendencias)) avisosCotacao.push(...analise.pendencias);

        cotacoesIAStatus = {
          tentativas: Array.isArray(analise?.tentativas) ? analise.tentativas : [],
          completo: !!analise?.completo,
          pendencias: Array.isArray(analise?.pendencias) ? analise.pendencias : [],
        };

        if (!objetoDesc && analise?.objeto_rascunho) {
          objetoDesc = normalizeObjetoTexto(analise.objeto_rascunho);
        }

        const propostasIA = Array.isArray(analise?.propostas)
          ? analise.propostas.map((p, idx) => normalizeProposal({
              ...p,
              cnpj: p?.cnpj ?? p?.cnpj_cpf ?? p?.cnpj_ofertante ?? "",
              cnpj_ofertante: p?.cnpj ?? p?.cnpj_cpf ?? p?.cnpj_ofertante ?? "",
              data_cotacao: p?.data_cotacao ?? p?.dataCotacao ?? "",
              valor: typeof p?.valor === "number" ? fmtBRL(p.valor) : p?.valor,
              valor_num: typeof p?.valor === "number" ? p.valor : parseValorToNumber(p?.valor),
            }, idx)).filter(hasProposalData)
          : [];

        if (!propostas.length) {
          propostas = propostasIA;
        } else if (propostasIA.length) {
          const merged = [];
          const total = Math.max(propostas.length, propostasIA.length);
          for (let i = 0; i < total; i++) {
            const base = propostas[i];
            const fallback = propostasIA[i];
            if (base && fallback) {
              merged.push(mergeProposalFields(base, fallback));
            } else if (base) {
              merged.push(base);
            } else if (fallback) {
              merged.push(fallback);
            }
          }
          propostas = merged.filter(hasProposalData);
        }
      } catch (err) {
        console.warn("[mapa] extrairCotacoesDeTexto falhou:", err?.message || err);
      }
    }

    if (!propostas.length && cotacoesEntries.length) {
      propostas = cotacoesEntries
        .map((entry, idx) => {
          const guess = guessFromText(entry.text);
          return normalizeProposal({ selecao: `Cotação ${idx + 1}`, ...guess }, idx);
        })
        .filter(hasProposalData);
    }

    if (!propostas.length && cotacoesEntries.length) {
      propostas = cotacoesEntries.map((_, idx) => normalizeProposal({}, idx));
    }

    ensureSelecionada(propostas);

    const MIN_ROWS = 3;
    while (propostas.length < MIN_ROWS) {
      propostas.push(normalizeProposal({}, propostas.length));
    }

    const propostasForTemplate = propostas.map((p, idx) => ({
      selecao: p.selecao || `Cotação ${idx + 1}`,
      ofertante: p.ofertante || "",
      cnpj: p.cnpj || p.cnpj_ofertante || "",
      cnpj_ofertante: p.cnpj_ofertante || p.cnpj || "",
      data: p.data_cotacao || p.data || "",
      data_cotacao: p.data_cotacao || p.data || "",
      valor: p.valor || "",
    }));

    const propostasParaLLM = propostas
      .filter(hasProposalData)
      .map((p) => ({
        selecao: p.selecao,
        ofertante: p.ofertante,
        cnpj: p.cnpj || p.cnpj_ofertante || "",
        dataCotacao: p.data_cotacao || "",
        valor: p.valor || (Number.isFinite(p.valor_num) ? fmtBRL(p.valor_num) : ""),
      }));

    // ==================== textos finais ====================
    const fallbackComplemento = "Seleção pautada pela melhor proposta e pelo custo-benefício, considerando conformidade técnica, prazos e valor.";
    let justificativaFinal = String(justBase || "").trim();
    let objetoFinal = String(objetoDesc || "").trim();
    const localidade = body.localidade || meta.localidade || "Maceió";

    if (openaiClient && propostasParaLLM.length) {
      try {
        const { objeto, justificativa: justAI } = await gerarObjetoEJustificativa({
          instituicao,
          projeto: projetoNome || "",
          codigo_projeto: projetoCodigo || "",
          rubrica: tipoRubrica || "",
          justificativa_base: justificativaFinal,
          json_propostas: JSON.stringify(propostasParaLLM, null, 2),
          data_pagamento: dataPagamento || "",
          localidade,
        });
        if (objeto) objetoFinal = normalizeObjetoTexto(objeto);
        if (justAI) justificativaFinal = justAI;
      } catch (err) {
        console.warn("[mapa] gerarObjetoEJustificativa falhou:", err?.message || err);
      }
    }

    if (!objetoFinal) objetoFinal = normalizeObjetoTexto(objetoDesc || "");
    if (!objetoFinal) {
      objetoFinal = buildObjetoFallback(tipoRubrica, propostasForTemplate, cotacoesNomes);
    }

    if (!justificativaFinal) {
      justificativaFinal = fallbackComplemento;
    } else if (!justificativaFinal.toLowerCase().includes("custo-benef")) {
      const trimmed = justificativaFinal.trim().replace(/\s+/g, " " );
      justificativaFinal = trimmed.replace(/([^.?!])$/, "$1.");
      justificativaFinal += ` ${fallbackComplemento}`;
    }

    // ==================== rodapé ====================
    const hoje = dayjs();
    const localData = `${localidade}, ${hoje.format("DD")} de ${hoje.format("MMMM")} de ${hoje.format("YYYY")}`;
    // ==================== renderização ====================
    const templateFile = pickMapaTemplate(instituicao);
    const templatePath = path.join(TPL_MAPA_DIR, templateFile);
    if (!fs.existsSync(templatePath)) {
      console.error("Template ausente:", templatePath);
      return res.status(404).json({ ok: false, error: `Template não encontrado: ${templateFile}` });
    }

    const docData = {
      // cabeçalho
      instituicao:      String(instituicao).toUpperCase(),
      cnpj_inst:        cnpjInstituicao || "—",
      termo_parceria:   termoParceria || "—",
      projeto_nome:     projetoNome || "—",
      projeto_codigo:   projetoCodigo || "—",

      // corpo
      natureza_disp:    tipoRubrica || "—",   // ✅ usa EXATAMENTE tipoRubrica
      objeto:           objetoFinal || "—",
      propostas:        propostasForTemplate,

      // rodapé
      data_aquisicao:   dataPagamento || "—",
      justificativa:    justificativaFinal || "—",
      local_data:       localData,
      coordenador_nome: coordenadorNome || "—",
    };

    const preenchimentoFinal = avaliarPreenchimentoPropostas(propostasForTemplate);
    if (preenchimentoFinal.pendencias.length) {
      avisosCotacao.push(...preenchimentoFinal.pendencias);
    }
    const avisosResumo = Array.from(
      new Set(avisosCotacao.map((item) => String(item || "").trim()).filter(Boolean))
    );
    const headerPayload = {
      ia: cotacoesIAStatus,
      final: preenchimentoFinal,
      avisos: avisosResumo,
    };
    const headerValue = encodeHeaderPayload(headerPayload);

    const out = renderDocx(templatePath, docData);
    const hint = sanitizeFilename(body.filenameHint || `MapaCotacao_${projetoCodigo}`, "mapa_cotacao");

    res.setHeader("X-Mapa-Status", preenchimentoFinal.completo ? "complete" : "incomplete");
    if (headerValue) {
      res.setHeader("X-Mapa-Detalhes", headerValue);
    }
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${hint}.docx"`);
    return res.send(out);
  } catch (err) {
    console.error("[/api/generate/mapa-cotacao] erro", err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar o Mapa de Cotação" });
  }
});

/** -------- Justificativa para Dispensa -------- */
router.post("/justificativa-dispensa", async (req, res) => {
  try {
    const body = req.body || {};
    const proj = body.proj || {};
    const processo = body.processo || {};

    const instituicao = (body.instituicao || proj.instituicao || "EDGE").toString();
    const cnpjInstituicao = (body.cnpjInstituicao || proj.cnpj || "").toString();
    const termoParceria = (body.termo || proj.termoParceria || "").toString();
    const projetoNome = (body.projeto || proj.projetoNome || "").toString();
    const projetoCodigo = (body.codigoProjeto || proj.projetoCodigo || "").toString();
    const rubrica = (body.tipoRubrica || body.rubrica || processo.naturezaDisp || "").toString();
    const objeto = (body.objeto || processo.objeto || "").toString();
    const justificativa = (body.justificativa || processo.justificativa || "").toString();
    const favorecido = (body.favorecido || processo.favorecidoNome || "").toString();
    const cnpjFav = (body.cnpjFav || processo.favorecidoDoc || "").toString();
    const valorContrato = fmtBRL(body.valor || processo.valor || "");

    const pagamentoIso = processo.dataPagamentoISO || body.dataPagamentoISO || parseBrDateToIso(body.dataPagamento || "");
    const dataPagamento = fmtBRDate(pagamentoIso || body.dataPagamento || "");
    const localidade = (body.localidade || body.extras?.cidade || "Maceió").toString();
    const dia = body.dia || "";
    const mes = body.mes || "";
    const ano = body.ano || "";
    const coordenador = (body.coordenador || proj.coordenador || "").toString();
    const dataExtenso = buildDateExtenso(localidade, pagamentoIso, dia, mes, ano);

    const templatePath = path.join(TPL_JUST_DIR, "justificativa_dispensa.docx");
    if (!fs.existsSync(templatePath)) {
      console.error("Template ausente:", templatePath);
      return res.status(404).json({ ok: false, error: "Template não encontrado: justificativa_dispensa.docx" });
    }

    const zip = new PizZip(fs.readFileSync(templatePath));
    const docXmlPath = "word/document.xml";
    const fileEntry = zip.file(docXmlPath);
    if (!fileEntry) {
      return res.status(500).json({ ok: false, error: "Template de justificativa inválido." });
    }

    let xml = fileEntry.asText();

    const projetoDisplay = projetoCodigo
      ? `${projetoNome || "Projeto"} (${projetoCodigo})`
      : (projetoNome || projetoCodigo || "—");

    xml = setTableValue(xml, "Instituição Executora:", instituicao || "—");
    xml = setTableValue(xml, "CNPJ:", cnpjInstituicao || "—");
    xml = setTableValue(xml, "Termo de Parceria nº:", termoParceria || "—");
    xml = setTableValue(xml, "Projeto:", projetoDisplay || "—");
    xml = setTableValue(xml, "Natureza de Dispêndio:", rubrica || "—");
    xml = setParagraphAfterHeading(xml, "Objeto da cotação", objeto || "—");
    xml = setTableValue(xml, "Fornecedor Contratado:", favorecido || "—");
    xml = setTableValue(xml, "CNPJ do Contratado:", cnpjFav || "—");
    xml = setTableValue(xml, "Valor Contratado:", valorContrato || "—");
    xml = setTableValue(xml, "Data da Aquisição:", dataPagamento || "—");
    xml = setParagraphAfterHeading(xml, "Justificativa da dispensa da cotação", justificativa || "—");

    xml = xml.replace(
      "__________, ____ de ___________ de _______",
      escapeXml(dataExtenso || `${localidade}, — de — de —`)
    );

    const assinaturaMsg = coordenador
      ? `Assinado eletronicamente por ${coordenador}.`
      : "Assinado eletronicamente.";
    xml = setParagraphAfterHeading(xml, "Assinatura e nome do Coordenador", assinaturaMsg, { fallback: assinaturaMsg });
    xml = xml.replace("{assinatura eletrônica com certificado digital ICP}", "");

    zip.file(docXmlPath, xml);

    const out = zip.generate({ type: "nodebuffer" });
    const hintBase = body.filenameHint || `Justificativa_${projetoCodigo || projetoNome || "dispensa"}`;
    const filename = sanitizeFilename(hintBase, "justificativa_dispensa");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.docx"`);
    return res.send(out);
  } catch (err) {
    console.error("[/api/generate/justificativa-dispensa] erro", err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar a Justificativa para Dispensa" });
  }
});

export default router;

/* ==================== (Opcional) registro direto no app ==================== */
export function registerDocRoutes(app, { /* openai não usado aqui */ TEMPLATE_BASE /* não usado aqui */ } = {}) {
  // Monta o router diretamente sob /api/generate para que as rotas internas
  // (definidas como "/folha-rosto", "/mapa-cotacao" etc.) sejam resolvidas
  // corretamente pelo Express. Usar router.handle com o caminho completo
  // fazia com que o prefixo "/api/generate" continuasse presente em req.url,
  // resultando em 404.
  app.use("/api/generate", router);
}
=======
⼯猠捲术湥牥瑡䑥捯⹳獪椊灭牯⁴硥牰獥⁳牦浯∠硥牰獥≳਻浩潰瑲映⁳牦浯∠獦㬢椊灭牯⁴慰桴映潲⁭瀢瑡≨਻浩潰瑲䐠捯瑸浥汰瑡牥映潲⁭搢捯瑸浥汰瑡牥㬢椊灭牯⁴楐婺灩映潲⁭瀢穩楺≰਻浩潰瑲搠祡獪映潲⁭搢祡獪㬢椊灭牯⁴搢祡獪氯捯污⽥瑰戭⹲獪㬢搊祡獪氮捯污⡥瀢⵴牢⤢਻椊灭牯⁴⁻畢汩偤祡潬摡慂敳素映潲⁭⸢甯楴獬搯捯偸祡潬摡樮≳਻浩潰瑲笠攠獮牵䙥敩摬ⱳ删充䥕䕒彄䅍䅐‬䕒啑剉䑅䙟䱏䅈素映潲⁭⸢甯楴獬琯浥汰瑡䝥慵摲⹳獪㬢椊灭牯⁴⁻湥畳敲灏湥䥁汃敩瑮‬慨佳数䅮䭉祥‬湩慶楬慤整灏湥䥁汃敩瑮素映潲⁭⸢漯数慮偩潲楶敤⹲獪㬢椊灭牯⁴⁻硥牴楡䍲瑯捡敯䑳呥硥潴‬敧慲佲橢瑥䕯畊瑳晩捩瑡癩⁡⁽牦浯∠⼮灧䵴灡⹡獪㬢ਊ⨯‪㴽㴽‽灏湥䥁漠捰潩慮⁬瀨牡⁡硥牴楡⁲慤潤⁳慤⁳潣慴ꟃ뗃獥 㴽㴽‽⼪挊湯瑳栠獡灏湥䥁㴠栠獡灏湥䥁敋⡹㬩ਊ⨯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽唠楴獬㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽⨠ਯ潣獮⁴彟楤湲浡䱥捯污㴠瀠瑡⹨敲潳癬⡥㬩ਊ潣獮⁴偔彌但䡌彁䥄⁒‽慰桴樮楯⡮彟楤湲浡䱥捯污‬猢捲Ⱒ∠整灭慬整≳‬昢汯慨牟獯潴⤢਻潣獮⁴偔彌䅍䅐䑟剉†‽慰桴樮楯⡮彟楤湲浡䱥捯污‬猢捲Ⱒ∠整灭慬整≳‬洢灡≡㬩挊湯瑳吠䱐䩟单彔䥄⁒㴠瀠瑡⹨潪湩弨摟物慮敭潌慣ⱬ∠牳≣‬琢浥汰瑡獥Ⱒ∠楤灳湥慳⤢਻昊湵瑣潩⁮潮浲污穩䥥獮⡴慲⥷笠 挠湯瑳猠㴠匠牴湩⡧慲⁷籼∠⤢琮䱯睯牥慃敳⤨਻†敲畴湲猠椮据畬敤⡳瘢牥整≸ ‿瘢牥整≸㨠∠摥敧㬢紊昊湵瑣潩⁮獩畃瑳獯湉潣牲摩獯爨扵楲慣 ੻†潣獮⁴⁳‽瑓楲杮爨扵楲慣簠⁼∢⸩潴潌敷䍲獡⡥㬩 爠瑥牵⁮⹳湩汣摵獥∨畣瑳≯ ☦猠椮据畬敤⡳椢据牯≲㬩紊昊湵瑣潩⁮楰正潆桬呡浥汰瑡⡥湩瑳瑩極慣Ɐ爠扵楲慣 ੻†潣獮⁴湩瑳㴠渠牯慭楬敺湉瑳椨獮楴畴捩潡㬩 椠⁦椨䍳獵潴䥳据牯楲潤⡳畲牢捩⥡ 敲畴湲怠畣瑳獯楟据牯楲潤彳笤湩瑳⹽潤硣㭠 爠瑥牵⁮晠汯慨牟獯潴⑟楻獮絴搮捯恸਻੽畦据楴湯瀠捩䵫灡呡浥汰瑡⡥湩瑳瑩極慣⥯笠 挠湯瑳椠獮⁴‽潮浲污穩䥥獮⡴湩瑳瑩極慣⥯਻†敲畴湲怠慭慰⑟楻獮絴搮捯恸਻੽畦据楴湯映瑭剂慄整椨潳牏䑄䵍奙奙 ੻†晩⠠椡潳牏䑄䵍奙奙 敲畴湲∠㬢 椠⁦⼨属筤紲⽜摜㉻屽尯筤紴⼤琮獥⡴獩佯䑲䵄奍奙⥙ 敲畴湲椠潳牏䑄䵍奙奙਻†潣獮⁴⁤‽慤橹⡳獩佯䑲䵄奍奙⥙਻†敲畴湲搠椮噳污摩⤨㼠搠昮牯慭⡴䐢⽄䵍夯奙≙ ›瑓楲杮椨潳牏䑄䵍奙奙㬩紊昊湵瑣潩⁮浦䉴䱒瘨 ੻†晩⠠⁶㴽‽畮汬簠⁼⁶㴽‽湵敤楦敮⁤籼瘠㴠㴽∠⤢爠瑥牵⁮∢਻†晩⠠祴数景瘠㴠㴽∠瑳楲杮•☦瘠琮楲⡭⸩瑳牡獴楗桴∨⑒⤢ 敲畴湲瘠਻†潣獮⁴⁮‽祴数景瘠㴠㴽∠畮扭牥•‿⁶›畎扭牥匨牴湩⡧⥶爮灥慬散⼨⹜术‬∢⸩敲汰捡⡥ⰢⰢ∠∮⤩਻†晩⠠畎扭牥椮乳乡渨⤩爠瑥牵⁮瑓楲杮瘨㬩 爠瑥牵⁮⹮潴潌慣敬瑓楲杮∨瑰䈭≒‬⁻瑳汹㩥∠畣牲湥祣Ⱒ挠牵敲据㩹∠剂≌素㬩紊ਊ畦据楴湯瀠牡敳慖潬呲乯浵敢⡲慲⥷笠 椠⁦爨睡㴠㴽渠汵⁬籼爠睡㴠㴽甠摮晥湩摥簠⁼慲⁷㴽‽∢ 敲畴湲渠汵㭬 椠⁦琨灹潥⁦慲⁷㴽‽渢浵敢≲ 敲畴湲丠浵敢⹲獩楆楮整爨睡 ‿慲⁷›畮汬਻†潣獮⁴汣慥敮⁤‽瑓楲杮爨睡਩††爮灥慬散⼨屛剳崤术‬∢਩††爮灥慬散⼨⹜㼨尽筤紳㼨尺籄⤤⼩Ⱨ∠⤢ †⸠敲汰捡⡥ⰢⰢ∠∮਩††爮灥慬散⼨幛ⴰ⬹ⵜ⹜⽝Ⱨ∠⤢਻†晩⠠挡敬湡摥 敲畴湲渠汵㭬 挠湯瑳瀠牡敳⁤‽畎扭牥挨敬湡摥㬩 爠瑥牵⁮畎扭牥椮䙳湩瑩⡥慰獲摥 ‿慰獲摥㨠渠汵㭬紊ਊ畦据楴湯椠䙳汩敬⡤慶畬⥥笠 椠⁦瘨污敵㴠㴽渠汵⁬籼瘠污敵㴠㴽甠摮晥湩摥 敲畴湲映污敳਻†潣獮⁴整瑸㴠匠牴湩⡧慶畬⥥琮楲⡭㬩 椠⁦ℨ整瑸 敲畴湲映污敳਻†潣獮⁴潮浲污穩摥㴠琠硥⹴敲汰捡⡥尯⭳术‬•⤢琮䱯睯牥慃敳⤨਻†敲畴湲渠牯慭楬敺⁤㴡‽渢ꏃ⁯湩潦浲摡≯☠…潮浲污穩摥℠㴽∠慮⁯湩潦浲摡≯☠…潮浲污穩摥℠㴽∠胢⊔☠…潮浲污穩摥℠㴽∠∭਻੽昊湵瑣潩⁮潮浲污穩健潲潰慳⡬湥牴⁹‽絻‬摩⁸‽⤰笠 挠湯瑳爠睡敓敬慣⁯‽湥牴⹹敳敬慣⁯㼿攠瑮祲献汥捥楴湯㼠‿湥牴⹹潲畴潬㼠‿湥牴⹹慬敢⁬㼿∠㬢 氠瑥猠汥捥潡㴠匠牴湩⡧慲卷汥捥潡簠⁼∢⸩牴浩⤨਻†晩⠠猡汥捥潡 敳敬慣⁯‽䍠瑯썡쎧澣␠楻硤⬠ㄠ恽਻†晩⠠猯汥捥潩慮⽤⹩整瑳猨汥捥潡⤩猠汥捥潡㴠∠䕓䕌䥃乏䑁≁਻ 挠湯瑳漠敦瑲湡整㴠匠牴湩⡧ †攠瑮祲漮敦瑲湡整㼠‿湥牴⹹潦湲捥摥牯㼠‿湥牴⹹潮敭㼠‿湥牴⹹慲慺彯潳楣污㼠‿∢ ⤠琮楲⡭㬩ਊ†潣獮⁴潤剣睡㴠匠牴湩⡧ †攠瑮祲挮灮彪景牥慴瑮⁥㼿攠瑮祲挮灮⁪㼿攠瑮祲挮灮䍪晰㼠‿湥牴⹹湣橰损晰㼠‿湥牴⹹灣⁦㼿攠瑮祲搮捯浵湥潴㼠‿∢ ⤠琮楲⡭㬩ਊ†潣獮⁴慤慴慒⁷‽湥牴⹹慤慴损瑯捡潡㼠‿湥牴⹹慤慴潃慴慣⁯㼿攠瑮祲搮瑡⁡㼿攠瑮祲搮瑡䍡瑯捡潡剂㼠‿湥牴⹹慤慴潃慴慣䥯体㼠‿∢਻†潣獮⁴慤慴浆⁴‽浦䉴䑒瑡⡥慤慴慒⁷籼∠⤢਻†潣獮⁴慤慴慖畬⁥‽慤慴浆⁴籼⠠祴数景搠瑡剡睡㴠㴽∠瑳楲杮•‿慤慴慒⹷牴浩⤨㨠∠⤢਻ 挠湯瑳瘠污牯畎⁭‽慰獲噥污牯潔畎扭牥ਨ††湥牴⹹慶潬彲畮⁭㼿攠瑮祲瘮污牯㼠‿湥牴⹹慶潬彲潴慴⁬㼿攠瑮祲琮瑯污㼠‿湥牴⹹牰捥⁯㼿攠瑮祲瘮污牯牐灯獯慴 ⤠਻ 挠湯瑳瘠污牯慃摮摩瑡獥㴠嬠 †攠瑮祲瘮污牯晟牯慭慴潤ਬ††湥牴⹹慶潬彲慬敢ⱬ †攠瑮祲瘮污牯剂ਬ††湥牴⹹慶潬彲硥扩捩潡ਬ††湥牴⹹慶潬Ⱳ †攠瑮祲琮瑯污ਬ††湥牴⹹慶潬彲潴慴ⱬ 崠਻ 氠瑥瘠污牯慌敢⁬‽∢਻†潦⁲挨湯瑳挠湡楤慤整漠⁦慶潬䍲湡楤慤整⥳笠 †椠⁦琨灹潥⁦慣摮摩瑡⁥㴽‽猢牴湩≧☠…慣摮摩瑡⹥牴浩⤨ ੻†††慶潬䱲扡汥㴠挠湡楤慤整琮楲⡭㬩 ††戠敲歡਻††੽†੽†晩⠠瘡污牯慌敢⁬☦丠浵敢⹲獩楆楮整瘨污牯畎⥭ 慶潬䱲扡汥㴠映瑭剂⡌慶潬乲浵㬩ਊ†敲畴湲笠 †猠汥捥潡ਬ††景牥慴瑮ⱥ †挠灮㩪搠捯慒ⱷ †挠灮彪景牥慴瑮㩥搠捯慒ⱷ †搠瑡㩡搠瑡噡污敵ਬ††慤慴损瑯捡潡›慤慴慖畬ⱥ †瘠污牯›慶潬䱲扡汥ਬ††慶潬彲畮㩭丠浵敢⹲獩楆楮整瘨污牯畎⥭㼠瘠污牯畎⁭›畮汬ਬ†㭽紊ਊ畦据楴湯洠牥敧牐灯獯污楆汥獤戨獡⁥‽絻‬慦汬慢正㴠笠⥽笠 挠湯瑳漠瑵㴠笠⸠⸮慢敳素਻†潣獮⁴牳⁣‽慦汬慢正簠⁼絻਻ 椠⁦ℨ獩楆汬摥漨瑵献汥捥潡 ☦椠䙳汩敬⡤牳⹣敳敬慣⥯ 畯⹴敳敬慣⁯‽牳⹣敳敬慣㭯 椠⁦ℨ獩楆汬摥漨瑵漮敦瑲湡整 ☦椠䙳汩敬⡤牳⹣景牥慴瑮⥥ 畯⹴景牥慴瑮⁥‽牳⹣景牥慴瑮㭥ਊ†晩⠠椡䙳汩敬⡤畯⹴湣橰潟敦瑲湡整 ☦椠䙳汩敬⡤牳⹣湣橰潟敦瑲湡整⤩笠 †漠瑵挮灮彪景牥慴瑮⁥‽牳⹣湣橰潟敦瑲湡整਻†੽†晩⠠椡䙳汩敬⡤畯⹴湣橰 ☦椠䙳汩敬⡤牳⹣湣橰⤩笠 †漠瑵挮灮⁪‽牳⹣湣橰਻†੽†晩⠠椡䙳汩敬⡤畯⹴湣橰 ☦椠䙳汩敬⡤畯⹴湣橰潟敦瑲湡整⤩漠瑵挮灮⁪‽畯⹴湣橰潟敦瑲湡整਻†晩⠠椡䙳汩敬⡤畯⹴湣橰潟敦瑲湡整 ☦椠䙳汩敬⡤畯⹴湣橰⤩漠瑵挮灮彪景牥慴瑮⁥‽畯⹴湣橰਻ 椠⁦ℨ獩楆汬摥漨瑵搮瑡彡潣慴慣⥯☠…獩楆汬摥猨捲搮瑡彡潣慴慣⥯ ੻††畯⹴慤慴损瑯捡潡㴠猠捲搮瑡彡潣慴慣㭯 †漠瑵搮瑡⁡‽牳⹣慤慴损瑯捡潡਻†੽†晩⠠椡䙳汩敬⡤畯⹴慤慴 ☦椠䙳汩敬⡤畯⹴慤慴损瑯捡潡⤩漠瑵搮瑡⁡‽畯⹴慤慴损瑯捡潡਻ 椠⁦ℨ獩楆汬摥漨瑵瘮污牯 ☦椠䙳汩敬⡤牳⹣慶潬⥲ 畯⹴慶潬⁲‽牳⹣慶潬㭲ਊ†晩⠠漨瑵瘮污牯湟浵㴠㴽渠汵⁬籼漠瑵瘮污牯湟浵㴠㴽甠摮晥湩摥 ☦丠浵敢⹲獩楆楮整猨捲瘮污牯湟浵⤩笠 †漠瑵瘮污牯湟浵㴠猠捲瘮污牯湟浵਻†੽ 爠瑥牵⁮畯㭴紊ਊ畦据楴湯渠牯慭楬敺扏敪潴敔瑸⡯慶畬⥥笠 椠⁦瘨污敵㴠㴽渠汵⁬籼瘠污敵㴠㴽甠摮晥湩摥 敲畴湲∠㬢 挠湯瑳琠硥⁴‽瑓楲杮瘨污敵⸩牴浩⤨਻†晩⠠琡硥⥴爠瑥牵⁮∢਻†潣獮⁴潮浲污穩摥㴠琠硥⹴敲汰捡⡥尯⭳术‬•⤢琮䱯睯牥慃敳⤨਻†晩⠠潮浲污穩摥㴠㴽∠썮澣椠普牯慭潤•籼渠牯慭楬敺⁤㴽‽渢潡椠普牯慭潤•籼渠牯慭楬敺⁤㴽‽钀•籼渠牯慭楬敺⁤㴽‽ⴢ⤢笠 †爠瑥牵⁮∢਻†੽†敲畴湲琠硥㭴紊ਊ畦据楴湯愠慶楬牡牐敥据楨敭瑮偯潲潰瑳獡氨獩⁴‽嵛 ੻†潣獮⁴潲獷㴠䄠牲祡椮䅳牲祡氨獩⥴㼠氠獩⁴›嵛਻†潣獮⁴敲敬慶瑮獥㴠爠睯⹳楦瑬牥⠨潲⥷㴠‾੻††晩⠠爡睯簠⁼祴数景爠睯℠㴽∠扯敪瑣⤢爠瑥牵⁮慦獬㭥 †爠瑥牵⁮ਨ†††獩楆汬摥爨睯漮敦瑲湡整 籼 ††椠䙳汩敬⡤潲⹷湣橰 籼 ††椠䙳汩敬⡤潲⹷湣橰潟敦瑲湡整 籼 ††椠䙳汩敬⡤潲⹷慶潬⥲簠੼†††畎扭牥椮䙳湩瑩⡥潲⹷慶潬彲畮⥭簠੼†††獩楆汬摥爨睯搮瑡彡潣慴慣⥯簠੼†††獩楆汬摥爨睯搮瑡⥡ †⤠਻†⥽਻ 挠湯瑳洠獩楳杮㴠笠 †漠敦瑲湡整›嵛ਬ††湣橰›嵛ਬ††慤慴›嵛ਬ††慶潬㩲嬠ⱝ 素਻ 爠汥癥湡整⹳潦䕲捡⡨爨睯‬摩⥸㴠‾੻††潣獮⁴慬敢⁬‽䍠瑯썡쎧澣␠楻硤⬠ㄠ恽਻††晩⠠椡䙳汩敬⡤潲⹷景牥慴瑮⥥ 業獳湩⹧景牥慴瑮⹥異桳氨扡汥㬩 †椠⁦ℨ獩楆汬摥爨睯挮灮⥪☠…椡䙳汩敬⡤潲⹷湣橰潟敦瑲湡整⤩洠獩楳杮挮灮⹪異桳氨扡汥㬩 †挠湯瑳栠獡慄慴㴠椠䙳汩敬⡤潲⹷慤慴损瑯捡潡 籼椠䙳汩敬⡤潲⹷慤慴㬩 †椠⁦ℨ慨䑳瑡⥡洠獩楳杮搮瑡⹡異桳氨扡汥㬩 †挠湯瑳栠獡慖潬⁲‽獩楆汬摥爨睯瘮污牯 籼丠浵敢⹲獩楆楮整爨睯瘮污牯湟浵㬩 †椠⁦ℨ慨噳污牯 業獳湩⹧慶潬⹲異桳氨扡汥㬩 素㬩ਊ†潣獮⁴数摮湥楣獡㴠嬠㭝 椠⁦ℨ敲敬慶瑮獥氮湥瑧⥨笠 †瀠湥敤据慩⹳異桳∨敎桮浵⁡牰灯獯慴瀠敲湥档摩⹡⤢਻†੽†晩⠠業獳湩⹧景牥慴瑮⹥敬杮桴 数摮湥楣獡瀮獵⡨你敦瑲湡整愠獵湥整攠⁭笤業獳湩⹧景牥慴瑮⹥潪湩∨‬⤢⹽⥠਻†晩⠠業獳湩⹧湣橰氮湥瑧⥨瀠湥敤据慩⹳異桳怨乃䩐䌯䙐愠獵湥整攠⁭笤業獳湩⹧湣橰樮楯⡮Ⱒ∠紩怮㬩 椠⁦洨獩楳杮搮瑡⹡敬杮桴 数摮湥楣獡瀮獵⡨䑠瑡⁡慤挠瑯썡쎧澣愠獵湥整攠⁭笤業獳湩⹧慤慴樮楯⡮Ⱒ∠紩怮㬩 椠⁦洨獩楳杮瘮污牯氮湥瑧⥨瀠湥敤据慩⹳異桳怨慖潬⁲畡敳瑮⁥浥␠浻獩楳杮瘮污牯樮楯⡮Ⱒ∠紩怮㬩ਊ†潣獮⁴潣灭敬潴㴠爠汥癥湡整⹳敬杮桴㸠‽″☦传橢捥⹴慶畬獥洨獩楳杮⸩癥牥⡹愨牲 㸽愠牲氮湥瑧⁨㴽‽⤰਻ 爠瑥牵⁮੻††潣灭敬潴ਬ††数摮湥楣獡ਬ††業獳湩Ⱨ †挠畯瑮›敲敬慶瑮獥氮湥瑧ⱨ 素਻੽昊湵瑣潩⁮湥潣敤效摡牥慐汹慯⡤慤慴 ੻†牴⁹੻††潣獮⁴獪湯㴠䨠体⹎瑳楲杮晩⡹慤慴㬩 †爠瑥牵⁮畂晦牥昮潲⡭獪湯‬產晴∸਩†††琮卯牴湩⡧戢獡㙥∴਩†††爮灥慬散⼨⭜术‬ⴢ⤢ ††⸠敲汰捡⡥尯⼯Ⱨ∠≟਩†††爮灥慬散⼨⬽⼤Ⱨ∠⤢਻†⁽慣捴⁨੻††敲畴湲∠㬢 素紊ਊ畦据楴湯甠楮畱䍥獡䥥獮湥楳楴敶氨獩⁴‽嵛 ੻†潣獮⁴敳湥㴠渠睥匠瑥⤨਻†潣獮⁴畯⁴‽嵛਻†潦⁲挨湯瑳椠整⁭景氠獩⥴笠 †挠湯瑳琠硥⁴‽瑓楲杮椨整⁭籼∠⤢琮楲⡭㬩 †椠⁦ℨ整瑸 潣瑮湩敵਻††潣獮⁴敫⁹‽整瑸琮䱯睯牥慃敳⤨਻††晩⠠敳湥栮獡欨祥⤩挠湯楴畮㭥 †猠敥⹮摡⡤敫⥹਻††畯⹴異桳琨硥⥴਻†੽†敲畴湲漠瑵਻੽昊湵瑣潩⁮畢汩佤橢瑥䙯污扬捡⡫畲牢捩ⱡ瀠潲潰慳獬㴠嬠ⱝ挠瑯捡敯乳浯獥㴠嬠⥝笠 挠湯瑳爠扵楲慣敔瑸㴠匠牴湩⡧畲牢捩⁡籼∠⤢琮楲⡭㬩 挠湯瑳映牯敮散潤敲⁳‽湵煩敵慃敳湉敳獮瑩癩⡥ †瀠潲潰慳獬洮灡⠨⥰㴠‾瀨⸿景牥慴瑮⁥籼瀠⸿潦湲捥摥牯簠⁼∢⸩潴瑓楲杮⤨琮楲⡭⤩ ⤠献楬散〨‬⤳਻†潣獮⁴潦湲捥摥牯獥硔⁴‽潦湲捥摥牯獥氮湥瑧੨††‿Ⱡ挠浯瀠潲潰瑳獡愠牰獥湥慴慤⁳潰⁲笤潦湲捥摥牯獥樮楯⡮Ⱒ∠紩੠††›∢਻ 椠⁦爨扵楲慣敔瑸 ੻††敲畴湲怠煁極楳ꟃꏃ⁯敤椠整獮攠漯⁵敳癲썩澧⁳楶据汵摡獯쌠₠畲牢捩⁡␢牻扵楲慣敔瑸≽笤潦湲捥摥牯獥硔絴‬潣普牯敭搠瑥污慨敭瑮⁯慤⁳潣慴ꟃ뗃獥愠敮慸⹳㭠 素ਊ†晩⠠潣慴潣獥潎敭⹳敬杮桴 ੻††潣獮⁴楬瑳⁡‽潣慴潣獥潎敭⹳汳捩⡥ⰰ㌠⸩潪湩∨‬⤢਻††敲畴湲怠煁極楳ꟃꏃ⁯潣⁭慢敳渠獡挠瑯썡쎧斵⁳笤楬瑳絡笤潦湲捥摥牯獥硔絴‬敳畧湩潤愠⁳獥数楣楦慣ꟃ뗃獥愠牰獥湥慴慤⁳潮⁳牯ꟃ浡湥潴⹳㭠 素ਊ†敲畴湲怠煁極楳ꟃꏃ⁯潣普牯敭愠⁳獥数楣楦慣ꟃ뗃獥琠꧃湣捩獡搠獡挠瑯썡쎧斵⁳湡硥獡笤潦湲捥摥牯獥硔絴怮਻੽昊湵瑣潩⁮慨偳潲潰慳䑬瑡⡡⁰‽絻 ੻†敲畴湲⠠ †椠䙳汩敬⡤⹰景牥慴瑮⥥簠੼††獩楆汬摥瀨挮灮彪景牥慴瑮⥥簠੼††獩楆汬摥瀨挮灮⥪簠੼††獩楆汬摥瀨搮瑡彡潣慴慣⥯簠੼††獩楆汬摥瀨瘮污牯਩†㬩紊ਊ畦据楴湯攠獮牵卥汥捥潩慮慤瀨潲潰瑳獡㴠嬠⥝笠 氠瑥樠卡汥捥潩慮慤㴠映污敳਻†敬⁴敭潮䥲硤㴠ⴠ㬱 氠瑥洠湥牯慖潬⁲‽畎扭牥倮协呉噉彅义䥆䥎奔਻ 瀠潲潰瑳獡昮牯慅档⠨Ɒ椠硤 㸽笠 †椠⁦⼨敳敬楣湯摡椯琮獥⡴瑓楲杮瀨献汥捥潡簠⁼∢⤩ ੻†††⹰敳敬慣⁯‽匢䱅䍅佉䅎䅄㬢 ††樠卡汥捥潩慮慤㴠琠畲㭥 †素 †挠湯瑳瘠污牯畎⁭‽慰獲噥污牯潔畎扭牥瀨瘮污牯湟浵㼠‿⹰慶潬⥲਻††晩⠠畎扭牥椮䙳湩瑩⡥慶潬乲浵 ☦瘠污牯畎⁭‼敭潮噲污牯 ੻†††敭潮噲污牯㴠瘠污牯畎㭭 ††洠湥牯摉⁸‽摩㭸 †素 素㬩ਊ†晩⠠模卡汥捥潩慮慤☠…敭潮䥲硤㸠‽‰☦瀠潲潰瑳獡浛湥牯摉嵸 ੻††牰灯獯慴孳敭潮䥲硤⹝敳敬慣⁯‽匢䱅䍅佉䅎䅄㬢 素ਊ†牰灯獯慴⹳潦䕲捡⡨瀨 㸽笠 †椠⁦丨浵敢⹲獩楆楮整瀨瘮污牯湟浵 ☦⠠瀡瘮污牯簠⁼瀡瘮污牯琮楲⡭ 籼℠⹰慶潬⹲湩汣摵獥∨⑒⤢⤩笠 ††瀠瘮污牯㴠映瑭剂⡌⹰慶潬彲畮⥭਻††੽††晩⠠⹰湣橰潟敦瑲湡整☠…瀡挮灮⥪瀠挮灮⁪‽⹰湣橰潟敦瑲湡整਻††晩⠠瀡挮灮彪景牥慴瑮⁥☦瀠挮灮⥪瀠挮灮彪景牥慴瑮⁥‽⹰湣橰਻††晩⠠瀡搮瑡彡潣慴慣⁯☦瀠搮瑡⥡瀠搮瑡彡潣慴慣⁯‽⹰慤慴਻††晩⠠瀡搮瑡⁡☦瀠搮瑡彡潣慴慣⥯瀠搮瑡⁡‽⹰慤慴损瑯捡潡਻†⥽਻੽畦据楴湯猠湡瑩穩䙥汩湥浡⡥慮敭‬慦汬慢正㴠∠潤畣敭瑮≯ ੻†敲畴湲匠牴湩⡧慮敭簠⁼慦汬慢正਩††爮灥慬散⼨屛⽜⨺∿㸼嵼⼫Ⱨ∠≟਩††爮灥慬散⼨獜⼫Ⱨ∠≟਩††爮灥慬散⼨⭟术‬弢⤢ †⸠汳捩⡥ⰰㄠ〲㬩紊昊湵瑣潩⁮敲摮牥潄硣琨浥汰瑡健瑡ⱨ搠瑡佡橢 ੻†潣獮⁴畢⁦‽獦爮慥䙤汩卥湹⡣整灭慬整慐桴㬩 挠湯瑳稠灩㴠渠睥倠穩楚⡰畢⥦਻ ⼠ 牰瑯썥쎧澣氠癥⁥潣瑮慲攠灳썡澧⁳畱扥慲摮⁯慴獧 挠湯瑳搠捯浘偬瑡⁨‽眢牯⽤潤畣敭瑮砮汭㬢 挠湯瑳映㴠稠灩昮汩⡥潤塣汭慐桴㬩 椠⁦昨 ੻††敬⁴浸⁬‽⹦獡敔瑸⤨਻††浸⁬‽浸੬†††爮灥慬散⼨筜筻⼫Ⱨ∠筻⤢ ††⸠敲汰捡⡥累絽⼫Ⱨ∠絽⤢ ††⸠敲汰捡⡥尯屻屻⭳术‬笢≻਩†††爮灥慬散⼨獜尫屽⽽Ⱨ∠絽⤢਻††楺⹰楦敬搨捯浘偬瑡ⱨ砠汭㬩 素ਊ†牴⁹੻††潣獮⁴潤⁣‽敮⁷潄硣整灭慬整⡲楺Ɒ笠瀠牡条慲桰潌灯›牴敵‬楬敮牢慥獫›牴敵素㬩 †搠捯献瑥慄慴搨瑡佡橢㬩 †搠捯爮湥敤⡲㬩 †爠瑥牵⁮潤⹣敧婴灩⤨朮湥牥瑡⡥⁻祴数›渢摯扥晵敦≲素㬩 素挠瑡档⠠⥥笠 †挠湯瑳搠瑥楡獬㴠⠠⹥牰灯牥楴獥⸿牥潲獲簠⁼嵛⸩慭⡰牥⁲㸽⠠੻†††摩›牥⹲牰灯牥楴獥⸿摩ਬ†††慴㩧攠牲瀮潲数瑲敩㽳砮慴Ⱨ ††映汩㩥攠牲瀮潲数瑲敩㽳昮汩ⱥ ††挠湯整瑸›牥⹲牰灯牥楴獥⸿潣瑮硥ⱴ †素⤩਻††潣獮汯⹥牥潲⡲⁻牥潲㩲搠瑥楡獬氮湥瑧⁨‿敤慴汩⁳›⁥⥽਻††桴潲⁷㭥 素紊ਊ潣獮⁴啒彎剐䙅塉㴠✠眼爺㰾㩷偲㹲眼爺潆瑮⁳㩷獡楣㵩䄢楲污•㩷慥瑳獁慩∽牁慩≬眠栺湁楳∽牁慩≬眠挺㵳䄢楲污⼢㰾㩷潣潬⁲㩷慶㵬㐢㜴䌲∴眠琺敨敭潃潬㵲愢捣湥㕴⼢㰾㩷穳眠瘺污∽㈲⼢㰾㩷穳獃眠瘺污∽㈲⼢㰾眯爺牐㰾㩷⁴浸㩬灳捡㵥瀢敲敳癲≥✾਻潣獮⁴啒彎啓䙆塉㴠✠⼼㩷㹴⼼㩷㹲㬧挊湯瑳删乕䉟䕒䭁†‽㰧㩷㹲眼戺⽲㰾眯爺✾਻潣獮⁴位呎彈䅎䕍当商䱌㴠嬠 ∠慪敮物≯‬昢癥牥楥潲Ⱒ∠慭썲澧Ⱒ∠扡楲≬‬洢楡≯‬樢湵潨Ⱒ ∠番桬≯‬愢潧瑳≯‬猢瑥浥牢≯‬漢瑵扵潲Ⱒ∠潮敶扭潲Ⱒ∠敤敺扭潲ਢ㭝ਊ畦据楴湯攠捳灡塥汭瘨污敵㴠∠⤢笠 爠瑥牵⁮瑓楲杮瘨污敵㼠‿∢਩††爮灥慬散⼨⼦Ⱨ∠愦灭∻਩††爮灥慬散⼨⼼Ⱨ∠氦㭴⤢ †⸠敲汰捡⡥㸯术‬☢瑧∻਩††爮灥慬散⼨⼢Ⱨ∠焦潵㭴⤢ †⸠敲汰捡⡥✯术‬☢㌣㬹⤢਻੽昊湵瑣潩⁮畢汩剤湵⡳整瑸 ੻†潣獮⁴慲⁷‽整瑸㴠‽畮汬㼠∠•›瑓楲杮琨硥⥴਻†晩⠠爡睡 敲畴湲∠㬢 挠湯瑳瀠牡獴㴠爠睡献汰瑩⼨牜尿⽮㬩 爠瑥牵⁮慰瑲⹳慭⡰瀨牡ⱴ椠摮硥 㸽笠 †挠湯瑳猠晡⁥‽獥慣数浘⡬慰瑲㴠㴽∠•‿••›慰瑲㬩 †挠湯瑳爠湵㴠怠笤啒彎剐䙅塉⑽獻晡絥笤啒彎啓䙆塉恽਻††敲畴湲椠摮硥㰠瀠牡獴氮湥瑧⁨‭‱‿①牻湵⑽剻乕䉟䕒䭁恽㨠爠湵਻†⥽樮楯⡮∢㬩紊ਊ畦据楴湯猠瑥慔汢噥污敵砨汭‬慬敢ⱬ瘠污敵‬⁻慦汬慢正㴠∠胢⊔素㴠笠⥽笠 挠湯瑳洠牡敫⁲‽㹠笤慬敢絬⼼㩷㹴㭠 挠湯瑳椠硤㴠砠汭椮摮硥晏洨牡敫⥲਻†晩⠠摩⁸㴽‽ㄭ 敲畴湲砠汭਻†潣獮⁴散汬瑓牡⁴‽浸⹬湩敤佸⡦㰧㩷捴Ⱗ椠硤⬠洠牡敫⹲敬杮桴㬩 椠⁦挨汥卬慴瑲㴠㴽ⴠ⤱爠瑥牵⁮浸㭬 挠湯瑳瀠牡卡慴瑲㴠砠汭椮摮硥晏✨眼瀺Ⱗ挠汥卬慴瑲㬩 挠湯瑳瀠牡䕡摮㴠瀠牡卡慴瑲㴠㴽ⴠ‱‿ㄭ㨠砠汭椮摮硥晏✨⼼㩷㹰Ⱗ瀠牡卡慴瑲㬩 椠⁦瀨牡卡慴瑲㴠㴽ⴠ‱籼瀠牡䕡摮㴠㴽ⴠ⤱爠瑥牵⁮浸㭬 挠湯瑳愠瑦牥偐⁲‽浸⹬湩敤佸⡦㰧眯瀺牐✾‬慰慲瑓牡⥴਻†晩⠠晡整偲牐㴠㴽ⴠ‱籼愠瑦牥偐⁲‾慰慲湅⥤爠瑥牵⁮浸㭬 挠湯瑳椠獮牥側獯㴠愠瑦牥偐⁲‫㰧眯瀺牐✾氮湥瑧㭨 挠湯瑳挠湯整瑮㴠瘠污敵㴠‽畮汬簠⁼慶畬⁥㴽‽∢㼠映污扬捡⁫›慶畬㭥 挠湯瑳爠湵⁳‽畢汩剤湵⡳潣瑮湥⥴਻†晩⠠爡湵⥳爠瑥牵⁮浸㭬 挠湯瑳瀠敲楦⁸‽浸⹬汳捩⡥ⰰ椠獮牥側獯㬩 挠湯瑳猠晵楦⁸‽浸⹬汳捩⡥慰慲湅⥤਻†敲畴湲怠笤牰晥硩⑽牻湵絳笤畳晦硩恽਻੽昊湵瑣潩⁮敳側牡条慲桰晁整䡲慥楤杮砨汭‬敨摡湩Ⱨ瘠污敵‬⁻慦汬慢正㴠∠胢⊔素㴠笠⥽笠 挠湯瑳洠牡敫⁲‽㹠笤敨摡湩絧⼼㩷㹴㭠 挠湯瑳栠慥楤杮摉⁸‽浸⹬湩敤佸⡦慭歲牥㬩 椠⁦栨慥楤杮摉⁸㴽‽ㄭ 敲畴湲砠汭਻†潣獮⁴敨摡湩䕧摮㴠砠汭椮摮硥晏✨⼼㩷㹰Ⱗ栠慥楤杮摉⥸਻†晩⠠敨摡湩䕧摮㴠㴽ⴠ⤱爠瑥牵⁮浸㭬 挠湯瑳瀠牡卡慴瑲㴠砠汭椮摮硥晏✨眼瀺Ⱗ栠慥楤杮湅⥤਻†潣獮⁴慰慲湅⁤‽慰慲瑓牡⁴㴽‽ㄭ㼠ⴠ‱›浸⹬湩敤佸⡦㰧眯瀺✾‬慰慲瑓牡⥴਻†晩⠠慰慲瑓牡⁴㴽‽ㄭ簠⁼慰慲湅⁤㴽‽ㄭ 敲畴湲砠汭਻†潣獮⁴晡整偲牐㴠砠汭椮摮硥晏✨⼼㩷偰㹲Ⱗ瀠牡卡慴瑲㬩 椠⁦愨瑦牥偐⁲㴽‽ㄭ簠⁼晡整偲牐㸠瀠牡䕡摮 敲畴湲砠汭਻†潣獮⁴湩敳瑲潐⁳‽晡整偲牐⬠✠⼼㩷偰㹲⸧敬杮桴਻†潣獮⁴潣瑮湥⁴‽慶畬⁥㴽渠汵⁬籼瘠污敵㴠㴽∠•‿慦汬慢正㨠瘠污敵਻†潣獮⁴畲獮㴠戠極摬畒獮挨湯整瑮㬩 椠⁦ℨ畲獮 敲畴湲砠汭਻†潣獮⁴牰晥硩㴠砠汭献楬散〨‬湩敳瑲潐⥳਻†潣獮⁴畳晦硩㴠砠汭献楬散瀨牡䕡摮㬩 爠瑥牵⁮①灻敲楦絸笤畲獮⑽獻晵楦絸㭠紊ਊ畦据楴湯瀠牡敳牂慄整潔獉⡯牢慄整㴠∠⤢笠 挠湯瑳瀠牡獴㴠匠牴湩⡧牢慄整簠⁼∢⸩灳楬⡴⼢⤢਻†晩⠠慰瑲⹳敬杮桴℠㴽㌠ 敲畴湲∠㬢 挠湯瑳嬠摤‬浭‬祹祹⁝‽慰瑲㭳 椠⁦ℨ摤簠⁼洡⁭籼℠祹祹 敲畴湲∠㬢 爠瑥牵⁮①祻祹絹␭浻⹭慰卤慴瑲㈨‬〢⤢⵽笤摤瀮摡瑓牡⡴ⰲ∠∰紩㭠紊ਊ畦据楴湯戠極摬慄整硅整獮⡯潬慣楬慤敤㴠∠Ⱒ椠潳㴠∠Ⱒ搠慩㴠∠Ⱒ洠獥㴠∠Ⱒ愠潮㴠∠⤢笠 挠湯瑳挠瑩⁹‽瑓楲杮氨捯污摩摡⁥籼∠⤢琮楲⡭㬩 挠湯瑳椠潳慃摮摩瑡⁥‽獩⁯籼瀠牡敳牂慄整潔獉⡯①摻慩⽽笤敭絳␯慻潮恽㬩 椠⁦椨潳慃摮摩瑡⥥笠 †挠湯瑳洠㴠搠祡獪椨潳慃摮摩瑡⥥਻††晩⠠⹭獩慖楬⡤⤩笠 ††挠湯瑳瀠敲楦⁸‽楣祴㼠怠笤楣祴ⱽ怠㨠∠㬢 ††爠瑥牵⁮①灻敲楦絸笤⹭潦浲瑡✨䑄嬠敤⁝䵍䵍嬠敤⁝奙奙⤧恽਻††੽†੽†潣獮⁴摤㴠匠牴湩⡧楤⁡籼∠⤢瀮摡瑓牡⡴ⰲ∠∰㬩 挠湯瑳洠獥畎⁭‽畎扭牥洨獥 籼〠਻†潣獮⁴潭瑮乨浡⁥‽位呎彈䅎䕍当商䱌浛獥畎⁭‭崱簠⁼洨獥㼠匠牴湩⡧敭⥳㨠∠胢⊔㬩 挠湯瑳礠慥⁲‽湡⁯籼∠胢⊔਻†潣獮⁴牰晥硩㴠挠瑩⁹‿①捻瑩絹‬⁠›∢਻†潣獮⁴慤偹牡⁴‽摤琮楲⡭ ‿摤㨠∠胢⊔਻†敲畴湲怠笤牰晥硩⑽摻祡慐瑲⁽敤␠浻湯桴慎敭⁽敤␠祻慥絲㭠紊ਊ⨯㴠㴽㴽㴽㴽㴽㴽‽效灬牥⁳쌨溺捩獡 慰慲氠牥倠䙄⁳⁥硥牴楡⁲慣灭獯㴠㴽㴽㴽㴽㴽㴽‽⼪ਊ⼯䰠꫃琠硥潴搠⁥搯瑡⽡灵潬摡⽳昼汩乥浡㹥愊祳据映湵瑣潩⁮敲摡摐呦硥䙴潲啭汰慯獤昨汩乥浡⥥笠 琠祲笠 †挠湯瑳爠睡㴠匠牴湩⡧楦敬慎敭簠⁼∢⸩牴浩⤨਻††晩⠠爡睡 敲畴湲∠㬢 †挠湯瑳挠敬湡㴠瀠瑡⹨慢敳慮敭爨睡爮灥慬散⼨屜术‬⼢⤢㬩 †椠⁦ℨ汣慥⥮爠瑥牵⁮∢਻††潣獮⁴畦汬㴠瀠瑡⹨潪湩弨摟物慮敭潌慣ⱬ∠慤慴Ⱒ∠灵潬摡≳‬汣慥⥮਻††晩⠠昡⹳硥獩獴祓据昨汵⥬ 敲畴湲∠㬢 †挠湯瑳戠晵㴠映⹳敲摡楆敬祓据昨汵⥬਻††潣獮⁴摰偦牡敳㴠⠠睡楡⁴浩潰瑲∨摰ⵦ慰獲≥⤩搮晥畡瑬※⼯椠灭牯⁴楤썮涢捩⁯䔨䵓昭楲湥汤⥹ †挠湯瑳搠瑡⁡‽睡楡⁴摰偦牡敳戨晵㬩 †爠瑥牵⁮搨瑡㽡琮硥⁴籼∠⤢爮灥慬散⼨畜〰〰术‬•⤢琮楲⡭㬩 素挠瑡档⠠⥥笠 †挠湯潳敬眮牡⡮嬢敲摡摐呦硥䙴潲啭汰慯獤⁝慦桬畯∺‬㽥洮獥慳敧簠⁼⥥਻††敲畴湲∠㬢 素紊ਊ⼯䠠略썲玭楴慣⁳楳灭敬ੳ畦据楴湯朠敵獳牆浯敔瑸琨瑸㴠∠⤢笠 挠湯瑳琠㴠匠牴湩⡧硴⁴籼∠⤢਻ 挠湯瑳爠䍸偎⁊‽尯屢筤紲⹜摜㍻屽尮筤紳⽜摜㑻⵽摜㉻屽⽢਻†潣獮⁴硲偃⁆㴠⼠扜摜㍻屽尮筤紳⹜摜㍻⵽摜㉻屽⽢਻†潣獮⁴湣橰†㴠⠠⹴慭捴⡨硲乃䩐 籼嬠⥝せ⁝籼∠㬢 挠湯瑳挠晰††‽挡灮⁪‿⠨⹴慭捴⡨硲偃⥆簠⁼嵛嬩崰簠⁼∢ ›∢਻ ⼠ 牰浩楥慲搠瑡⁡䑄䴯⽍䅁䅁瀠慬獵귃敶੬†潣獮⁴硲慄整㴠⼠扜嬨ⴰ崳尿⥤⽜嬨㄰㽝摜尩⠯摜㑻⥽扜术਻†敬⁴慤慴㴠∠㬢 映牯⠠潣獮⁴⁭景琠洮瑡档汁⡬硲慄整⤩笠 †挠湯瑳搠⁤‽洫ㅛⱝ洠⁭‽洫㉛㭝 †椠⁦搨㹤ㄽ☠…摤㴼ㄳ☠…浭㴾‱☦洠㱭ㄽ⤲笠搠瑡⁡‽孭崰※牢慥㭫素 素ਊ†⼯洠楡牯瘠污牯䈠䱒⠠⑒ㄠ㈮㐳㔬⤶ 挠湯瑳爠䉸䱒㴠⼠㽒⑜尿⩳摜ㅻ㌬⡽㨿⹜摜㍻⥽Ⱚ摜㉻屽⽢㭧 氠瑥瘠污牯㴠∠Ⱒ洠硡㴠ⴠ㬱 映牯⠠潣獮⁴⁭景琠洮瑡档汁⡬硲剂⥌ ੻††潣獮⁴慲⁷‽孭崰爮灥慬散⼨幛摜崬术‬∢㬩 †挠湯瑳渠㴠丠浵敢⡲慲⹷敲汰捡⡥尯⼮Ⱨ∠⤢爮灥慬散∨∬‬⸢⤢㬩 †椠⁦丨浵敢⹲獩楆楮整渨 ☦渠㸠洠硡 ⁻慭⁸‽㭮瘠污牯㴠洠せ⹝牴浩⤨爮灥慬散⼨剞尿㼤獜⼪‬刢․⤢※੽†੽ ⼠ 景牥慴瑮⁥氨湩慨瀠썲碳浩⁡潤䌠偎⁊畯∠慒썺澣猠捯慩㩬⤢ 氠瑥漠敦瑲湡整㴠∠㬢 挠湯瑳氠湩獥㴠琠献汰瑩⼨牜尿⽮⸩慭⡰⁳㸽猠琮楲⡭⤩昮汩整⡲潂汯慥⥮਻†潣獮⁴湣橰摉⁸‽楬敮⹳楦摮湉敤⡸⁬㸽爠䍸偎⹊整瑳氨⤩਻†晩⠠湣橰摉⁸‾⤰笠 †映牯⠠敬⁴⁩‽慍桴洮硡〨‬湣橰摉⁸‭⤳※⁩㴼挠灮䥪硤⬠ㄠ※⭩⤫笠 ††挠湯瑳䰠㴠氠湩獥楛⁝籼∠㬢 ††挠湯瑳洠㴠䰠洮瑡档⼨慲孺썡嶣⁯潳楣污獜嬪尺鎀屝⩳⸨⤫椯㬩 ††椠⁦洨☠…孭崱 ⁻景牥慴瑮⁥‽孭崱琮楲⡭㬩戠敲歡※੽†††⼯氠湩慨愠瑮牥潩⁲浥䌠䥁䅘䄠呌⁁潣瑳浵⁡敳⁲慲썺澣猠捯慩੬†††晩⠠漡敦瑲湡整☠…帯䅛娭ⴰ‹Ⱞ尦尭崯␫ⸯ整瑳䰨 ☦䰠氮湥瑧⁨㴾㔠☠…爡䍸偎⹊整瑳䰨⤩笠 †††漠敦瑲湡整㴠䰠琮楲⡭㬩 ††素 †素 素 椠⁦ℨ景牥慴瑮⥥笠 †挠湯瑳洠㴠琠洮瑡档⼨慲孺썡嶣⁯潳楣污獜嬪尺鎀屝⩳嬨属屮嵲⤫椯㬩 †椠⁦洨 景牥慴瑮⁥‽孭崱琮楲⡭㬩 素ਊ†敲畴湲笠 †漠敦瑲湡整ਬ††湣橰潟敦瑲湡整›湣橰簠⁼灣⁦籼∠Ⱒ †搠瑡彡潣慴慣㩯搠瑡⁡籼∠Ⱒ †瘠污牯›慶潬⁲籼∠ਢ†㭽紊ਊ⼯丠浯⁥潤愠煲極潶挠浯⁯楰瑳⁡潤映牯敮散潤ੲ⨯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽潒瑵牥瀠摡썲澣㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽⼪挊湯瑳爠畯整⁲‽硥牰獥⹳潒瑵牥⤨਻⼊⨪ⴠⴭⴭⴭ‭潆桬⁡敤删獯潴ⴠⴭⴭⴭ‭⼪爊畯整⹲潰瑳∨是汯慨爭獯潴Ⱒ愠祳据⠠敲ⱱ爠獥 㸽笠 琠祲笠 †挠湯瑳瀠祡潬摡㴠戠極摬慐汹慯䉤獡⡥敲⹱潢祤㬩 †攠獮牵䙥敩摬⡳慰汹慯Ɽ删充䥕䕒彄但䡌ⱁ∠但䡌⁁佒呓≏㬩ਊ††潣獮⁴潢祤㴠爠煥戮摯⁹籼笠㭽 †挠湯瑳洠瑥⁡‽潢祤搮瑡⁡籼笠㭽ਊ††潣獮⁴湩瑳瑩極慣⁯†‽慰汹慯⹤湩瑳瑩極慣⁯籼洠瑥⹡湩瑳瑩極慣⁯籼戠摯⹹湩瑳瑩極慣⁯籼∠䑅䕇㬢 †⼠ 鳢₅慎畴敲慺搠⁯楤灳꫃摮潩搠癥⁥楶⁲塅呁䵁久䕔搠⁥楴潰畒牢捩੡††潣獮⁴慮畴敲慺楄灳†‽戨摯㽹琮灩副扵楲慣簠⁼∢⸩潴瑓楲杮⤨琮楲⡭㬩ਊ††潣獮⁴整灭慬整楆敬㴠瀠捩䙫汯慨敔灭慬整椨獮楴畴捩潡‬慮畴敲慺楄灳㬩 †挠湯瑳琠浥汰瑡健瑡⁨‽慰桴樮楯⡮偔彌但䡌彁䥄ⱒ琠浥汰瑡䙥汩⥥਻††晩⠠昡⹳硥獩獴祓据琨浥汰瑡健瑡⥨ ੻†††潣獮汯⹥牥潲⡲吢浥汰瑡⁥畡敳瑮㩥Ⱒ琠浥汰瑡健瑡⥨਻†††敲畴湲爠獥献慴畴⡳〴⤴樮潳⡮⁻歯›慦獬ⱥ攠牲牯›呠浥汰瑡⁥썮澣攠据湯牴摡㩯␠瑻浥汰瑡䙥汩絥⁠⥽਻††੽ †挠湯瑳搠捯慄慴㴠笠 ††椠獮楴畴捩潡›††瑓楲杮椨獮楴畴捩潡⸩潴灕数䍲獡⡥Ⱙ ††瀠潲敪潴损摯杩㩯†慰汹慯⹤牰橯瑥Ɐ ††瀠潲敪潴湟浯㩥††慰汹慯⹤牰橯瑥Ɐ ††瀠彣畮敭潲›†††慰汹慯⹤牰獥慴慣彯潣瑮獡簠⁼钀Ⱒ ††渠瑡牵穥彡楤灳›†慮畴敲慺楄灳‬††††⼠ ⴼ琠条挠牯敲慴渠⁯佄塃 ††爠扵楲慣›††††慮畴敲慺楄灳‬††††⼠ 挨浯慰⥴ ††映癡牯捥摩㩯†††慰汹慯⹤慦潶敲楣潤湟浯⁥籼∠胢⊔ਬ†††湣橰›†††††瀠祡潬摡昮癡牯捥摩彯潤⁣籼∠胢⊔ਬ†††彮硥牴瑡㩯†††瀠祡潬摡攮瑸慲潴湟浵簠⁼钀Ⱒ ††渠彦敲楣潢›†††慰汹慯⹤普湟浵簠⁼钀Ⱒ ††搠瑡彡浥獩慳㩯††慰汹慯⹤普摟瑡彡浥獩慳彯牢簠⁼慰汹慯⹤普摟瑡彡浥獩慳⁯籼∠胢⊔ਬ†††慤慴灟条浡湥潴›瀠祡潬摡搮彴慰慧敭瑮彯牢簠⁼慰汹慯⹤瑤灟条浡湥潴簠⁼钀Ⱒ ††瘠污牯灟条㩯†††慰汹慯⹤慶潬彲潴慴⁬籼∠胢⊔ਬ††㭽ਊ††潣獮⁴畯⁴‽敲摮牥潄硣琨浥汰瑡健瑡ⱨ搠捯慄慴㬩 †挠湯瑳栠湩⁴‽慳楮楴敺楆敬慮敭戨摯⹹楦敬慮敭楈瑮簠⁼䙠汯慨⑟摻捯慄慴瀮潲敪潴损摯杩絯⑟摻捯慄慴瀮彣畮敭潲簠⁼∢恽‬昢汯慨摟彥潲瑳≯㬩ਊ††敲⹳敳䡴慥敤⡲䌢湯整瑮吭灹≥‬愢灰楬慣楴湯瘯摮漮数确汭潦浲瑡⵳景楦散潤畣敭瑮眮牯灤潲散獳湩浧⹬潤畣敭瑮⤢਻††敲⹳敳䡴慥敤⡲䌢湯整瑮䐭獩潰楳楴湯Ⱒ怠瑡慴档敭瑮※楦敬慮敭∽笤楨瑮⹽潤硣怢㬩 †爠瑥牵⁮敲⹳敳摮漨瑵㬩 素挠瑡档⠠牥⥲笠 †挠湯潳敬攮牲牯∨⽛灡⽩敧敮慲整是汯慨爭獯潴⁝牥潲Ⱒ攠牲㬩 †爠瑥牵⁮敲⹳瑳瑡獵㔨〰⸩獪湯笨漠㩫映污敳‬牥潲㩲∠牅潲愠⁯敧慲⁲⁡潆桬⁡敤删獯潴•⥽਻†੽⥽਻⼊⨪ⴠⴭⴭⴭ‭慍慰搠⁥潃慴ꟃꏃ⁯ⴭⴭⴭⴭ⨠ਯ潲瑵牥瀮獯⡴⼢慭慰挭瑯捡潡Ⱒ愠祳据⠠敲ⱱ爠獥 㸽笠 琠祲笠 †挠湯瑳瀠祡潬摡㴠戠極摬慐汹慯䉤獡⡥敲⹱潢祤㬩 †攠獮牵䙥敩摬⡳慰汹慯Ɽ删充䥕䕒彄䅍䅐‬䴢偁⁁佃䅔蟃菃≏㬩ਊ††潣獮⁴潢祤㴠爠煥戮摯⁹籼笠㭽 †挠湯瑳洠瑥⁡‽潢祤搮瑡⁡籼笠㭽ਊ††潣獮⁴湩瑳瑩極慣⁯††‽慰汹慯⹤湩瑳瑩極慣⁯籼洠瑥⹡湩瑳瑩極慣⁯籼戠摯⹹湩瑳瑩極慣⁯籼∠䑅䕇㬢 †挠湯瑳瀠潲敪潴潎敭††㴠瀠祡潬摡瀮潲敪潴簠⁼敭慴瀮潲敪潴簠⁼潢祤瀮潲敪潴簠⁼∢਻††潣獮⁴牰橯瑥䍯摯杩⁯†‽敭慴挮摯杩⁯籼戠摯⹹潣楤潧簠⁼潢祤瀮潲敪潴损摯杩⁯籼∠㬢 †挠湯瑳琠牥潭慐捲牥慩†㴠瀠祡潬摡琮牥潭灟牡散楲⁡籼戠摯⹹整浲偯牡散楲⁡籼洠瑥⹡整浲偯牡散楲⁡籼∠㬢 †挠湯瑳挠灮䥪獮楴畴捩潡㴠戠摯⹹湣橰湉瑳瑩極慣⁯籼洠瑥⹡湣橰湉瑳瑩極慣⁯籼瀠祡潬摡挮灮彪湩瑳瑩極慣⁯籼∠㬢ਊ††⼯薜甠慳⁲塅呁䵁久䕔琠灩副扵楲慣 †挠湯瑳琠灩副扵楲慣††㴠⠠潢祤⸿楴潰畒牢捩⁡籼∠⤢琮卯牴湩⡧⸩牴浩⤨਻ †氠瑥漠橢瑥䑯獥⁣†††㴠渠牯慭楬敺扏敪潴敔瑸⡯潢祤漮橢瑥䑯獥牣捩潡簠⁼慰汹慯⹤扯敪潴簠⁼∢㬩 †挠湯瑳樠獵䉴獡⁥†††㴠戠摯⹹番瑳晩捩瑡癩⁡籼洠瑥⹡番瑳晩捩瑡癩⁡籼瀠祡潬摡樮獵楴楦慣楴慶簠⁼∢਻††潣獮⁴慤慴慐慧敭瑮⁯†‽浦䉴䑒瑡⡥潢祤搮瑡偡条浡湥潴簠⁼敭慴搮瑡偡条浡湥潴簠⁼慰汹慯⹤瑤灟条浡湥潴簠⁼∢㬩 †挠湯瑳挠潯摲湥摡牯潎敭㴠戠摯⹹潣牯敤慮潤乲浯⁥籼洠瑥⹡潣牯敤慮潤乲浯⁥籼∠㬢ਊ††⼯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽牰灯獯慴⁳⁥扯敪潴㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽਽††潣獮⁴灯湥楡汃敩瑮㴠栠獡灏湥䥁㼠攠獮牵佥数䅮䍉楬湥⡴ ›畮汬਻††潣獮⁴潣慴潣獥慍⁰‽敮⁷慍⡰㬩ਊ††潣獮⁴異桳潃慴慣⁯‽笨渠浡ⱥ琠硥ⱴ映汩健瑡⁨⥽㴠‾੻†††潣獮⁴汣慥乮浡⁥‽瑓楲杮渨浡⁥籼∠⤢琮楲⡭ 籼怠潣慴慣彯笤潣慴潣獥慍⹰楳敺⬠ㄠ恽਻†††潣獮⁴敫⁹‽汣慥乮浡⹥潴潌敷䍲獡⡥㬩 ††挠湯瑳攠瑮祲㴠挠瑯捡敯䵳灡朮瑥欨祥㬩 ††椠⁦攨瑮祲 ੻††††晩⠠攡瑮祲琮硥⁴☦琠硥⥴攠瑮祲琮硥⁴‽整瑸਻††††晩⠠攡瑮祲瀮瑡⁨☦映汩健瑡⥨攠瑮祲瀮瑡⁨‽楦敬慐桴਻†††⁽汥敳笠 †††挠瑯捡敯䵳灡献瑥欨祥‬੻†††††慮敭›汣慥乮浡ⱥ ††††琠硥㩴匠牴湩⡧整瑸簠⁼∢Ⱙ ††††瀠瑡㩨映汩健瑡⁨☦映⹳硥獩獴祓据昨汩健瑡⥨㼠映汩健瑡⁨›畮汬ਬ††††⥽਻†††੽††㭽ਊ††潣獮⁴敲潳癬䍥瑯捡潡楆敬慐桴㴠⠠慲䕷瑮祲 㸽笠 ††挠湯瑳挠湡楤慤整⁳‽嵛਻†††潣獮⁴異桳慃摮摩瑡⁥‽瘨污敵 㸽笠 †††挠湯瑳挠敬湡㴠匠牴湩⡧慶畬⁥籼∠⤢琮楲⡭㬩 †††椠⁦ℨ汣慥⥮爠瑥牵㭮 †††挠湡楤慤整⹳異桳挨敬湡㬩 ††素਻ ††椠⁦爨睡湅牴⁹☦琠灹潥⁦慲䕷瑮祲㴠㴽∠扯敪瑣⤢笠 †††椠⁦爨睡湅牴⹹慰桴☠…獦攮楸瑳即湹⡣慲䕷瑮祲瀮瑡⥨ ੻†††††敲畴湲爠睡湅牴⹹慰桴਻††††੽††††異桳慃摮摩瑡⡥慲䕷瑮祲昮汩湥浡⁥籼爠睡湅牴⹹楦敬慎敭簠⁼慲䕷瑮祲欮祥㬩 †††瀠獵䍨湡楤慤整爨睡湅牴⹹牵⁬籼爠睡湅牴⹹楬歮簠⁼慲䕷瑮祲栮敲⥦਻††††異桳慃摮摩瑡⡥慲䕷瑮祲渮浡⁥籼爠睡湅牴⹹牯杩湩污慮敭㬩 ††素攠獬⁥晩⠠祴数景爠睡湅牴⁹㴽‽猢牴湩≧ ੻††††異桳慃摮摩瑡⡥慲䕷瑮祲㬩 ††素ਊ†††潦⁲挨湯瑳挠湡楤慤整漠⁦慣摮摩瑡獥 ੻††††牴⁹੻†††††潣獮⁴汣慥敮⁤‽瑓楲杮挨湡楤慤整਩††††††爮灥慬散⼨桞瑴獰㨿⽜⽜幛崯尫⼯Ⱪ∠⤢ †††††⸠敲汰捡⡥帯灵潬摡屳⼯Ⱪ∠⤢ †††††⸠敲汰捡⡥帯⽜⼫‬∢਩††††††爮灥慬散⼨㽜⨮⼤‬∢਩††††††献汰瑩⼨屛⽜⽝਩††††††昮汩整⡲潂汯慥⥮ †††††⸠潰⡰㬩 ††††椠⁦ℨ汣慥敮⥤挠湯楴畮㭥 ††††挠湯瑳朠敵獳㴠瀠瑡⹨潪湩弨摟物慮敭潌慣ⱬ∠慤慴Ⱒ∠灵潬摡≳‬汣慥敮⥤਻†††††晩⠠獦攮楸瑳即湹⡣畧獥⥳ 敲畴湲朠敵獳਻††††⁽慣捴⁨攨 ੻†††††潣獮汯⹥慷湲∨浛灡嵡爠獥汯敶潃慴慣䙯汩健瑡⁨慦桬畯∺‬㽥洮獥慳敧簠⁼⥥਻††††੽†††੽ ††爠瑥牵⁮畮汬਻††㭽ਊ††晩⠠牁慲⹹獩牁慲⡹潢祤⸿潤獣⸿潣慴潣獥⤩笠 ††戠摯⹹潤獣挮瑯捡敯⹳潦䕲捡⡨挨‬摩⥸㴠‾੻††††潣獮⁴慮敭㴠挠⸿慮敭簠⁼㽣昮汩湥浡⁥籼挠⸿楦敬慎敭簠⁼㽣漮楲楧慮湬浡⁥籼怠潣慴慣彯笤摩⁸‫紱㭠 †††挠湯瑳琠硥⁴‽瑓楲杮挨⸿整瑸簠⁼∢㬩 †††挠湯瑳映汩健瑡⁨‽敲潳癬䍥瑯捡潡楆敬慐桴挨㬩 †††瀠獵䍨瑯捡潡笨渠浡ⱥ琠硥ⱴ映汩健瑡⁨⥽਻†††⥽਻††੽ †椠⁦䄨牲祡椮䅳牲祡戨摯⹹潣慴潣獥 ☦戠摯⹹潣慴潣獥氮湥瑧⥨笠 ††挠湯瑳渠浡獥㴠戠摯⹹潣慴潣獥洮灡⠨Ᵽ椠硤 㸽匠牴湩⡧⁣籼怠潣慴慣彯笤摩⁸‫紱⥠㬩 ††挠湯瑳琠硥獴㴠愠慷瑩倠潲業敳愮汬渨浡獥洮灡⠨慮敭 㸽爠慥偤晤敔瑸牆浯灕潬摡⡳慮敭⸩慣捴⡨⤨㴠‾∢⤩㬩 ††渠浡獥昮牯慅档⠨慮敭‬摩⥸㴠‾੻††††潣獮⁴楦敬慐桴㴠爠獥汯敶潃慴慣䙯汩健瑡⡨慮敭㬩 †††瀠獵䍨瑯捡潡笨渠浡ⱥ琠硥㩴琠硥獴楛硤⁝籼∠Ⱒ映汩健瑡⁨⥽਻†††⥽਻††੽ †挠湯瑳挠瑯捡敯䕳瑮楲獥㴠䄠牲祡昮潲⡭潣慴潣獥慍⹰慶畬獥⤨㬩 †挠湯瑳挠瑯捡敯乳浯獥㴠挠瑯捡敯䕳瑮楲獥洮灡⠨湥牴ⱹ椠硤 㸽攠瑮祲渮浡⁥籼怠潃慴ꟃꏃ⁯笤摩⁸‫紱⥠਻††潣獮⁴敳瑣潩獮㴠挠瑯捡敯䕳瑮楲獥洮灡⠨湥牴ⱹ椠硤 㸽笠 ††挠湯瑳栠慥敤⁲‽⍠⌣䌠呏썁쎇侃␠楻硤⬠ㄠ⁽␨敻瑮祲渮浡絥怩਻†††潣獮⁴整瑸敓⁣‽瑓楲杮攨瑮祲琮硥⁴籼∠⤢琮楲⡭㬩 ††椠⁦ℨ整瑸敓⥣笠 †††爠瑥牵⁮①桻慥敤絲湜卛浥琠硥潴传剃搠獩潰썮皭汥钀甠楴楬敺漠愠煲極潶愠敮慸潤崮㭠 ††素 ††爠瑥牵⁮①桻慥敤絲湜笤整瑸敓⹣汳捩⡥ⰰ㈠〰〰紩㭠 †素㬩ਊ††潣獮⁴楬瑳䍡瑯捡敯味硥潴㴠猠捥楴湯⹳潪湩∨湜湜⤢਻ †挠湯瑳挠瑯捡敯䅳煲極潶⁳‽潣慴潣獥湅牴敩ੳ†††洮灡⠨湥牴ⱹ椠硤 㸽 †††攠瑮祲瀮瑡੨†††††‿੻†††††††湩敤㩸椠硤ਬ†††††††慮敭›湥牴⹹慮敭ਬ†††††††慰桴›湥牴⹹慰桴ਬ††††††੽†††††›畮汬 ††⤠ ††⸠楦瑬牥䈨潯敬湡㬩ਊ††潣獮⁴慨䅳煲極潶䍳瑯捡敯⁳‽潣慴潣獥牁畱癩獯氮湥瑧⁨‾㬰ਊ††潣獮⁴潣慴潣獥敒畳潭㴠栠獡牁畱癩獯潃慴潣獥 ††㼠挠瑯捡敯䕳瑮楲獥 ††††⸠慭⡰攨瑮祲‬摩⥸㴠‾੻††††††潣獮⁴慰瑲⁳‽恛潃慴ꟃꏃ⁯笤摩⁸‫紱›笤湥牴⹹慮敭恽㭝 †††††椠⁦攨瑮祲瀮瑡⥨瀠牡獴瀮獵⡨嬢牡畱癩⁯湡硥摡嵯⤢਻††††††晩⠠匡牴湩⡧湥牴⹹整瑸簠⁼∢⸩牴浩⤨ 慰瑲⹳異桳∨獛浥传剃≝㬩 †††††爠瑥牵⁮慰瑲⹳潪湩∨∠㬩 ††††素਩†††††樮楯⡮尢≮਩†††›∢਻ †挠湯瑳瀠潲潰瑳獡慍畮楡⁳‽牁慲⹹獩牁慲⡹潢祤瀮潲潰瑳獡 ‿潢祤瀮潲潰瑳獡㨠嬠㭝 †氠瑥瀠潲潰瑳獡㴠瀠潲潰瑳獡慍畮楡⹳慭⡰瀨‬摩⥸㴠‾潮浲污穩健潲潰慳⡬Ɒ椠硤⤩昮汩整⡲慨偳潲潰慳䑬瑡⥡਻ †挠湯瑳愠楶潳䍳瑯捡潡㴠䄠牲祡椮䅳牲祡戨摯⹹潣慴潣獥癁獩獯 ‿⹛⸮潢祤挮瑯捡敯䅳楶潳嵳㨠嬠㭝 †氠瑥挠瑯捡敯䥳十慴畴⁳‽⁻整瑮瑡癩獡›嵛‬潣灭敬潴›慦獬ⱥ瀠湥敤据慩㩳嬠⁝㭽ਊ††晩⠠漡橢瑥䑯獥⥣笠 ††漠橢瑥䑯獥⁣‽潮浲污穩佥橢瑥呯硥潴戨摯⹹扯敪潴簠⁼敭慴漮橢瑥⁯籼瀠祡潬摡漮橢瑥⁯籼∠⤢਻††੽ †挠湯瑳栠獡敔瑸䍯瑯捡敯⁳‽祴数景氠獩慴潃慴潣獥敔瑸⁯㴽‽猢牴湩≧☠…楬瑳䍡瑯捡敯味硥潴琮楲⡭⸩敬杮桴㸠〠਻ †椠⁦漨数慮䍩楬湥⁴☦⠠慨味硥潴潃慴潣獥簠⁼慨䅳煲極潶䍳瑯捡敯⥳ ੻†††牴⁹੻††††潣獮⁴湡污獩⁥‽睡楡⁴硥牴楡䍲瑯捡敯䑳呥硥潴笨 ††††椠獮楴畴捩潡ਬ†††††潣楤潧灟潲敪潴›牰橯瑥䍯摯杩⁯籼瀠祡潬摡瀮潲敪潴簠⁼∢ਬ†††††畲牢捩㩡琠灩副扵楲慣簠⁼∢ਬ†††††楬瑳彡潣慴潣獥瑟硥潴›楬瑳䍡瑯捡敯味硥潴ਬ†††††潣慴潣獥慟敮潸㩳挠瑯捡敯剳獥浵Ɐ ††††挠瑯捡敯彳牡畱癩獯›潣慴潣獥牁畱癩獯ਬ††††ⱽ笠洠硡瑁整灭獴›″⥽਻ †††椠⁦䄨牲祡椮䅳牲祡愨慮楬敳⸿癡獩獯⤩愠楶潳䍳瑯捡潡瀮獵⡨⸮愮慮楬敳愮楶潳⥳਻††††晩⠠牁慲⹹獩牁慲⡹湡污獩㽥瀮湥敤据慩⥳ 癡獩獯潃慴慣⹯異桳⸨⸮湡污獩⹥数摮湥楣獡㬩ਊ††††潣慴潣獥䅉瑓瑡獵㴠笠 ††††琠湥慴楴慶㩳䄠牲祡椮䅳牲祡愨慮楬敳⸿整瑮瑡癩獡 ‿湡污獩⹥整瑮瑡癩獡㨠嬠ⱝ ††††挠浯汰瑥㩯℠愡慮楬敳⸿潣灭敬潴ਬ†††††数摮湥楣獡›牁慲⹹獩牁慲⡹湡污獩㽥瀮湥敤据慩⥳㼠愠慮楬敳瀮湥敤据慩⁳›嵛ਬ††††㭽ਊ††††晩⠠漡橢瑥䑯獥⁣☦愠慮楬敳⸿扯敪潴牟獡畣桮⥯笠 ††††漠橢瑥䑯獥⁣‽潮浲污穩佥橢瑥呯硥潴愨慮楬敳漮橢瑥彯慲捳湵潨㬩 †††素ਊ††††潣獮⁴牰灯獯慴䥳⁁‽牁慲⹹獩牁慲⡹湡污獩㽥瀮潲潰瑳獡਩†††††‿湡污獩⹥牰灯獯慴⹳慭⡰瀨‬摩⥸㴠‾潮浲污穩健潲潰慳⡬੻†††††††⸮瀮ਬ†††††††湣橰›㽰挮灮⁪㼿瀠⸿湣橰损晰㼠‿㽰挮灮彪景牥慴瑮⁥㼿∠Ⱒ ††††††挠灮彪景牥慴瑮㩥瀠⸿湣橰㼠‿㽰挮灮彪灣⁦㼿瀠⸿湣橰潟敦瑲湡整㼠‿∢ਬ†††††††慤慴损瑯捡潡›㽰搮瑡彡潣慴慣⁯㼿瀠⸿慤慴潃慴慣⁯㼿∠Ⱒ ††††††瘠污牯›祴数景瀠⸿慶潬⁲㴽‽渢浵敢≲㼠映瑭剂⡌⹰慶潬⥲㨠瀠⸿慶潬Ⱳ ††††††瘠污牯湟浵›祴数景瀠⸿慶潬⁲㴽‽渢浵敢≲㼠瀠瘮污牯㨠瀠牡敳慖潬呲乯浵敢⡲㽰瘮污牯Ⱙ †††††素‬摩⥸⸩楦瑬牥栨獡牐灯獯污慄慴਩†††††›嵛਻ †††椠⁦ℨ牰灯獯慴⹳敬杮桴 ੻†††††牰灯獯慴⁳‽牰灯獯慴䥳㭁 †††素攠獬⁥晩⠠牰灯獯慴䥳⹁敬杮桴 ੻†††††潣獮⁴敭杲摥㴠嬠㭝 ††††挠湯瑳琠瑯污㴠䴠瑡⹨慭⡸牰灯獯慴⹳敬杮桴‬牰灯獯慴䥳⹁敬杮桴㬩 ††††映牯⠠敬⁴⁩‽㬰椠㰠琠瑯污※⭩⤫笠 †††††挠湯瑳戠獡⁥‽牰灯獯慴孳嵩਻††††††潣獮⁴慦汬慢正㴠瀠潲潰瑳獡䅉楛㭝 †††††椠⁦戨獡⁥☦映污扬捡⥫笠 ††††††洠牥敧⹤異桳洨牥敧牐灯獯污楆汥獤戨獡ⱥ映污扬捡⥫㬩 †††††素攠獬⁥晩⠠慢敳 ੻†††††††敭杲摥瀮獵⡨慢敳㬩 †††††素攠獬⁥晩⠠慦汬慢正 ੻†††††††敭杲摥瀮獵⡨慦汬慢正㬩 †††††素 ††††素 ††††瀠潲潰瑳獡㴠洠牥敧⹤楦瑬牥栨獡牐灯獯污慄慴㬩 †††素 ††素挠瑡档⠠牥⥲笠 †††挠湯潳敬眮牡⡮嬢慭慰⁝硥牴楡䍲瑯捡敯䑳呥硥潴映污潨㩵Ⱒ攠牲⸿敭獳条⁥籼攠牲㬩 ††素 †素ਊ††晩⠠瀡潲潰瑳獡氮湥瑧⁨☦挠瑯捡敯䕳瑮楲獥氮湥瑧⥨笠 ††瀠潲潰瑳獡㴠挠瑯捡敯䕳瑮楲獥 †††⸠慭⡰攨瑮祲‬摩⥸㴠‾੻†††††潣獮⁴畧獥⁳‽畧獥䙳潲呭硥⡴湥牴⹹整瑸㬩 ††††爠瑥牵⁮潮浲污穩健潲潰慳⡬⁻敳敬慣㩯怠潃慴ꟃꏃ⁯笤摩⁸‫紱Ⱡ⸠⸮畧獥⁳ⱽ椠硤㬩 †††素਩††††昮汩整⡲慨偳潲潰慳䑬瑡⥡਻††੽ †椠⁦ℨ牰灯獯慴⹳敬杮桴☠…潣慴潣獥湅牴敩⹳敬杮桴 ੻†††牰灯獯慴⁳‽潣慴潣獥湅牴敩⹳慭⡰弨‬摩⥸㴠‾潮浲污穩健潲潰慳⡬絻‬摩⥸㬩 †素ਊ††湥畳敲敓敬楣湯摡⡡牰灯獯慴⥳਻ †挠湯瑳䴠义剟坏⁓‽㬳 †眠楨敬⠠牰灯獯慴⹳敬杮桴㰠䴠义剟坏⥓笠 ††瀠潲潰瑳獡瀮獵⡨潮浲污穩健潲潰慳⡬絻‬牰灯獯慴⹳敬杮桴⤩਻††੽ †挠湯瑳瀠潲潰瑳獡潆呲浥汰瑡⁥‽牰灯獯慴⹳慭⡰瀨‬摩⥸㴠‾笨 ††猠汥捥潡›⹰敳敬慣⁯籼怠潃慴ꟃꏃ⁯笤摩⁸‫紱Ⱡ ††漠敦瑲湡整›⹰景牥慴瑮⁥籼∠Ⱒ ††挠灮㩪瀠挮灮⁪籼瀠挮灮彪景牥慴瑮⁥籼∠Ⱒ ††挠灮彪景牥慴瑮㩥瀠挮灮彪景牥慴瑮⁥籼瀠挮灮⁪籼∠Ⱒ ††搠瑡㩡瀠搮瑡彡潣慴慣⁯籼瀠搮瑡⁡籼∠Ⱒ ††搠瑡彡潣慴慣㩯瀠搮瑡彡潣慴慣⁯籼瀠搮瑡⁡籼∠Ⱒ ††瘠污牯›⹰慶潬⁲籼∠Ⱒ †素⤩਻ †挠湯瑳瀠潲潰瑳獡慐慲䱌⁍‽牰灯獯慴ੳ†††昮汩整⡲慨偳潲潰慳䑬瑡⥡ ††⸠慭⡰瀨 㸽⠠੻††††敳敬慣㩯瀠献汥捥潡ਬ††††景牥慴瑮㩥瀠漮敦瑲湡整ਬ††††湣橰›⹰湣橰簠⁼⹰湣橰潟敦瑲湡整簠⁼∢ਬ††††慤慴潃慴慣㩯瀠搮瑡彡潣慴慣⁯籼∠Ⱒ †††瘠污牯›⹰慶潬⁲籼⠠畎扭牥椮䙳湩瑩⡥⹰慶潬彲畮⥭㼠映瑭剂⡌⹰慶潬彲畮⥭㨠∠⤢ਬ†††⥽㬩ਊ††⼯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽整瑸獯映湩楡⁳㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽 †挠湯瑳映污扬捡䍫浯汰浥湥潴㴠∠敓敬ꟃꏃ⁯慰瑵摡⁡数慬洠汥潨⁲牰灯獯慴攠瀠汥⁯畣瑳ⵯ敢敮썦掭潩‬潣獮摩牥湡潤挠湯潦浲摩摡⁥썴掩楮慣‬牰穡獯攠瘠污牯∮਻††敬⁴番瑳晩捩瑡癩䙡湩污㴠匠牴湩⡧番瑳慂敳簠⁼∢⸩牴浩⤨਻††敬⁴扯敪潴楆慮⁬‽瑓楲杮漨橢瑥䑯獥⁣籼∠⤢琮楲⡭㬩 †挠湯瑳氠捯污摩摡⁥‽潢祤氮捯污摩摡⁥籼洠瑥⹡潬慣楬慤敤簠⁼䴢捡楥돃㬢ਊ††晩⠠灯湥楡汃敩瑮☠…牰灯獯慴偳牡䱡䵌氮湥瑧⥨笠 ††琠祲笠 †††挠湯瑳笠漠橢瑥Ɐ樠獵楴楦慣楴慶›番瑳䥁素㴠愠慷瑩朠牥牡扏敪潴䩅獵楴楦慣楴慶笨 ††††椠獮楴畴捩潡ਬ†††††牰橯瑥㩯瀠潲敪潴潎敭簠⁼∢ਬ†††††潣楤潧灟潲敪潴›牰橯瑥䍯摯杩⁯籼∠Ⱒ ††††爠扵楲慣›楴潰畒牢捩⁡籼∠Ⱒ ††††樠獵楴楦慣楴慶扟獡㩥樠獵楴楦慣楴慶楆慮ⱬ ††††樠潳彮牰灯獯慴㩳䨠体⹎瑳楲杮晩⡹牰灯獯慴偳牡䱡䵌‬畮汬‬⤲ਬ†††††慤慴灟条浡湥潴›慤慴慐慧敭瑮⁯籼∠Ⱒ ††††氠捯污摩摡ⱥ †††素㬩 †††椠⁦漨橢瑥⥯漠橢瑥䙯湩污㴠渠牯慭楬敺扏敪潴敔瑸⡯扯敪潴㬩 †††椠⁦樨獵䅴⥉樠獵楴楦慣楴慶楆慮⁬‽番瑳䥁਻†††⁽慣捴⁨攨牲 ੻††††潣獮汯⹥慷湲∨浛灡嵡朠牥牡扏敪潴䩅獵楴楦慣楴慶映污潨㩵Ⱒ攠牲⸿敭獳条⁥籼攠牲㬩 ††素 †素ਊ††晩⠠漡橢瑥䙯湩污 扯敪潴楆慮⁬‽潮浲污穩佥橢瑥呯硥潴漨橢瑥䑯獥⁣籼∠⤢਻††晩⠠漡橢瑥䙯湩污 ੻†††扯敪潴楆慮⁬‽畢汩佤橢瑥䙯污扬捡⡫楴潰畒牢捩ⱡ瀠潲潰瑳獡潆呲浥汰瑡ⱥ挠瑯捡敯乳浯獥㬩 †素ਊ††晩⠠模獵楴楦慣楴慶楆慮⥬笠 ††樠獵楴楦慣楴慶楆慮⁬‽慦汬慢正潃灭敬敭瑮㭯 †素攠獬⁥晩⠠模獵楴楦慣楴慶楆慮⹬潴潌敷䍲獡⡥⸩湩汣摵獥∨畣瑳ⵯ敢敮≦⤩笠 ††挠湯瑳琠楲浭摥㴠樠獵楴楦慣楴慶楆慮⹬牴浩⤨爮灥慬散⼨獜⼫Ⱨ∠∠⤠਻†††番瑳晩捩瑡癩䙡湩污㴠琠楲浭摥爮灥慬散⼨嬨⹞ℿ⥝⼤‬␢⸱⤢਻†††番瑳晩捩瑡癩䙡湩污⬠‽⁠笤慦汬慢正潃灭敬敭瑮絯㭠 †素ਊ††⼯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽潲慤썰₩㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽 †挠湯瑳栠橯⁥‽慤橹⡳㬩 †挠湯瑳氠捯污慄慴㴠怠笤潬慣楬慤敤ⱽ␠桻橯⹥潦浲瑡∨䑄⤢⁽敤␠桻橯⹥潦浲瑡∨䵍䵍⤢⁽敤␠桻橯⹥潦浲瑡∨奙奙⤢恽਻††⼯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽敲摮牥穩썡쎧澣㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽਽††潣獮⁴整灭慬整楆敬㴠瀠捩䵫灡呡浥汰瑡⡥湩瑳瑩極慣⥯਻††潣獮⁴整灭慬整慐桴㴠瀠瑡⹨潪湩吨䱐䵟偁彁䥄ⱒ琠浥汰瑡䙥汩⥥਻††晩⠠昡⹳硥獩獴祓据琨浥汰瑡健瑡⥨ ੻†††潣獮汯⹥牥潲⡲吢浥汰瑡⁥畡敳瑮㩥Ⱒ琠浥汰瑡健瑡⥨਻†††敲畴湲爠獥献慴畴⡳〴⤴樮潳⡮⁻歯›慦獬ⱥ攠牲牯›呠浥汰瑡⁥썮澣攠据湯牴摡㩯␠瑻浥汰瑡䙥汩絥⁠⥽਻††੽ †挠湯瑳搠捯慄慴㴠笠 ††⼠ 慣敢ꟃ污潨 ††椠獮楴畴捩潡›††匠牴湩⡧湩瑳瑩極慣⥯琮啯灰牥慃敳⤨ਬ†††湣橰楟獮㩴††††湣橰湉瑳瑩極慣⁯籼∠胢⊔ਬ†††整浲彯慰捲牥慩›†整浲偯牡散楲⁡籼∠胢⊔ਬ†††牰橯瑥彯潮敭›††牰橯瑥乯浯⁥籼∠胢⊔ਬ†††牰橯瑥彯潣楤潧›†牰橯瑥䍯摯杩⁯籼∠胢⊔ਬ ††⼠ 潣灲੯†††慮畴敲慺摟獩㩰††楴潰畒牢捩⁡籼∠胢⊔‬†⼯薜甠慳䔠䅘䅔䕍呎⁅楴潰畒牢捩੡†††扯敪潴›†††††扯敪潴楆慮⁬籼∠胢⊔ਬ†††牰灯獯慴㩳††††牰灯獯慴䙳牯敔灭慬整ਬ ††⼠ 潲慤썰઩†††慤慴慟畱獩捩潡›†慤慴慐慧敭瑮⁯籼∠胢⊔ਬ†††番瑳晩捩瑡癩㩡††番瑳晩捩瑡癩䙡湩污簠⁼钀Ⱒ ††氠捯污摟瑡㩡†††氠捯污慄慴ਬ†††潣牯敤慮潤彲潮敭›潣牯敤慮潤乲浯⁥籼∠胢⊔ਬ††㭽ਊ††潣獮⁴牰敥据楨敭瑮䙯湩污㴠愠慶楬牡牐敥据楨敭瑮偯潲潰瑳獡瀨潲潰瑳獡潆呲浥汰瑡⥥਻††晩⠠牰敥据楨敭瑮䙯湩污瀮湥敤据慩⹳敬杮桴 ੻†††癡獩獯潃慴慣⹯異桳⸨⸮牰敥据楨敭瑮䙯湩污瀮湥敤据慩⥳਻††੽††潣獮⁴癡獩獯敒畳潭㴠䄠牲祡昮潲⡭ ††渠睥匠瑥愨楶潳䍳瑯捡潡洮灡⠨瑩浥 㸽匠牴湩⡧瑩浥簠⁼∢⸩牴浩⤨⸩楦瑬牥䈨潯敬湡⤩ †⤠਻††潣獮⁴敨摡牥慐汹慯⁤‽੻†††慩›潣慴潣獥䅉瑓瑡獵ਬ†††楦慮㩬瀠敲湥档浩湥潴楆慮ⱬ ††愠楶潳㩳愠楶潳剳獥浵Ɐ †素਻††潣獮⁴敨摡牥慖畬⁥‽湥潣敤效摡牥慐汹慯⡤敨摡牥慐汹慯⥤਻ †挠湯瑳漠瑵㴠爠湥敤䑲捯⡸整灭慬整慐桴‬潤䑣瑡⥡਻††潣獮⁴楨瑮㴠猠湡瑩穩䙥汩湥浡⡥潢祤昮汩湥浡䡥湩⁴籼怠慍慰潃慴慣彯笤牰橯瑥䍯摯杩絯Ⱡ∠慭慰损瑯捡潡⤢਻ †爠獥献瑥效摡牥∨ⵘ慍慰匭慴畴≳‬牰敥据楨敭瑮䙯湩污挮浯汰瑥⁯‿挢浯汰瑥≥㨠∠湩潣灭敬整⤢਻††晩⠠敨摡牥慖畬⥥笠 ††爠獥献瑥效摡牥∨ⵘ慍慰䐭瑥污敨≳‬敨摡牥慖畬⥥਻††੽††敲⹳敳䡴慥敤⡲䌢湯整瑮吭灹≥‬愢灰楬慣楴湯瘯摮漮数确汭潦浲瑡⵳景楦散潤畣敭瑮眮牯灤潲散獳湩浧⹬潤畣敭瑮⤢਻††敲⹳敳䡴慥敤⡲䌢湯整瑮䐭獩潰楳楴湯Ⱒ怠瑡慴档敭瑮※楦敬慮敭∽笤楨瑮⹽潤硣怢㬩 †爠瑥牵⁮敲⹳敳摮漨瑵㬩 素挠瑡档⠠牥⥲笠 †挠湯潳敬攮牲牯∨⽛灡⽩敧敮慲整洯灡ⵡ潣慴慣嵯攠牲≯‬牥⥲਻††敲畴湲爠獥献慴畴⡳〵⤰樮潳⡮⁻歯›慦獬ⱥ攠牲牯›䔢牲⁯潡朠牥牡漠䴠灡⁡敤䌠瑯썡쎧澣•⥽਻†੽⥽਻⼊⨪ⴠⴭⴭⴭ‭畊瑳晩捩瑡癩⁡慰慲䐠獩数獮⁡ⴭⴭⴭⴭ⨠ਯ潲瑵牥瀮獯⡴⼢番瑳晩捩瑡癩ⵡ楤灳湥慳Ⱒ愠祳据⠠敲ⱱ爠獥 㸽笠 琠祲笠 †挠湯瑳戠摯⁹‽敲⹱潢祤簠⁼絻਻††潣獮⁴牰橯㴠戠摯⹹牰橯簠⁼絻਻††潣獮⁴牰捯獥潳㴠戠摯⹹牰捯獥潳簠⁼絻਻ †挠湯瑳椠獮楴畴捩潡㴠⠠潢祤椮獮楴畴捩潡簠⁼牰橯椮獮楴畴捩潡簠⁼䔢䝄≅⸩潴瑓楲杮⤨਻††潣獮⁴湣橰湉瑳瑩極慣⁯‽戨摯⹹湣橰湉瑳瑩極慣⁯籼瀠潲⹪湣橰簠⁼∢⸩潴瑓楲杮⤨਻††潣獮⁴整浲偯牡散楲⁡‽戨摯⹹整浲⁯籼瀠潲⹪整浲偯牡散楲⁡籼∠⤢琮卯牴湩⡧㬩 †挠湯瑳瀠潲敪潴潎敭㴠⠠潢祤瀮潲敪潴簠⁼牰橯瀮潲敪潴潎敭簠⁼∢⸩潴瑓楲杮⤨਻††潣獮⁴牰橯瑥䍯摯杩⁯‽戨摯⹹潣楤潧牐橯瑥⁯籼瀠潲⹪牰橯瑥䍯摯杩⁯籼∠⤢琮卯牴湩⡧㬩 †挠湯瑳爠扵楲慣㴠⠠潢祤琮灩副扵楲慣簠⁼潢祤爮扵楲慣簠⁼牰捯獥潳渮瑡牵穥䑡獩⁰籼∠⤢琮卯牴湩⡧㬩 †挠湯瑳漠橢瑥⁯‽戨摯⹹扯敪潴簠⁼牰捯獥潳漮橢瑥⁯籼∠⤢琮卯牴湩⡧㬩 †挠湯瑳樠獵楴楦慣楴慶㴠⠠潢祤樮獵楴楦慣楴慶簠⁼牰捯獥潳樮獵楴楦慣楴慶簠⁼∢⸩潴瑓楲杮⤨਻††潣獮⁴慦潶敲楣潤㴠⠠潢祤昮癡牯捥摩⁯籼瀠潲散獳⹯慦潶敲楣潤潎敭簠⁼∢⸩潴瑓楲杮⤨਻††潣獮⁴湣橰慆⁶‽戨摯⹹湣橰慆⁶籼瀠潲散獳⹯慦潶敲楣潤潄⁣籼∠⤢琮卯牴湩⡧㬩 †挠湯瑳瘠污牯潃瑮慲潴㴠映瑭剂⡌潢祤瘮污牯簠⁼牰捯獥潳瘮污牯簠⁼∢㬩ਊ††潣獮⁴慰慧敭瑮䥯潳㴠瀠潲散獳⹯慤慴慐慧敭瑮䥯体簠⁼潢祤搮瑡偡条浡湥潴卉⁏籼瀠牡敳牂慄整潔獉⡯潢祤搮瑡偡条浡湥潴簠⁼∢㬩 †挠湯瑳搠瑡偡条浡湥潴㴠映瑭剂慄整瀨条浡湥潴獉⁯籼戠摯⹹慤慴慐慧敭瑮⁯籼∠⤢਻††潣獮⁴潬慣楬慤敤㴠⠠潢祤氮捯污摩摡⁥籼戠摯⹹硥牴獡⸿楣慤敤簠⁼䴢捡楥돃⤢琮卯牴湩⡧㬩 †挠湯瑳搠慩㴠戠摯⹹楤⁡籼∠㬢 †挠湯瑳洠獥㴠戠摯⹹敭⁳籼∠㬢 †挠湯瑳愠潮㴠戠摯⹹湡⁯籼∠㬢 †挠湯瑳挠潯摲湥摡牯㴠⠠潢祤挮潯摲湥摡牯簠⁼牰橯挮潯摲湥摡牯簠⁼∢⸩潴瑓楲杮⤨਻††潣獮⁴慤慴硅整獮⁯‽畢汩䑤瑡䕥瑸湥潳氨捯污摩摡ⱥ瀠条浡湥潴獉Ɐ搠慩‬敭ⱳ愠潮㬩ਊ††潣獮⁴整灭慬整慐桴㴠瀠瑡⹨潪湩吨䱐䩟单彔䥄ⱒ∠番瑳晩捩瑡癩彡楤灳湥慳搮捯≸㬩 †椠⁦ℨ獦攮楸瑳即湹⡣整灭慬整慐桴⤩笠 ††挠湯潳敬攮牲牯∨敔灭慬整愠獵湥整∺‬整灭慬整慐桴㬩 ††爠瑥牵⁮敲⹳瑳瑡獵㐨㐰⸩獪湯笨漠㩫映污敳‬牥潲㩲∠敔灭慬整渠ꏃ⁯湥潣瑮慲潤›番瑳晩捩瑡癩彡楤灳湥慳搮捯≸素㬩 †素ਊ††潣獮⁴楺⁰‽敮⁷楐婺灩昨⹳敲摡楆敬祓据琨浥汰瑡健瑡⥨㬩 †挠湯瑳搠捯浘偬瑡⁨‽眢牯⽤潤畣敭瑮砮汭㬢 †挠湯瑳映汩䕥瑮祲㴠稠灩昮汩⡥潤塣汭慐桴㬩 †椠⁦ℨ楦敬湅牴⥹笠 ††爠瑥牵⁮敲⹳瑳瑡獵㔨〰⸩獪湯笨漠㩫映污敳‬牥潲㩲∠敔灭慬整搠⁥番瑳晩捩瑡癩⁡湩썶没摩⹯•⥽਻††੽ †氠瑥砠汭㴠映汩䕥瑮祲愮味硥⡴㬩ਊ††潣獮⁴牰橯瑥䑯獩汰祡㴠瀠潲敪潴潃楤潧 ††㼠怠笤牰橯瑥乯浯⁥籼∠牐橯瑥≯⁽␨灻潲敪潴潃楤潧⥽੠†††›瀨潲敪潴潎敭簠⁼牰橯瑥䍯摯杩⁯籼∠胢⊔㬩ਊ††浸⁬‽敳呴扡敬慖畬⡥浸ⱬ∠湉瑳瑩極ꟃꏃ⁯硅捥瑵牯㩡Ⱒ椠獮楴畴捩潡簠⁼钀⤢਻††浸⁬‽敳呴扡敬慖畬⡥浸ⱬ∠乃䩐∺‬湣橰湉瑳瑩極慣⁯籼∠胢⊔㬩 †砠汭㴠猠瑥慔汢噥污敵砨汭‬吢牥潭搠⁥慐捲牥慩渠뫂∺‬整浲偯牡散楲⁡籼∠胢⊔㬩 †砠汭㴠猠瑥慔汢噥污敵砨汭‬倢潲敪潴∺‬牰橯瑥䑯獩汰祡簠⁼钀⤢਻††浸⁬‽敳呴扡敬慖畬⡥浸ⱬ∠慎畴敲慺搠⁥楄灳꫃摮潩∺‬畲牢捩⁡籼∠胢⊔㬩 †砠汭㴠猠瑥慐慲牧灡䅨瑦牥效摡湩⡧浸ⱬ∠扏敪潴搠⁡潣慴ꟃꏃ≯‬扯敪潴簠⁼钀⤢਻††浸⁬‽敳呴扡敬慖畬⡥浸ⱬ∠潆湲捥摥牯䌠湯牴瑡摡㩯Ⱒ映癡牯捥摩⁯籼∠胢⊔㬩 †砠汭㴠猠瑥慔汢噥污敵砨汭‬䌢偎⁊潤䌠湯牴瑡摡㩯Ⱒ挠灮䙪癡簠⁼钀⤢਻††浸⁬‽敳呴扡敬慖畬⡥浸ⱬ∠慖潬⁲潃瑮慲慴潤∺‬慶潬䍲湯牴瑡⁯籼∠胢⊔㬩 †砠汭㴠猠瑥慔汢噥污敵砨汭‬䐢瑡⁡慤䄠畱獩썩쎧澣∺‬慤慴慐慧敭瑮⁯籼∠胢⊔㬩 †砠汭㴠猠瑥慐慲牧灡䅨瑦牥效摡湩⡧浸ⱬ∠畊瑳晩捩瑡癩⁡慤搠獩数獮⁡慤挠瑯썡쎧澣Ⱒ樠獵楴楦慣楴慶簠⁼钀⤢਻ †砠汭㴠砠汭爮灥慬散ਨ†††弢彟彟彟彟ⱟ张彟 敤张彟彟彟彟彟搠⁥彟彟彟≟ਬ†††獥慣数浘⡬慤慴硅整獮⁯籼怠笤潬慣楬慤敤ⱽ钀搠⁥胢ₔ敤钀⥠ †⤠਻ †挠湯瑳愠獳湩瑡牵䵡杳㴠挠潯摲湥摡牯 ††㼠怠獁楳慮潤攠敬牴湯捩浡湥整瀠牯␠捻潯摲湥摡牯⹽੠†††›䄢獳湩摡⁯汥瑥潲楮慣敭瑮⹥㬢 †砠汭㴠猠瑥慐慲牧灡䅨瑦牥效摡湩⡧浸ⱬ∠獁楳慮畴慲攠渠浯⁥潤䌠潯摲湥摡牯Ⱒ愠獳湩瑡牵䵡杳‬⁻慦汬慢正›獡楳慮畴慲獍⁧⥽਻††浸⁬‽浸⹬敲汰捡⡥笢獡楳慮畴慲攠敬牴듃楮慣挠浯挠牥楴楦慣潤搠杩瑩污䤠偃≽‬∢㬩ਊ††楺⹰楦敬搨捯浘偬瑡ⱨ砠汭㬩ਊ††潣獮⁴畯⁴‽楺⹰敧敮慲整笨琠灹㩥∠潮敤畢晦牥•⥽਻††潣獮⁴楨瑮慂敳㴠戠摯⹹楦敬慮敭楈瑮簠⁼䩠獵楴楦慣楴慶⑟灻潲敪潴潃楤潧簠⁼牰橯瑥乯浯⁥籼∠楤灳湥慳索㭠 †挠湯瑳映汩湥浡⁥‽慳楮楴敺楆敬慮敭栨湩䉴獡ⱥ∠番瑳晩捩瑡癩彡楤灳湥慳⤢਻ †爠獥献瑥效摡牥∨潃瑮湥⵴祔数Ⱒ∠灡汰捩瑡潩⽮湶⹤灯湥浸晬牯慭獴漭晦捩摥捯浵湥⹴潷摲牰捯獥楳杮汭搮捯浵湥≴㬩 †爠獥献瑥效摡牥∨潃瑮湥⵴楄灳獯瑩潩≮‬慠瑴捡浨湥㭴映汩湥浡㵥␢晻汩湥浡絥搮捯≸⥠਻††敲畴湲爠獥献湥⡤畯⥴਻†⁽慣捴⁨攨牲 ੻††潣獮汯⹥牥潲⡲嬢愯楰术湥牥瑡⽥番瑳晩捩瑡癩ⵡ楤灳湥慳⁝牥潲Ⱒ攠牲㬩 †爠瑥牵⁮敲⹳瑳瑡獵㔨〰⸩獪湯笨漠㩫映污敳‬牥潲㩲∠牅潲愠⁯敧慲⁲⁡畊瑳晩捩瑡癩⁡慰慲䐠獩数獮≡素㬩 素紊㬩ਊ硥潰瑲搠晥畡瑬爠畯整㭲ਊ⨯㴠㴽㴽㴽㴽㴽㴽㴽㴽㴽‽伨捰潩慮⥬爠来獩牴⁯楤敲潴渠⁯灡⁰㴽㴽㴽㴽㴽㴽㴽㴽㴽㴽⨠ਯ硥潰瑲映湵瑣潩⁮敲楧瑳牥潄剣畯整⡳灡Ɒ笠⼠‪灯湥楡渠ꏃ⁯獵摡⁯煡極⨠ 䕔偍䅌䕔䉟十⁅⨯渠ꏃ⁯獵摡⁯煡極⨠ ⁽‽絻 ੻†⼯䴠湯慴漠爠畯整⁲楤敲慴敭瑮⁥潳⁢愯楰术湥牥瑡⁥慰慲焠敵愠⁳潲慴⁳湩整湲獡 ⼠ 搨晥湩摩獡挠浯⁯⼢潦桬ⵡ潲瑳≯‬⼢慭慰挭瑯捡潡•瑥⹣ 敳慪⁭敲潳癬摩獡 ⼠ 潣牲瑥浡湥整瀠汥⁯硅牰獥⹳唠慳⁲潲瑵牥栮湡汤⁥潣⁭⁯慣業桮⁯潣灭敬潴 ⼠ 慦楺⁡潣⁭畱⁥⁯牰晥硩⁯⼢灡⽩敧敮慲整•潣瑮湩慵獳⁥牰獥湥整攠⁭敲⹱牵ⱬ ⼠ 敲畳瑬湡潤攠⁭〴⸴ 愠灰甮敳∨愯楰术湥牥瑡≥‬潲瑵牥㬩紊
>>>>>>> 86d9a76 (fix: convert generateDocs.js from UTF-16 to UTF-8)
