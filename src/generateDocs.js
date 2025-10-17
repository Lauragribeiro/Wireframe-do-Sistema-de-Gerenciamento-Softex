// src/generateDocs.js
import express from "express";
import fs from "fs";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

import { buildPayloadBase } from "./utils/docxPayload.js";
import { ensureFields, REQUIRED_MAPA, REQUIRED_FOLHA } from "./utils/templateGuards.js";

/** ===== OpenAI opcional (para extrair dados das cotações) ===== */
const hasOpenAI = !!process.env.OPENAI_API_KEY;
let OpenAI = null;
if (hasOpenAI) {
  try {
    OpenAI = (await import("openai")).default;
  } catch (_) {}
}

/* ========================= Utils ========================= */
const __dirnameLocal = path.resolve();

const TPL_FOLHA_DIR = path.join(__dirnameLocal, "src", "templates", "folha_rosto");
const TPL_MAPA_DIR  = path.join(__dirnameLocal, "src", "templates", "mapa");

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
function sanitizeFilename(name, fallback = "documento") {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
}
function renderDocx(templatePath, dataObj) {
  const buf = fs.readFileSync(templatePath);
  const zip = new PizZip(buf);

  // proteção leve contra espaços quebrando tags
  const docXmlPath = "word/document.xml";
  const f = zip.file(docXmlPath);
  if (f) {
    let xml = f.asText();
    xml = xml
      .replace(/\{{{+/g, "{{")
      .replace(/}}}+/g, "}}")
      .replace(/\{\{\s+/g, "{{")
      .replace(/\s+\}\}/g, "}}");
    zip.file(docXmlPath, xml);
  }

  try {
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.setData(dataObj);
    doc.render();
    return doc.getZip().generate({ type: "nodebuffer" });
  } catch (e) {
    const details = (e.properties?.errors || []).map(err => ({
      id: err.properties?.id,
      tag: err.properties?.xtag,
      file: err.properties?.file,
      context: err.properties?.context,
    }));
    console.error({ error: details.length ? details : e });
    throw e;
  }
}

/* ============== Helpers (únicas) para ler PDFs e extrair campos ============== */

// Lê texto de /data/uploads/<fileName>
async function readPdfTextFromUploads(fileName) {
  try {
    const full = path.join(__dirnameLocal, "data", "uploads", String(fileName));
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
function prettyFromFilename(name = "") {
  const base = String(name).replace(/\.[^.]+$/, "");
  const parts = base.split("-").filter(Boolean);
  const last = parts[parts.length - 1] || "";
  return last.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

// Constrói propostas a partir de uma lista de NOMES de arquivos
async function buildPropostasFromFilenames(names = []) {
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i]);
    const text = await readPdfTextFromUploads(name);
    const g = guessFromText(text);
    const fallbackFornecedor = g.ofertante || prettyFromFilename(name);
    out.push({
      selecao: `Cotação ${i + 1}`,
      ofertante: fallbackFornecedor || "",
      cnpj: g.cnpj_ofertante || "",
      cnpj_ofertante: g.cnpj_ofertante || "",
      data: g.data_cotacao || "",
      data_cotacao: g.data_cotacao || "",
      valor: g.valor || ""
    });
  }
  // se tudo vazio, retorna []
  return out.filter(p => p.ofertante || p.cnpj_ofertante || p.data_cotacao || p.valor);
}

