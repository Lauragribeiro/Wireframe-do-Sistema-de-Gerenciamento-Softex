// src/parseDocs.js

import express from "express";
import multer from "multer";
import Tesseract from "tesseract.js";
import { ensureOpenAIClient, invalidateOpenAIClient } from "./openaiProvider.js";
import { extrairCotacoesDeTexto } from "./gptMapa.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import fs from "node:fs";

const router = express.Router();
router.use(express.json({ limit: "20mb" }));

/* ================= PDF.js Config (Node/ESM) ================= */
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/build/pdf.worker.mjs"
  );
  pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/standard_fonts/"
  );
  pdfjsLib.GlobalWorkerOptions.cMapUrl = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/cmaps/"
  );
  pdfjsLib.GlobalWorkerOptions.cMapPacked = true;

  if (typeof pdfjsLib.setVerbosity === "function") {
    pdfjsLib.setVerbosity(pdfjsLib.VerbosityLevel.ERROR);
  }
} catch (e) {
  console.warn("[pdfjs setup] falhou:", e?.message);
}

/* ================= Multer (memória) ================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const runMulter = (req, res) => new Promise((resolve, reject) => {
  upload.fields([
    { name: "nf", maxCount: 1 },
    { name: "oficio", maxCount: 1 },
    { name: "ordem", maxCount: 1 },
    { name: "cotacoes", maxCount: 10 },
  ])(req, res, (err) => {
    if (err) reject(err);
    else resolve();
  });
});

const runSingleTermo = (req, res) => new Promise((resolve, reject) => {
  // Se o express-fileupload já tratou o payload, reutilizamos o arquivo
  if (req.file) {
    return resolve();
  }

  if (req.files && Object.keys(req.files).length > 0) {
    const termo = req.files.termo;
    if (termo) {
      req.file = Array.isArray(termo) ? termo[0] : termo;
    }
    return resolve();
  }

  upload.single("termo")(req, res, (err) => {
    if (err) reject(err);
    else resolve();
  });
});

function normalizeIncomingFile(file) {
  if (!file) return null;

  const originalname =
    file.originalname ||
    file.name ||
    file.filename ||
    file.fileName ||
    file.fieldname ||
    "arquivo";

  const mimetype = file.mimetype || file.type || "";

  let buffer = null;
  if (file.buffer) {
    buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
  } else if (file.data) {
    buffer = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  } else if (file.tempFilePath) {
    try {
      buffer = fs.readFileSync(file.tempFilePath);
    } catch {
      buffer = null;
    }
  }

  if (!buffer) return null;

  const size = typeof file.size === "number" ? file.size : buffer.length;

  return { originalname, mimetype, buffer, size };
}

const ensureArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
};

async function collectFiles(req, res) {
  const hasExpressFiles = req.files && Object.keys(req.files).length > 0;

  if (!hasExpressFiles) {
    await runMulter(req, res);
  }

  const src = (req.files && Object.keys(req.files).length > 0) ? req.files : {};

  const normalizeGroup = (key) => ensureArray(src[key])
    .map(normalizeIncomingFile)
    .filter(Boolean);

  const nfList = normalizeGroup("nf");
  const oficioList = normalizeGroup("oficio");
  const ordemList = normalizeGroup("ordem");
  const cotList = normalizeGroup("cotacoes");

  return {
    nfFile: nfList[0] || null,
    oficioFile: oficioList[0] || null,
    ordemFile: ordemList[0] || null,
    cotacoes: cotList,
  };
}

/* ================= OpenAI (opcional) ================= */
let openai = ensureOpenAIClient();

/* ================= Helpers base ================= */
const onlyDigits = (s) => (String(s || "").match(/\d+/g) || []).join("");
const norm = (s = "") => String(s).replace(/\s+/g, " ").trim();
const clamp = (n, a, b) => Math.min(Math.max(n, a), b);
const mask9 = (nine) => nine.replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");

