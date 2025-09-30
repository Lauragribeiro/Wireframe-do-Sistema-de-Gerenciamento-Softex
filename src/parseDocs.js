// src/parseDocs.js
// PDF → texto (pdfjs-dist → pdf-parse → OCR com canvas+Tesseract),
// OCR de imagem, NF número curto, JUST do ofício, data do pagamento heurística,
// **NOVO**: número da NF com 9 dígitos (zeros à esquerda + máscara) e data de emissão.

import express from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import OpenAI from "openai";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const router = express.Router();
router.use(express.json({ limit: "20mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* ========== helpers base ========== */
const onlyDigits = (s) => (String(s || "").match(/\d+/g) || []).join("");
function mask9(nine){ return nine.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3"); }
const norm = (s = "") => String(s).replace(/\s+/g, " ").trim();

function logShort(label, text) {
  const t = String(text || "");
  console.log(label, "len:", t.length, "| head:", t.slice(0, 140).replace(/\s+/g, " "));
}

const toISO = (s) => {
  if (!s) return null;
  let m = String(s).match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = String(s).match(/(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/* ========== PATCH 1: helpers NF (XML e texto) ========== */
function nf9(n) {
  const nine = onlyDigits(n).padStart(9, "0").slice(-9);
  return { nf_num_9: nine, nf_num_9_mask: mask9(nine) };
}

// XML NF-e → número curto e data de emissão (<dhEmi> ou <dEmi>)
function extractFromXml(xmlStr = "") {
  const numRaw = (xmlStr.match(/<nNF>(\d+)<\/nNF>/) || [])[1] || "";
  const { nf_num_9, nf_num_9_mask } = nf9(numRaw);

  let data_emissao_iso = null;
  const mDh = xmlStr.match(/<dhEmi>([^<]+)<\/dhEmi>/);
  if (mDh && mDh[1]) {
    const d = new Date(mDh[1].trim());
    data_emissao_iso = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  } else {
    const mD = xmlStr.match(/<dEmi>([^<]+)<\/dEmi>/);
    if (mD && mD[1]) data_emissao_iso = mD[1].trim(); // já vem YYYY-MM-DD
  }
  return { nf_num_9, nf_num_9_mask, data_emissao_iso };
}

// PDF/DANFE/Imagem → data de emissão
function extractIssueFromText(txt = "") {
  const rx = [
    /data\s*de\s*emiss[aã]o\s*[:\-]?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i,
    /emiss[aã]o\s*[:\-]?\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i,
    /danfe[^\n]{0,40}emitid[ao]\s*em\s*(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/i
  ];
  for (const r of rx) {
    const m = txt.match(r);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

// PDF/DANFE/Imagem → número curto normalizado para 9 dígitos
function extractNF9FromText(txt = "") {
  const t = norm(txt);
  const m =
    t.match(/(?:n[úu]mero|n[ºo]|n°|no\.?)\s*(?:da\s*)?(?:nf-?e|nota\s*fiscal)[^\d]{0,15}(\d[\d\.\s]{1,20})/i) ||
    t.match(/nf-?e[^\d]{0,15}(\d[\d\.\s]{1,20})/i) ||
    t.match(/danfe[^\d]{0,15}(\d[\d\.\s]{1,20})/i);
  const raw = m ? onlyDigits(m[1]) : "";
  return nf9(raw);
}

/* ========== tipos corretos para cada lib ========== */
// SEMPRE entregar Uint8Array “puro” ao pdfjs-dist
function toUint8Array(input) {
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(Buffer.from(input));
}
// SEMPRE entregar Buffer do Node ao pdf-parse
function toNodeBuffer(input) {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

/* ========== PDF → texto (3 camadas) ========== */
async function pdfBufferToText_pdfjs(buffer) {
  const typed = toUint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: typed });
  const pdf = await loadingTask.promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const c = await page.getTextContent();
    text += c.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
}

async function pdfBufferToText_pdfparse(buffer) {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = mod.default || mod;
    const out = await pdfParse(toNodeBuffer(buffer));
    return out?.text || "";
  } catch (e) {
    console.warn("[pdf-parse] falhou:", e?.message);
    return "";
  }
}

// OCR de PDF escaneado (renderiza com pdfjs → reconhece com Tesseract). Requer `canvas`.
async function pdfBufferToText_ocr(buffer) {
  let canvasMod = null;
  try {
    canvasMod = await import("canvas"); // opcional
  } catch {
    return ""; // sem canvas instalado
  }
  const { createCanvas } = canvasMod.default || canvasMod;

  const typed = toUint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data: typed });
  const pdf = await loadingTask.promise;
  let full = "";

  const CanvasFactory = {
    create: (w, h) => {
      const canvas = createCanvas(w, h);
      const context = canvas.getContext("2d");
      return { canvas, context };
    },
    reset: (cf, w, h) => { cf.canvas.width = w; cf.canvas.height = h; },
    destroy: (cf) => { cf.canvas.width = 0; cf.canvas.height = 0; },
  };

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    const cf = CanvasFactory.create(viewport.width, viewport.height);
    const renderContext = {
      canvasContext: cf.context,
      viewport,
      canvasFactory: CanvasFactory,
    };
    await page.render(renderContext).promise;
    const pngBuffer = cf.canvas.toBuffer("image/png");
    const { data: { text } } = await Tesseract.recognize(pngBuffer, "por+eng");
    full += (text || "") + "\n";
    CanvasFactory.destroy(cf);
  }
  return full;
}

async function pdfBufferToText(buffer) {
  try {
    const t1 = await pdfBufferToText_pdfjs(buffer);
    if (t1 && t1.trim().length > 20) return t1;
  } catch (e) {
    console.warn("[pdfjs-dist] falhou:", e?.message);
  }
  const t2 = await pdfBufferToText_pdfparse(buffer);
  if (t2 && t2.trim().length > 20) return t2;

  const t3 = await pdfBufferToText_ocr(buffer);
  return t3 || "";
}

async function fileToText(file) {
  if (!file) return "";
  const mime = file.mimetype || "";
  try {
    if (mime.includes("pdf")) return await pdfBufferToText(file.buffer);
    if (mime.startsWith("image/")) {
      const { data: { text } } = await Tesseract.recognize(file.buffer, "por+eng");
      return text || "";
    }
  } catch (e) {
    console.warn("[parseDocs] falha lendo", file?.originalname, e?.message);
  }
  return "";
}

/* ========== extrações (regex) ========== */
// NF-e (número curto: 3–12 dígitos; nunca chave de 44) — legado p/ compat
function extractNF_local(text = "") {
  const t = norm(text);
  const cands = [
    /\b(?:nf[-\s]?e|nota\s+fiscal|danfe)\b[\s\S]{0,80}?\b(?:n[ºo]|no\.?|n[uú]mero)\b\s*[:\-]?\s*([0-9.\-]{3,20})/i,
    /\b(?:n[ºo]|no\.?|n[uú]mero)\b\s*(?:da\s*)?(?:nf[-\s]?e|nota\s+fiscal|nf)?\s*[:\-]?\s*([0-9.\-]{3,20})/i,
    /\bNF[-\s]?e?\b[^\d]{0,20}([0-9.\-]{3,20})/i,
  ];
  for (const rx of cands) {
    const m = t.match(rx);
    if (m && m[1]) {
      const d = (m[1] || "").replace(/[^\d]/g, "");
      if (d.length >= 3 && d.length <= 12) return d;
    }
  }
  return "";
}

// JUST do ofício
function extractJust_local(text = "") {
  const t = norm(text);
  let m = t.match(/\bJustificativa\b\s*[:\-]\s*(.+?)(?:\.\s+[A-ZÁÉÍÓÚ]|$)/i);
  if (m && m[1]) return m[1].trim();
  m = t.match(/([^.]{20,260}justific[aá][^\.]{0,260}\.)/i);
  if (m && m[1]) return m[1].trim();
  m = t.match(/\bSolicita(?:-se)?\b\s*[:\-]\s*(.{20,260}?\.)/i);
  return (m && m[1]) ? m[1].trim() : "";
}

/* ========== LLM (opcional: reforço) ========== */
function buildMessages({ nfText, oficioText }) {
  const system = {
    role: "system",
    content:
`Responda ESTRITAMENTE com JSON válido com TODAS as chaves:
{
  "cnpj": "",
  "nf": "",
  "nExtrato": "",
  "dataTitulo": "",
  "dataPagamento": "",
  "valor": null,
  "just": "",
  "pcNumero": "",
  "mesLabel": ""
}
Regras:
- "nf": somente o número curto da NF-e (3–12 dígitos). Nunca a CHAVE DE ACESSO (44 dígitos). Sem pontos/hífens.
- "just": frase curta do Ofício de Solicitação.
- Demais chaves vazias (""/null). Não invente dados.`
  };
  const user = {
    role: "user",
    content:
`#### NOTA FISCAL
${nfText || "(vazio)"}

#### OFÍCIO
${oficioText || "(vazio)"}`
  };
  return [system, user];
}

async function callLLM(messages) {
  if (!openai) return null;
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages
    });
    const txt = r?.choices?.[0]?.message?.content?.trim();
    if (!txt) return null;
    const m = txt.match(/\{[\s\S]*\}$/);
    const jsonStr = m ? m[0] : txt;
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn("[LLM] falhou:", e?.message);
    return null;
  }
}

/* ========== Heurística “Data do pagamento” (comprovante) ========== */
function pickPaymentDate(text = "") {
  const raw = String(text || "");
  const lower = raw.toLowerCase();

  const dateRegex = /(\d{2}[\/.\-]\d{2}[\/.\-]\d{4}|\d{4}[\/.\-]\d{2}[\/.\-]\d{2})/g;
  const dates = [];
  let m;
  while ((m = dateRegex.exec(raw))) {
    dates.push({ str: m[1], idx: m.index });
  }
  if (!dates.length) return null;

  const keys = ["data do pagamento", "pagamento", "pgto", "liquidação", "liquidacao", "compensação", "compensacao"];
  const keyPos = [];
  for (const k of keys) {
    let pos = -1;
    const lk = k.toLowerCase();
    while ((pos = lower.indexOf(lk, pos + 1)) !== -1) keyPos.push(pos);
  }
  if (!keyPos.length) return toISO(dates[0].str);

  let best = null;
  for (const d of dates) {
    let dist = Infinity;
    for (const kp of keyPos) dist = Math.min(dist, Math.abs(d.idx - kp));
    if (!best || dist < best.dist) best = { ...d, dist };
  }
  return toISO(best.str);
}

/* ========== /parse-docs (NF/Ofício) ========== */
router.post(
  "/parse-docs",
  upload.fields([
    { name: "nf", maxCount: 1 },
    { name: "oficio", maxCount: 1 },
    { name: "ordem", maxCount: 1 },
    { name: "cotacoes", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      const nfFile     = (req.files?.nf || [])[0];
      const oficioFile = (req.files?.oficio || [])[0];

      // === PATCH 2A: extrair número e data de emissão diretamente da NF
      let nfFields = { nf_num_9: null, nf_num_9_mask: null, data_emissao_iso: null };
      if (nfFile) {
        const name = (nfFile.originalname || "").toLowerCase();
        if (name.endsWith(".xml")) {
          const xml = nfFile.buffer.toString("utf-8");
          nfFields = extractFromXml(xml);
        } else {
          const maybeText = await fileToText(nfFile); // PDF/Imagem → texto
          const { nf_num_9, nf_num_9_mask } = extractNF9FromText(maybeText);
          const data_emissao_iso = extractIssueFromText(maybeText);
          nfFields = { nf_num_9, nf_num_9_mask, data_emissao_iso };
        }
      }

      // Ainda geramos os textos para logs/LLM/justificativa
      const nfText     = await fileToText(nfFile);
      const oficioText = await fileToText(oficioFile);

      logShort("[DBG] NF text", nfText);
      logShort("[DBG] Ofício text", oficioText);

      // Legado/compat: nf curto e just por heurística + LLM
      const localNF   = extractNF_local(nfText);
      const localJust = extractJust_local(oficioText);

      const llm = await callLLM(buildMessages({ nfText, oficioText }));

      let nfFinal = localNF;
      if (llm?.nf) {
        const n = onlyDigits(llm.nf);
        if (n.length >= 3 && n.length <= 12) nfFinal = n;
      }
      if (onlyDigits(nfFinal).length >= 14) nfFinal = localNF || "";

      const justFinal = (llm?.just?.trim?.()) || localJust || "";

      // === PATCH 2B: objeto final com novos campos e compatibilidade
      const data = {
        cnpj: "",
        nf: nfFinal || (nfFields.nf_num_9 ?? "") || "", // legado (sem máscara)
        nf_num_9: nfFields.nf_num_9,                   // "000071501"
        nf_num_9_mask: nfFields.nf_num_9_mask,         // "000.071.501"
        data_emissao_iso: nfFields.data_emissao_iso,   // "YYYY-MM-DD"
        nExtrato: "",
        dataTitulo: nfFields.data_emissao_iso || "",   // compat: front já usa dataTitulo
        dataPagamento: "",
        valor: null,
        just: justFinal,
        pcNumero: "",
        mesLabel: ""
      };

      console.log("[/parse-docs] => nf:", data.nf || "(vazio)", "| nf9:", data.nf_num_9_mask || "(—)", "| emissao:", data.data_emissao_iso || "(—)", "| just? ", !!data.just);
      return res.json({ ok: true, data });
    } catch (err) {
      console.error("parse-docs error", err);
      return res.status(500).json({ ok: false, message: "Erro ao processar documentos" });
    }
  }
);

/* ========== /extrair-documento-imagem (comprovante colado) ========== */
router.post("/extrair-documento-imagem", async (req, res) => {
  try {
    const { image_data_url } = req.body || {};
    if (!image_data_url) return res.status(400).send("image_data_url ausente");

    const base64 = String(image_data_url).split(",")[1];
    const buffer = Buffer.from(base64, "base64");

    const { data: { text } } = await Tesseract.recognize(buffer, "por+eng");
    const dateISO = pickPaymentDate(text);

    const mDoc = text.match(/(nr\.?\s*(?:do\s*)?documento|n[ºo]\s*(?:do\s*)?documento|nro\s*documento|nº\s*doc\.?|no\s*documento)\s*[:\-–]?\s*([A-Z0-9\-\.\/]{4,})/i);
    const nExtrato = mDoc ? mDoc[2].trim() : "";

    let valor = null;
    const mVal = text.replace(/\./g, "").match(/R?\$?\s*([0-9]+,[0-9]{2})/);
    if (mVal) {
      const v = parseFloat(mVal[1].replace(",", "."));
      if (!Number.isNaN(v)) valor = v;
    }

    let mes = null, ano = null;
    const mMY = text.match(/(\d{2})[\/\-](\d{4})/);
    if (mMY) { mes = parseInt(mMY[1], 10); ano = parseInt(mMY[2], 10); }

    console.log("[/extrair-documento-imagem] =>", { date: dateISO, nExtrato, valor, mes, ano });
    return res.json({
      data_pagamento: dateISO ? { iso: dateISO } : null,
      numero_extrato: nExtrato ? { raw: nExtrato } : null,
      valor_pago: valor != null ? { raw: String(valor).replace(".", ","), valor_pago_num: valor } : null,
      mes_ano_pagamento: (mes && ano) ? { mes, ano } : null
    });
  } catch (err) {
    console.error("extrair-documento-imagem error", err);
    return res.status(500).send("Erro ao extrair imagem");
  }
});

export default router;