/* ============ AI helper (opcional) para ler cotações ============ */
async function extractCotacoesWithAI(cotacoes = []) {
  if (!hasOpenAI || !OpenAI) return [];
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const joined = cotacoes
      .map((c, i) => `### COTAÇÃO ${i + 1} (${c.name})\n${(c.text || "").slice(0, 20000)}`)
      .join("\n\n");

    const sys = `Você extrairá dados estruturados de cotações comerciais.
Retorne um JSON com a lista "propostas", onde cada item possui:
- selecao
- ofertante
- cnpj
- dataCotacao (DD/MM/AAAA)
- valor (número em reais).`.trim();

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `A seguir estão os textos das cotações:\n\n${joined}\n\nExtraia os campos pedidos.` },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const json = JSON.parse(resp.choices[0].message.content || "{}");
    if (!Array.isArray(json.propostas)) return [];
    return json.propostas.slice(0, 10).map((p, idx) => ({
      selecao:  p.selecao || `Cotação ${idx + 1}`,
      ofertante:(p.ofertante || "").toString(),
      cnpj:     (p.cnpj || "").toString(),
      data:     fmtBRDate(p.dataCotacao || ""),
      valor:    typeof p.valor === "string" && p.valor.includes("R$") ? p.valor : fmtBRL(p.valor),
    }));
  } catch (err) {
    console.warn("[extractCotacoesWithAI] falhou, seguindo sem AI:", err?.message || err);
    return [];
  }
}

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

    const objetoDesc      = body.objetoDescricao || payload.objeto || "";
    const justBase        = body.justificativa || meta.justificativa || payload.justificativa || "";
    const dataPagamento   = fmtBRDate(body.dataPagamento || meta.dataPagamento || payload.dt_pagamento || "");
    const coordenadorNome = body.coordenadorNome || meta.coordenadorNome || "";

    // ==================== propostas ====================
    let propostas = Array.isArray(body.propostas) ? body.propostas : [];

    // 1) Se vieram NOMES dos arquivos no body.cotacoes (strings), extrai dos PDFs em data/uploads
    if (!propostas.length && Array.isArray(body.cotacoes) && body.cotacoes.every(x => typeof x === "string")) {
      try {
        const fromFiles = await buildPropostasFromFilenames(body.cotacoes);
        if (fromFiles.length) propostas = fromFiles;
      } catch (e) {
        console.warn("[mapa] buildPropostasFromFilenames falhou:", e?.message || e);
      }
    }

    // 2) (Opcional) Se vierem OBJETOS com {name,text} em docs.cotacoes, tente IA
    if (!propostas.length && Array.isArray(body?.docs?.cotacoes) && body.docs.cotacoes.length) {
      try {
        const parsed = await extractCotacoesWithAI(body.docs.cotacoes);
        if (parsed.length) propostas = parsed;
      } catch (e) {
        console.warn("[mapa] extractCotacoesWithAI falhou:", e?.message || e);
      }
    }

    // 3) Normalização final para o template
    propostas = (propostas || []).map((p, i) => {
      const cnpj = (p.cnpj || p.cnpj_ofertante || "").toString();
      const data = fmtBRDate(p.data || p.data_cotacao || p.dataCotacao || "");
      const valor = (typeof p.valor === "string" && p.valor.includes("R$")) ? p.valor : fmtBRL(p.valor);
      return {
        selecao: p.selecao || `Cotação ${i + 1}`,
        ofertante: p.ofertante || p.fornecedor || "",
        cnpj,                 // {cnpj}
        cnpj_ofertante: cnpj, // alias {cnpj_ofertante}
        data,                 // {data}
        data_cotacao: data,   // alias {data_cotacao}
        valor
      };
    });

    // 4) Fallback: se ainda vazio, crie linhas para renderizar a tabela
    if (!propostas.length) {
      if (Array.isArray(body.cotacoes) && body.cotacoes.length) {
        propostas = body.cotacoes.map((_, i) => ({
          selecao: `Cotação ${i + 1}`,
          ofertante: "",
          cnpj_ofertante: "",
          data_cotacao: "",
          valor: ""
        }));
      } else {
        propostas = [{ selecao:"—", ofertante:"—", cnpj_ofertante:"—", data_cotacao:"—", valor:"—" }];
      }
    }

    // ==================== rodapé ====================
    const hoje = dayjs();
    const localData = `Maceió, ${hoje.format("DD")} de ${hoje.format("MMMM")} de ${hoje.format("YYYY")}`;
    const complemento = " Seleção pautada pela melhor proposta e pelo custo-benefício, considerando conformidade técnica, prazo e valor.";
    const justificativa = (justBase || "") + complemento;

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
      objeto:           objetoDesc || "—",
      propostas,

      // rodapé
      data_aquisicao:   dataPagamento || "—",
      justificativa,
      local_data:       localData,
      coordenador_nome: coordenadorNome || "—",
    };

    const out = renderDocx(templatePath, docData);
    const hint = sanitizeFilename(body.filenameHint || `MapaCotacao_${projetoCodigo}`, "mapa_cotacao");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${hint}.docx"`);
    return res.send(out);
  } catch (err) {
    console.error("[/api/generate/mapa-cotacao] erro", err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar o Mapa de Cotação" });
  }
});

export default router;

/* ==================== (Opcional) registro direto no app ==================== */
export function registerDocRoutes(app, { /* openai não usado aqui */ TEMPLATE_BASE /* não usado aqui */ } = {}) {
  // Espelha as mesmas rotas do router sob o prefixo /api/generate
  app.post("/api/generate/folha-rosto", (req, res, next) => router.handle(req, res, next));
  app.post("/api/generate/mapa-cotacao", (req, res, next) => router.handle(req, res, next));
}