function toISO(s) {
  if (!s) return null;
  let m = String(s).match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = String(s).match(/(\d{4})[\/.\-](\d{2})[\/.\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function toBRDate(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/* ================= NF helpers ================= */
function nf9(n) {
  const nine = onlyDigits(n).padStart(9, "0").slice(-9);
  return { nf_num_9: nine, nf_num_9_mask: mask9(nine) };
}

// XML NF-e → número curto e data de emissão (<dhEmi> ou <dEmi>)
// XML NF-e → número curto e data (prioridade: Emissão → Saída)
function extractFromXml(xmlStr = "") {
  const numRaw = (xmlStr.match(/<nNF>(\d+)<\/nNF>/) || [])[1] || "";
  const { nf_num_9, nf_num_9_mask } = nf9(numRaw);

  // Emissão
  let data_emissao_iso = null;
  const mDhEmi = xmlStr.match(/<dhEmi>([^<]+)<\/dhEmi>/);
  if (mDhEmi && mDhEmi[1]) {
    const d = new Date(mDhEmi[1].trim());
    if (!isNaN(d.getTime())) {
      data_emissao_iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  if (!data_emissao_iso) {
    const mDEmi = xmlStr.match(/<dEmi>([^<]+)<\/dEmi>/);
    if (mDEmi && mDEmi[1]) data_emissao_iso = toISO(mDEmi[1].trim()) || mDEmi[1].trim();
  }

  // Saída (só se emissão não veio)
  if (!data_emissao_iso) {
    const mDhSai = xmlStr.match(/<dhSaiEnt>([^<]+)<\/dhSaiEnt>/);
    if (mDhSai && mDhSai[1]) {
      const d = new Date(mDhSai[1].trim());
      if (!isNaN(d.getTime())) {
        data_emissao_iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
    if (!data_emissao_iso) {
      const mDSai = xmlStr.match(/<dSaiEnt>([^<]+)<\/dSaiEnt>/);
      if (mDSai && mDSai[1]) data_emissao_iso = toISO(mDSai[1].trim()) || mDSai[1].trim();
    }
  }

  return { nf_num_9, nf_num_9_mask, data_emissao_iso };
}

// PDF/DANFE/Imagem → data de emissão (DD/MM/AAAA → YYYY-MM-DD)
// NF em texto → data (prioridade: Emissão → Saída), só a partir da NF
function extractIssueFromTextNF(txt = "") {
  if (!txt) return null;
  const t = String(txt).replace(/\s+/g, " ").toLowerCase();

  const anchorsEmissao = ["data da emissão", "data de emissão", "emissão", "emitido em", "emitida em"];
  const anchorsSaida   = ["data da saída", "data de saída", "saída"];
  const dateRx = /(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/g;

  // retorna a primeira data APÓS a âncora, num raio curto
  const findAfter = (anchors) => {
    for (const a of anchors) {
      let pos = t.indexOf(a);
      if (pos === -1) continue;
      // procura data nos próximos ~60 caracteres após a âncora
      const window = t.slice(pos, pos + 120);
      const m = window.match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    }
    return null;
  };

  // 1) Emissão
  let iso = findAfter(anchorsEmissao);
  if (iso) return iso;

  // 2) Saída
  iso = findAfter(anchorsSaida);
  if (iso) return iso;

  // 3) Fallback muito conservador: primeira data do documento (evita datas aleatórias)
  let m;
  while ((m = dateRx.exec(t))) {
    // ignore datas seguidas por palavras típicas que não são emissão/saída
    const tail = t.slice(m.index - 15, m.index + 15);
    if (!/venc|pag|protoc|receb|compet|em\s*\d{4}/.test(tail)) {
      return `${m[3]}-${m[2]}-${m[1]}`;
    }
  }
  return null;
}

// PDF/DANFE/Imagem → número curto da NF (ex.: "000.000.123")
function extractNF9FromText(txt = "") {
  if (!txt) return { nf_num_9: "", nf_num_9_mask: "" };
  const t = String(txt).replace(/\s+/g, " ");

  const nearNF = [
    /(?:nf[\s-]*e|nota\s*fiscal|danfe)[^]{0,80}?(?:n[º°o\.]|nro|no)\s*[:\-]?\s*([0-9.\s]{3,20})/i,
    /(?:n[º°o\.]|nro|no)\s*[:\-]?\s*([0-9.\s]{3,20})\s*(?:\/\s*serie|\bser[ií]e\b|(?:da)?\s*nf[\s-]*e|danfe)/i
  ];
  for (const rx of nearNF) {
    const m = t.match(rx);
    if (m && m[1]) {
      const d = m[1].replace(/[^\d]/g, "");
      if (d.length >= 3 && d.length <= 12) {
        const nine = d.padStart(9, "0").slice(-9);
        return { nf_num_9: nine, nf_num_9_mask: mask9(nine) };
      }
    }
  }

  const generic = /\b(?:nf[\s-]*e|danfe)\b[^]{0,60}?([\d.\s]{3,20})/i.exec(t);
  if (generic && generic[1]) {
    const d = generic[1].replace(/[^\d]/g, "");
    if (d.length >= 3 && d.length <= 12) {
      const nine = d.padStart(9, "0").slice(-9);
      return { nf_num_9: nine, nf_num_9_mask: mask9(nine) };
    }
  }

  return { nf_num_9: "", nf_num_9_mask: "" };
}

/* ================= Tipos para pdfjs/pdf-parse ================= */
function toUint8Array(input) {
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(Buffer.from(input));
}
function toNodeBuffer(input) {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

/* ================= PDF → texto (3 camadas) ================= */
async function pdfBufferToText_pdfjs(buffer) {
  const typed = toUint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data: typed,
    standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
    cMapUrl: pdfjsLib.GlobalWorkerOptions.cMapUrl,
    cMapPacked: true,
    useSystemFonts: true,
    disableFontFace: true,
  });
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
async function pdfBufferToText_ocr(buffer) {
  let canvasMod = null;
  try {
    canvasMod = await import("canvas"); // opcional
  } catch {
    return "";
  }
  const { createCanvas } = canvasMod.default || canvasMod;

  const typed = toUint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({
    data: typed,
    standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
    cMapUrl: pdfjsLib.GlobalWorkerOptions.cMapUrl,
    cMapPacked: true,
    useSystemFonts: true,
    disableFontFace: true,
  });
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
    const renderContext = { canvasContext: cf.context, viewport, canvasFactory: CanvasFactory };
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
    // textos/OFX/XML: devolve como string
    return file.buffer.toString("utf-8");
  } catch (e) {
    console.warn("[parseDocs] falha lendo", file?.originalname, e?.message);
  }
  return "";
}

/* ================= Extrações (regex/heurísticas) ================= */
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
function extractJust_local(text = "") {
  const t = norm(text);
  let m =
    t.match(/\bjustificativa(?:\s+para\s+(?:compra|aquisição))?\b\s*[:\-–]\s*(.{10,400}?)(?:\.($|\s[A-ZÁÉÍÓÚ]))/i) ||
    t.match(/([^.]{20,400}justific[aá][^.]{0,400}\.)/i) ||
    t.match(/\bsolicita(?:-se)?\b\s*[:\-–]\s*(.{20,400}?\.)/i);
  return (m && m[1]) ? m[1].trim() : "";
}

function maskDocBR(doc = "") {
  const digits = onlyDigits(doc);
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2}).*$/, "$1.$2.$3-$4");
  }
  return doc ? String(doc).trim() : "";
}

function parseMoneyToNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;
  const str = String(value)
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function collectMatches(regex, text) {
  if (!(regex instanceof RegExp)) return [];
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const matches = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    matches.push({ match: match[0], index: match.index });
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return matches;
}

function toISODateTermo(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  let m = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) {
    const [, y, mth, d] = m;
    return `${y.padStart(4, "0")}-${mth.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let [, d, mth, y] = m;
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    return `${y.padStart(4, "0")}-${mth.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

function analyseTermoOutorgaText(text = "") {
  const simplified = String(text || "").replace(/\s+/g, " ").trim();
  if (!simplified) {
    return {
      vigenciaRaw: "",
      vigenciaISO: null,
      valorMaximoRaw: "",
      valorMaximo: null,
    };
  }

  const lower = simplified.toLowerCase();
  const dateMatches = collectMatches(/(\d{4}[\/-]\d{1,2}[\/-]\d{1,2})|(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g, simplified);
  const valueMatches = collectMatches(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})*(?:,\d{2})/gi, simplified);

  const pickByKeyword = (matches, keywords) => {
    if (!matches.length) return null;
    let best = null;
    matches.forEach((item) => {
      const start = Math.max(0, item.index - 80);
      const end = Math.min(simplified.length, item.index + item.match.length + 80);
      const context = lower.slice(start, end);
      let score = 0;
      keywords.forEach((kw, idx) => {
        let re;
        if (kw instanceof RegExp) {
          const flags = kw.flags.replace(/g/g, "");
          re = new RegExp(kw.source, flags || "i");
        } else {
          re = new RegExp(String(kw), "i");
        }
        if (re.test(context)) score += (idx + 1) * 2;
      });
      if (score === 0) score = 1;
      if (!best || score > best.score || (score === best.score && item.index > best.index)) {
        best = { ...item, score };
      }
    });
    return best;
  };

  const chosenDate = pickByKeyword(dateMatches, [/(vig[êe]ncia|vigencia)/i, /(t[ée]rmino|termino|fim)/i, /(at[ée])/i]);
  const chosenValue = pickByKeyword(valueMatches, [/(valor|bolsa|limite|total|montante)/i]);

  const vigenciaRaw = chosenDate?.match || "";
  const vigenciaISO = vigenciaRaw ? toISODateTermo(vigenciaRaw) : null;

  const valorRaw = chosenValue?.match || "";
  const valorMaximo = valorRaw ? parseMoneyToNumber(valorRaw) : null;

  return {
    vigenciaRaw,
    vigenciaISO,
    valorMaximoRaw: valorRaw,
    valorMaximo: valorMaximo ?? null,
  };
}

function normalizeCotacaoProposta(entry, idx = 0) {
  if (!entry || typeof entry !== "object") return null;

  const selecaoRaw = String(entry.selecao ?? "").trim();
  const marcada = entry.selecionada === true || /selecionad/i.test(selecaoRaw);
  let selecao = selecaoRaw || (marcada ? "SELECIONADA" : "");
  if (!selecao) selecao = `Cotação ${idx + 1}`;
  if (marcada) selecao = "SELECIONADA";

  const ofertante = String(entry.ofertante ?? entry.fornecedor ?? entry.nome ?? "").trim() || "Não informado";

  const docRaw = String(
    entry.cnpj ?? entry.cnpj_ofertante ?? entry.cnpjCpf ?? entry.cnpj_cpf ?? entry.cpf ?? ""
  ).trim();
  const docMasked = maskDocBR(docRaw);
  const documento = docMasked || docRaw || "Não informado";

  const dataISO = toISO(
    entry.dataCotacao ?? entry.data_cotacao ?? entry.data ?? entry.dataCotacaoISO ?? entry.data_cotacao_iso ?? ""
  );
  const dataBR = dataISO
    ? toBRDate(dataISO)
    : (String(entry.dataCotacao ?? entry.data_cotacao ?? entry.data ?? "").trim() || "Não informado");

  const valorNum = parseMoneyToNumber(
    entry.valor_num ?? entry.valor ?? entry.valor_total ?? entry.total ?? entry.valorProposta ?? entry.preco
  );
  const valorLabel = String(entry.valor ?? entry.valor_total ?? entry.total ?? "").trim();

  const out = {
    selecao,
    ofertante,
    cnpj: documento,
    cnpj_ofertante: documento,
    dataCotacao: dataBR,
    data_cotacao: dataBR,
  };

  if (dataISO) out.data_cotacao_iso = dataISO;

  if (Number.isFinite(valorNum)) {
    out.valor = valorNum;
    out.valor_num = valorNum;
  } else {
    out.valor = valorLabel || "Não informado";
    out.valor_num = null;
  }

  if (!out.ofertante) out.ofertante = "Não informado";
  if (!out.cnpj) {
    out.cnpj = "Não informado";
    out.cnpj_ofertante = "Não informado";
  }
  if (!out.dataCotacao) {
    out.dataCotacao = "Não informado";
    out.data_cotacao = "Não informado";
  }
  if (out.valor === "") out.valor = "Não informado";

  return out;
}

async function analyzeCotacoesWithLLM(namedTexts = []) {
  if (!openai) openai = ensureOpenAIClient();
  if (!openai) return null;
  const sections = namedTexts
    .map((item, idx) => {
      const name = item?.name || `Cotação ${idx + 1}`;
      const text = String(item?.text || "").slice(0, 20000);
      if (!text.trim()) return null;
      return `### COTAÇÃO ${idx + 1} (${name})\n${text}`;
    })
    .filter(Boolean);

  if (!sections.length) return null;

  const system = {
    role: "system",
    content:
      "Você interpreta documentos de cotação brasileiros e deve extrair dados estruturados sem inventar informações." +
      "\nResponda apenas com JSON válido contendo as chaves:" +
      "\n{\n  \"objeto\": \"Descrição do item ou serviço comum entre as propostas\"," +
      "\n  \"propostas\": [" +
      "\n    {" +
      "\n      \"selecao\": \"Cotação X ou SELECIONADA\"," +
      "\n      \"ofertante\": \"Nome/Razão Social\"," +
      "\n      \"cnpj\": \"CNPJ ou CPF\"," +
      "\n      \"dataCotacao\": \"DD/MM/AAAA\"," +
      "\n      \"valor\": \"valor total em reais\"" +
      "\n    }" +
      "\n  ]," +
      "\n  \"avisos\": [\"Observações relevantes, se houver\"]\n}" +
      "\nSe um campo não estiver presente, retorne a string \"Não informado\"."
  };

  const user = {
    role: "user",
    content: `Documentos de cotação analisados:\n\n${sections.join("\n\n")}\n\nGere o JSON solicitado.`
  };

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [system, user],
    });
    const json = extractJsonSafe(resp?.choices?.[0]?.message?.content ?? "");
    if (!json) return null;
    const objeto = String(
      json.objeto ?? json.objeto_cotacao ?? json.objetoDescricao ?? json.objeto_descricao ?? ""
    ).trim();
    const avisos = Array.isArray(json.avisos) ? json.avisos.map((a) => String(a)) : [];
    const propostasRaw = Array.isArray(json.propostas) ? json.propostas : [];
    const propostas = propostasRaw
      .map((item, idx) => normalizeCotacaoProposta(item, idx))
      .filter(Boolean)
      .slice(0, 10);
    return {
      objeto: objeto || "Não informado",
      propostas,
      avisos,
    };
  } catch (err) {
    markOpenAIDisabledIfAuthError(err);
    console.warn("[LLM-cotacoes] falhou:", err?.message || err);
    return null;
  }
}

/* ================= LLM helpers ================= */
// Tenta extrair JSON mesmo que venha cercado por ```json ... ```
function markOpenAIDisabledIfAuthError(err) {
  const code = err?.status || err?.statusCode || err?.code || err?.error?.code;
  const msg  = String(err?.message || "").toLowerCase();
  if (code === 401 || code === "401" || msg.includes("incorrect api key") || msg.includes("invalid api key")) {
    invalidateOpenAIClient();
    openai = null;
  }
}

function extractJsonSafe(str) {
  if (!str) return null;
  let s = String(str).trim();

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) s = fenced[1].trim();

  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }

  s = s.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function callLLMJson(messages) {
  if (!openai) openai = ensureOpenAIClient();
  if (!openai) return null;
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    });
    const txt = r?.choices?.[0]?.message?.content ?? "";
    return extractJsonSafe(txt);
  } catch (e) {
    markOpenAIDisabledIfAuthError(e);
    console.warn("[LLM] falhou:", e?.message);
    return null;
  }
}

