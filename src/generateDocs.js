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