function messagesForDocs({ nfText, oficioText, ordemText, cotText }) {
  const system = {
    role: "system",
    content:
`Responda apenas com JSON válido com TODAS as chaves:
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
- "nf": apenas número curto (3–12 dígitos). Nunca a chave de 44 dígitos.
- "dataTitulo": data de emissão ou data de saída da nota fiscal (YYYY-MM-DD).
- "just": transcreva somente o trecho do documento "Ofício de Solicitação" que fundamenta a compra.
- Use vazio ("")/null quando não tiver certeza. Não invente.`
  };
  const user = {
    role: "user",
    content:
`##### NOTA FISCAL
${nfText || "(vazio)"}

##### OFÍCIO
${oficioText || "(vazio)"}

##### ORDEM
${ordemText || "(vazio)"}

##### COTAÇÕES
${cotText || "(vazio)"}
`};
  return [system, user];
}

/* ================= Heurística Data do pagamento (comprovante) ================= */
function pickPaymentDate(text = "") {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const dateRegex = /(\d{2}[\/.\-]\d{2}[\/.\-]\d{4}|\d{4}[\/.\-]\d{2}[\/.\-]\d{2})/g;
  const dates = [];
  let m;
  while ((m = dateRegex.exec(raw))) dates.push({ str: m[1], idx: m.index });
  if (!dates.length) return null;

  const keys = ["data do pagamento", "pagamento", "pgto", "liquidação", "liquidacao", "compensação", "compensacao"];
  const keyPos = [];
  for (const k of keys) {
    let pos = -1, lk = k.toLowerCase();
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

async function extractPurchaseDocData({ nfFile = null, oficioFile = null, ordemFile = null, cotacoes = [] } = {}) {
  // 1) Campos fortes diretamente da NF
  let nfFields = { nf_num_9: null, nf_num_9_mask: null, data_emissao_iso: null };
  if (nfFile) {
    const name = (nfFile.originalname || "").toLowerCase();
    if (name.endsWith(".xml")) {
      const xml = nfFile.buffer.toString("utf-8");
      nfFields = extractFromXml(xml);
    } else {
      const maybeText = await fileToText(nfFile); // PDF/Imagem → texto
      const { nf_num_9, nf_num_9_mask } = extractNF9FromText(maybeText);
      const data_emissao_iso = extractIssueFromTextNF(maybeText);
      nfFields = { nf_num_9, nf_num_9_mask, data_emissao_iso };
    }
  }

  // 2) Textos para heurísticas + LLM
  const nfText     = await fileToText(nfFile);
  const oficioText = await fileToText(oficioFile);
  const ordemText  = await fileToText(ordemFile);
  const cotList = Array.isArray(cotacoes) ? cotacoes : [];
  const cotEntries = await Promise.all(
    cotList.map(async (file, idx) => ({
      name: file?.originalname || `cotacao_${idx + 1}`,
      text: await fileToText(file),
    }))
  );
  const cotText    = cotEntries.map((c) => c.text || "").join("\n---\n");

  // heurísticas
  const localNF   = extractNF_local(nfText);
  const localJust = extractJust_local(`${oficioText}\n${ordemText}`);

  // 3) LLM (opcional)
  const llmRaw = await callLLMJson(messagesForDocs({ nfText, oficioText, ordemText, cotText }));
  const llm = (llmRaw && typeof llmRaw === "object" && llmRaw.data) ? llmRaw.data : (llmRaw || {});

  let cotacoesAI = null;
  if (cotEntries.length) {
    try {
      const analise = await extrairCotacoesDeTexto({
        instituicao: "",
        codigo_projeto: "",
        rubrica: "",
        lista_cotacoes_texto: cotText,
        cotacoes_arquivos: [],
        cotacoes_anexos: cotEntries.map((entry, idx) => `Cotação ${idx + 1}: ${entry.name}`).join("\n"),
      });
      if (analise && typeof analise === "object") {
        const avisos = Array.isArray(analise.avisos)
          ? analise.avisos.map((msg) => String(msg))
          : [];
        const propostas = Array.isArray(analise.propostas)
          ? analise.propostas
              .map((item, idx) => normalizeCotacaoProposta(item, idx))
              .filter(Boolean)
          : [];
        cotacoesAI = {
          objeto: String(analise.objeto_rascunho || analise.objeto || "").trim(),
          propostas,
          avisos,
        };
      }
    } catch (err) {
      console.warn("[parse-docs] extrairCotacoesDeTexto falhou:", err?.message || err);
    }
  }
  if (!cotacoesAI) {
    try {
      cotacoesAI = await analyzeCotacoesWithLLM(cotEntries);
    } catch (err) {
      console.warn("[parse-docs] analyzeCotacoesWithLLM falhou:", err?.message || err);
    }
  }
  if (cotacoesAI) {
    if (!Array.isArray(cotacoesAI.propostas)) cotacoesAI.propostas = [];
    if (!Array.isArray(cotacoesAI.avisos)) cotacoesAI.avisos = [];
    if (/^na[oã] informado$/i.test(String(cotacoesAI.objeto || ""))) {
      cotacoesAI.objeto = "";
    }
  }

  // 4) Merge — NF
  let nfFinal = null;
  if (nfFields.nf_num_9) {
    nfFinal = nfFields.nf_num_9;
  } else {
    const fromText = extractNF9FromText(nfText || "");
    nfFinal = fromText.nf_num_9 || onlyDigits(localNF) || onlyDigits(llm?.nf || "");
    if (nfFinal) nfFinal = String(nfFinal).padStart(9, "0").slice(-9);
  }
  const nfMask = nfFinal ? mask9(nfFinal) : null;

  // 4) Merge — Data do título
  let dataTituloISO =
    nfFields.data_emissao_iso ||                 // XML: dhEmi/dEmi → dhSaiEnt/dSaiEnt
    extractIssueFromTextNF(nfText || "");        // PDF/Imagem: Emissão → Saída

  if (!dataTituloISO && llm?.dataTitulo) {
    const fromLLM = toISO(llm.dataTitulo);
    if (fromLLM) dataTituloISO = fromLLM;
  }

  const dataTituloBR = toBRDate(dataTituloISO || "");

  // 4) Merge — Justificativa
  let justFinal = (localJust || "").trim();
  if (!justFinal && llm?.just) justFinal = String(llm.just).trim();

  const merged = {
    nf: nfFinal || "",
    nf_num_9: nfFinal || null,
    nf_num_9_mask: nfMask,
    nf_mask: nfMask || "",
    data_emissao_iso: dataTituloISO || "",
    dataTitulo: dataTituloBR || "",
    just: justFinal || "",
    // campos do comprovante vêm de outras rotas
    cnpj: (llm?.cnpj || "").trim(),
    pcNumero: (llm?.pcNumero || "").trim(),
  };

  if (cotacoesAI) {
    merged.cotacoes_objeto = cotacoesAI.objeto || "";
    merged.cotacoes_propostas = cotacoesAI.propostas || [];
    if (cotacoesAI.avisos?.length) merged.cotacoes_avisos = cotacoesAI.avisos;
    if (!merged.objeto && cotacoesAI.objeto) merged.objeto = cotacoesAI.objeto;
    if (!merged.propostas?.length && cotacoesAI.propostas?.length) merged.propostas = cotacoesAI.propostas;
  }

  // Fallback cruzado usando outros documentos se ainda faltou algo
  if (!merged.nf || !merged.data_emissao_iso) {
    const texts = [oficioText, ordemText, cotText].filter(Boolean).join("\n");
    if (!merged.nf) {
      const got = extractNF9FromText(texts);
      if (got?.nf_num_9) {
        merged.nf = got.nf_num_9;
        merged.nf_num_9 = got.nf_num_9;
        merged.nf_num_9_mask = got.nf_num_9_mask;
      }
    }
    if (!merged.data_emissao_iso) {
      const d = extractIssueFromTextNF(texts);
      if (d) {
        merged.data_emissao_iso = d;
        merged.dataTitulo = toBRDate(d);
      }
    }
  }

  // Se veio só "nf", derive máscara
  if (!merged.nf_num_9 && merged.nf) {
    const raw = onlyDigits(merged.nf);
    if (raw.length >= 3 && raw.length <= 12) {
      const nine = raw.padStart(9, "0").slice(-9);
      merged.nf_num_9 = nine;
      merged.nf_num_9_mask = mask9(nine);
    }
  }

  return merged;
}

/* ================= ROTA: /parse-termo-outorga ================= */
router.post("/parse-termo-outorga", async (req, res) => {
  try {
    await runSingleTermo(req, res);

    const expressFile = Array.isArray(req.files?.termo)
      ? req.files?.termo?.[0]
      : req.files?.termo;

    const file = (
      normalizeIncomingFile(req.file) ||
      normalizeIncomingFile(expressFile)
    );
    if (!file) {
      return res.status(400).json({ ok: false, message: "Arquivo do termo ausente ou inválido." });
    }

    const name = file.originalname || "termo.pdf";
    const mime = (file.mimetype || "").toLowerCase();
    if (!mime.includes("pdf") && !name.toLowerCase().endsWith(".pdf")) {
      return res.status(400).json({ ok: false, message: "Apenas arquivos PDF são aceitos." });
    }

    const rawText = await fileToText(file);
    const parsed = analyseTermoOutorgaText(rawText);

    return res.json({
      ok: true,
      data: {
        fileName: name,
        size: file.size,
        rawText,
        parsed,
      },
    });
  } catch (err) {
    console.error("[parse-termo-outorga]", err);
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ ok: false, message: "Arquivo excede o tamanho máximo de 25 MB." });
    }
    return res.status(500).json({ ok: false, message: "Erro ao processar termo de outorga." });
  }
});

/* ================= ROTA: /parse-docs (NF/Ofício/Ordem/Cotações) ================= */
router.post("/parse-docs", async (req, res) => {
  try {
    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      return res.status(400).json({ ok: false, message: "Conteúdo inválido (esperado multipart/form-data)" });
    }

    const { nfFile, oficioFile, ordemFile, cotacoes: cots } = await collectFiles(req, res);
    const data = await extractPurchaseDocData({ nfFile, oficioFile, ordemFile, cotacoes: cots });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error("parse-docs error", err);
    return res.status(500).json({ ok: false, message: "Erro ao processar documentos" });
  }
});

/* ================= ROTA: /extrair-documento-imagem (comprovante colado) ================= */
router.post("/extrair-documento-imagem", async (req, res) => {
  try {
    const { image_data_url } = req.body || {};
    if (!image_data_url) return res.status(400).send("image_data_url ausente");

    const base64 = String(image_data_url).split(",")[1];
    const buffer = Buffer.from(base64, "base64");
    const { data: { text } } = await Tesseract.recognize(buffer, "por+eng");

    if (openai) {
      const messages = [
        { role: "system", content:
`Responda apenas com JSON no formato:
{
  "data_pagamento":{"iso": "YYYY-MM-DD"},
  "numero_extrato":{"raw": "string"},
  "valor_pago":{"raw":"string","valor_pago_num": number|null},
  "mes_ano_pagamento":{"mes":"MM","ano":"YYYY"},
  "mes_ao_pagamento":{"mes":"MM","ano":"YYYY"}
}` },
        { role: "user", content: `Texto do comprovante:\n${text}` }
      ];
      const jRaw = await callLLMJson(messages);
      const j = (jRaw && typeof jRaw === "object" && jRaw.data) ? jRaw.data : jRaw;
      if (j) return res.json(j);
    }

    // Fallback heurístico local
    const iso = pickPaymentDate(text) || "";
    const mDoc = text.match(/(nr\.?\s*(?:do\s*)?documento|n[ºo]\s*(?:do\s*)?documento|nro\s*documento|nº\s*doc\.?|no\s*documento)\s*[:\-–]?\s*([A-Z0-9\-\.\/]{4,})/i);
    const nExtrato = mDoc ? mDoc[2].trim() : "";

    let valor = null;
    const mVal = text.replace(/\./g, "").match(/R?\$?\s*([0-9]+,[0-9]{2})/);
    if (mVal) {
      const v = parseFloat(mVal[1].replace(",", "."));
      if (!Number.isNaN(v)) valor = v;
    }
    const valRaw = (mVal && mVal[1]) ? mVal[1] : (valor != null ? String(valor).replace(".", ",") : "");

    let mes = null, ano = null;
    const mMY = text.match(/(\d{2})[\/\-](\d{4})/);
    if (mMY) { mes = clamp(parseInt(mMY[1], 10), 1, 12); ano = parseInt(mMY[2], 10); }

    return res.json({
      data_pagamento: { iso },
      numero_extrato: { raw: nExtrato || "" },
      valor_pago: { raw: valRaw || "", valor_pago_num: valor ?? null },
      mes_ao_pagamento: (mes && ano) ? { mes, ano } : null,
      mes_ano_pagamento: (mes && ano) ? { mes, ano } : null
    });
  } catch (err) {
    console.error("extrair-documento-imagem error", err);
    return res.status(500).send("Erro ao extrair imagem");
  }
});

/* ================= ROTA: /extrair-ofx (arquivo OFX) ================= */
router.post("/extrair-ofx", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "missing_file" });
    const text = req.file.buffer.toString("utf-8");

    if (openai) {
      const messages = [
        { role: "system", content:
`Você extrairá dados de um OFX. Responda apenas com JSON:
{
  "data_pagamento":{"iso":"YYYY-MM-DD"},
  "numero_extrato":{"raw":"string"},
  "valor_pago":{"raw":"string","valor_pago_num": number|null},
  "mes_ano_pagamento":{"mes":"MM","ano":"YYYY"},
  "mes_ao_pagamento":{"mes":"MM","ano":"YYYY"}
}` },
        { role: "user", content: text.slice(0, 180000) }
      ];
      const j = await callLLMJson(messages);
      if (j) return res.json(j);
    }

    // Fallback simples local (OFX)
    const get = (rx) => (text.match(rx) || [,""])[1].trim();
    let dt = get(/<DTPOSTED>(\d{8})/i);
    let iso = "";
    if (dt && dt.length === 8) iso = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;

    let valRaw = get(/<TRNAMT>(-?\d+[.,]?\d*)/i) || "";
    valRaw = valRaw.replace(",", ".");

    let nExtr = get(/<CHECKNUM>([^<]+)/i) || get(/<FITID>([^<]+)/i);

    const d = iso ? new Date(`${iso}T00:00:00`) : null;
    const mes = d ? String(d.getMonth() + 1).padStart(2, "0") : "";
    const ano = d ? d.getFullYear() : "";

    return res.json({
      data_pagamento: { iso },
      numero_extrato: { raw: nExtr || "" },
      valor_pago: { raw: valRaw || "", valor_pago_num: valRaw ? Number(valRaw) : null },
      mes_ano_pagamento: { mes, ano },
      mes_ao_pagamento: { mes, ano },
    });
  } catch (e) {
    console.error("[/extrair-ofx]", e);
    res.status(500).json({ ok: false, error: "extract_failed" });
  }
});

/* ================= ROTA: /pc/update-row (edição/salvar linha) ================= */
router.post("/pc/update-row", async (req, res) => {
  try {
    const row = req.body || {};
    const sane = {
      id: String(row.id || "").trim(),
      favorecido: String(row.favorecido || "").trim(),
      cnpj: String(row.cnpj || "").trim(),
      pcNumero: String(row.pcNumero || "").trim(),
      dataTitulo: toBRDate(toISO(row.dataTitulo) || row.data_emissao_iso || "") || "",
      data_emissao_iso: toISO(row.dataTitulo) || row.data_emissao_iso || "",
      nf: (onlyDigits(row.nf || row.nf_num_9 || "").padStart(9, "0").slice(-9)) || "",
      nf_num_9: null,
      nf_num_9_mask: null,
      nExtrato: String(row.nExtrato || row.numero_extrato || "").trim(),
      dataPagamento: toBRDate(toISO(row.dataPagamento) || (row.data_pagamento?.iso) || "") || "",
      valor: Number(row.valor || row.valor_pago_num || 0) || 0,
      tipoRubrica: String(row.tipoRubrica || row.tipo_rubrica || "").trim(),
      mesAno: String(row.mesAno || row.mesLabel || "").trim(),
      just: String(row.just || row.justificativa || "").trim(),
      docs: row.docs || null,
    };
    if (sane.nf) {
      sane.nf_num_9 = sane.nf;
      sane.nf_num_9_mask = mask9(sane.nf);
    }
    return res.json({ ok: true, data: sane });
  } catch (e) {
    console.error("[/pc/update-row] erro:", e);
    return res.status(500).json({ ok: false, message: "Falha ao atualizar linha" });
  }
});

export { extractPurchaseDocData };
export default router;
