// server.js — ESM (entrypoint único)
import "./src/envLoader.js";
import express, { Router } from "express";
import cors from "cors";
import helmet from "helmet";
import fileUpload from "express-fileupload";

import fs from "node:fs";
import fsp from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDocxBuffer } from "./src/utils/docxTemplate.js";

import {
  sanitizeDocxXml,
  normalizeDocxPlaceholders,
  renderDocxBuffer,
} from "./src/utils/docxTemplate.js";

import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

// Routers externos (mantidos; adiciono fallbacks mais abaixo)
import uploadsRouter                   from "./src/uploads.js";
import parseDocsRouter, { extractPurchaseDocData } from "./src/parseDocs.js";
import vendorsRouter                   from "./src/vendors.js";
// import purchasesRouter               from "./src/purchases.js"; // ⇐ NÃO usar (router interno abaixo)
import generateDocsRouter, { registerDocRoutes } from "./src/generateDocs.js";
import { ensureOpenAIClient, hasOpenAIKey, invalidateOpenAIClient } from "./src/openaiProvider.js";
import cnpjProxyRouter                 from "./src/cnpjProxy.js";

// __dirname helpers (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// Caminhos úteis
const PUB           = (...p) => join(__dirname, "public", ...p);
const DATA_DIR      = join(__dirname, "data");
const UPLOADS_DIR   = join(DATA_DIR, "uploads");
const PROJECTS_FILE = join(DATA_DIR, "projects.json");
const PURCHASES_FILE= join(DATA_DIR, "purchases.json");
const TEMPLATE_BASE = join(__dirname, "src", "templates");

// ===== OpenAI opcional =====
const hasOpenAI = hasOpenAIKey();
const useLegacyMapaRoute = process.env.LEGACY_MAPA === "1";

/* ========================================================================== *
 *  Preparação de diretórios
 * ========================================================================== */
async function ensureBaseDirs() {
  await fsp.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  await fsp.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});
}
await ensureBaseDirs();

/* ========================================================================== *
 *  purchasesRouter (interno, à prova de falhas)
 * ========================================================================== */
const purchasesRouter = Router();

async function ensurePurchasesFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(PURCHASES_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(PURCHASES_FILE, "[]", "utf8");
  }
}
async function readPurchases() {
  await ensurePurchasesFile();
  let raw = await fsp.readFile(PURCHASES_FILE, "utf8").catch(() => "[]");
  raw = (raw || "").trim();
  if (!raw) return [];
  let json;
  try { json = JSON.parse(raw); } catch { return []; }
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  if (json && typeof json === "object") return Object.values(json);
  return [];
}
async function writePurchases(list) {
  await ensurePurchasesFile();
  const clean = Array.isArray(list) ? list : [];
  await fsp.writeFile(PURCHASES_FILE, JSON.stringify(clean, null, 2), "utf8");
}

// LISTAR
purchasesRouter.get("/purchases", async (req, res) => {
  try {
    const qProject = String(req.query.projectId || "").trim();
    let list = await readPurchases();
    if (!Array.isArray(list)) list = [];

    // filtra por projeto, mas NUNCA injeta valores do formulário atual
    const dataRaw = qProject
      ? list.filter((x) => String(x?.projectId ?? "") === qProject)
      : list;

    const data = await Promise.all(dataRaw.map((row) => presentPurchaseRow(row)));

    return res.json({ ok: true, data });
  } catch (e) {
    console.error("[purchases] GET erro:", e);
    return res.json({ ok: true, data: [] });
  }
});

// CRIAR/ATUALIZAR
purchasesRouter.post("/purchases", async (req, res) => {
  try {
    const fallbackProject =
      req.body?.projectId ??
      req.body?.projetoId ??
      req.body?.projId ??
      req.query?.projectId ??
      "";

    const incoming = await normalizePurchaseInput(req.body || {}, fallbackProject);
    let list = await readPurchases();
    if (!Array.isArray(list)) list = [];

    // garante id único caso venha vazio/duplicado
    if (!incoming.id) incoming.id = Date.now() + Math.floor(Math.random() * 1000);

    const idx = list.findIndex(x => String(x.id) === String(incoming.id));
    let stored;
    if (idx >= 0) {
      stored = mergeDefined(list[idx], incoming);
      list[idx] = stored;
    } else {
      stored = incoming;
      list.push(stored);
    }

    await writePurchases(list);
    return res.json({ ok: true, data: await presentPurchaseRow(stored) });
  } catch (e) {
    console.error("[purchases] POST erro:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
});

purchasesRouter.put("/purchases", async (req, res) => {
  try {
    const body = req.body || {};
    const projectId = String(
      body.projectId ?? body.projetoId ?? body.projId ?? ""
    ).trim();

    if (!projectId) {
      return res.status(400).json({ ok: false, error: "project_required" });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];

    let list = await readPurchases();
    if (!Array.isArray(list)) list = [];

    // remove entradas anteriores do mesmo projeto
    list = list.filter((item) => String(item?.projectId ?? "") !== projectId);

    const sanitized = await Promise.all(
      rows.map((row) => normalizePurchaseInput(row || {}, projectId, { assignId: true }))
    );

    list.push(...sanitized);
    await writePurchases(list);

    const response = await Promise.all(sanitized.map((row) => presentPurchaseRow(row)));

    return res.json({ ok: true, data: response });
  } catch (e) {
    console.error("[purchases] PUT erro:", e);
    return res.status(500).json({ ok: false, error: "save_failed" });
  }
});

/* ========================================================================== *
 *  Rota auxiliar: extração de CNPJ/CPF a partir de texto (fallback local)
 * ========================================================================== */
const docRouter = Router();
const reCNPJ = /(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})(?!\d)/g;
const reCPF  = /(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g;

docRouter.post("/parse/extract-docs", async (req, res) => {
  try {
    const text = req.body?.text || req.body?.ocrText || "";
    const found = new Set();
    (text.match(reCNPJ) || []).forEach(m => found.add(m));
    (text.match(reCPF)  || []).forEach(m => found.add(m));
    return res.json({ documentos: Array.from(found) });
  } catch (e) {
    console.error("[parse/extract-docs] erro:", e);
    return res.json({ documentos: [] });
  }
});

/* ========================================================================== *
 *  Helpers de persistência/normalização para projects.json
 * ========================================================================== */
async function readProjects() {
  try {
    const raw = await fsp.readFile(PROJECTS_FILE, "utf8");
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.data)) return json.data;
    return [];
  } catch {
    return [];
  }
}
async function writeProjects(list) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const clean = Array.isArray(list) ? list : [];
  await fsp.writeFile(PROJECTS_FILE, JSON.stringify({ data: clean }, null, 2), "utf8");
}
const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function toStringSafe(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v).trim();
  return "";
}

function normalizeDate(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
    return trimmed; // devolve como veio (o front lida com outros formatos)
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    if (value.iso) return normalizeDate(value.iso);
    if (value.data) return normalizeDate(value.data);
    if (value.date) return normalizeDate(value.date);
  }
  return "";
}

function normalizeMoney(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  if (typeof value === "object") {
    if (typeof value.valor_pago_num === "number") return value.valor_pago_num;
    if (typeof value.valor === "number") return value.valor;
    if (value.raw) return normalizeMoney(value.raw);
  }
  const str = String(value)
    .replace(/R\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = Number(str);
  return Number.isFinite(num) ? num : "";
}

function maskDocBR(doc = "") {
  const digits = onlyDigits(doc);
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*$/, "$1.$2.$3/$4-$5");
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2}).*$/, "$1.$2.$3-$4");
  return toStringSafe(doc);
}

function safeParseJSON(value) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function parsePropostasList(body = {}) {
  const sources = [];
  if (Array.isArray(body.propostas)) sources.push(body.propostas);
  const propJson = safeParseJSON(body.propostas_json || body.propostasJSON);
  if (Array.isArray(propJson)) sources.push(propJson);
  if (Array.isArray(body.cotacoes_propostas)) sources.push(body.cotacoes_propostas);
  const cotJson = safeParseJSON(body.cotacoes_propostas_json || body.cotacoesJson);
  if (Array.isArray(cotJson)) sources.push(cotJson);
  if (Array.isArray(body.mapaPropostas)) sources.push(body.mapaPropostas);

  const rawList = sources.find((arr) => Array.isArray(arr) && arr.length) || [];
  const normalized = [];

  rawList.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;

    const selecaoRaw = toStringSafe(item.selecao ?? (item.selecionada ? "SELECIONADA" : ""));
    const ofertante = toStringSafe(item.ofertante ?? item.fornecedor ?? item.nome);
    const doc = maskDocBR(item.cnpj ?? item.cnpj_ofertante ?? item.cnpjCpf ?? item.cnpj_cpf ?? item.cpf);
    const dataISO = normalizeDate(
      item.dataCotacao ?? item.data_cotacao ?? item.data ?? item.dataCotacaoISO ?? item.data_cotacao_iso
    );
    const valorNum = normalizeMoney(
      item.valor_num ?? item.valor ?? item.preco ?? item.total ?? item.valor_proposta
    );

    const proposal = {
      selecao: selecaoRaw || (item.selecionada ? "SELECIONADA" : `Cotação ${idx + 1}`),
      ofertante,
      cnpj: doc,
      cnpj_ofertante: doc,
      data_cotacao: dataISO || toStringSafe(item.data_cotacao ?? item.dataCotacao ?? item.data),
    };

    if (dataISO) proposal.data_cotacao_iso = dataISO;

    if (typeof valorNum === "number" && Number.isFinite(valorNum)) {
      proposal.valor = valorNum;
      proposal.valor_num = valorNum;
    } else {
      const rawValor = toStringSafe(item.valor ?? item.preco ?? item.total ?? item.valor_proposta);
      proposal.valor = rawValor;
      if (typeof item.valor_num === "number" && Number.isFinite(item.valor_num)) {
        proposal.valor_num = item.valor_num;
      } else {
        proposal.valor_num = null;
      }
    }

    normalized.push(proposal);
  });

  return normalized;
}

function normalizeDocs(body = {}) {
  const src = body.docs || body.documentacao || body.documentos || {};
  const ordemVal = src.ordem ?? src.ordem_fornecimento ?? src.ordemFornecimento ?? null;
  const docs = {
    nf: src.nf ?? src.notaFiscal ?? body.docNf ?? null,
    oficio: src.oficio ?? src.oficio_solicitacao ?? null,
    ordem: ordemVal,
    ordem_fornecimento: src.ordem_fornecimento ?? ordemVal,
    comprovante: src.comprovante ?? src.pagamento ?? null,
    folhaAssinada: src.folhaAssinada ?? src.folha_assinada ?? body.folhaAssinada ?? null,
    decisaoAssinada:
      src.decisaoAssinada ??
      src.decisao_assinada ??
      src.mapaAssinado ??
      src.mapa_assinado ??
      src.justificativaAssinada ??
      src.justificativa_assinada ??
      body.decisaoAssinada ??
      body.mapaAssinado ??
      body.justificativaAssinada ??
      null,
    cotacoes: Array.isArray(src.cotacoes)
      ? src.cotacoes
      : Array.isArray(body.cotacoes)
      ? body.cotacoes
      : [],
  };
  return docs;
}

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".ofx": "application/x-ofx",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function guessMimeFromPath(filePath = "") {
  const ext = extname(String(filePath || "")).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

async function loadDocFile(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.buffer && entry.buffer.length) return entry;
  const filePath =
    entry.path || entry.filepath || entry.fullpath || entry.tempFilePath || entry.dest || entry.destination;
  if (!filePath) return null;
  try {
    const buffer = await fsp.readFile(filePath);
    const mimetype = entry.mimetype || guessMimeFromPath(filePath);
    const originalname = entry.originalname || entry.name || entry.filename || filePath.split(/[/\\]/).pop();
    return { ...entry, buffer, mimetype, originalname };
  } catch (err) {
    console.warn("[purchases] falha ao ler arquivo de doc:", filePath, err?.message || err);
    return null;
  }
}

async function extractDocsMetadata(docs) {
  if (!docs || typeof docs !== "object") return null;
  const nfFile = await loadDocFile(docs.nf);
  const oficioFile = await loadDocFile(docs.oficio);
  const ordemFile = await loadDocFile(docs.ordem || docs.ordem_fornecimento);
  const cotacoes = Array.isArray(docs.cotacoes)
    ? (await Promise.all(docs.cotacoes.map(loadDocFile))).filter(Boolean)
    : [];

  if (!nfFile && !oficioFile && !ordemFile && !cotacoes.length) return null;

  try {
    return await extractPurchaseDocData({ nfFile, oficioFile, ordemFile, cotacoes });
  } catch (err) {
    console.warn("[purchases] falha ao extrair metadados dos documentos:", err?.message || err);
    return null;
  }
}

function buildMesLabel(rawLabel, isoFromPayment = "") {
  const base = toStringSafe(rawLabel);
  if (base) {
    const mm = base.match(/^(\d{1,2})\/(\d{4})$/);
    if (mm) {
      const idx = Number(mm[1]) - 1;
      return MONTH_LABELS[idx] ? `${MONTH_LABELS[idx]}/${mm[2]}` : base;
    }
    return base;
  }
  if (!isoFromPayment) return "";
  const d = new Date(`${isoFromPayment}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTH_LABELS[d.getMonth()]}/${d.getFullYear()}`;
}

function labelToMesAno(label = "") {
  const txt = toStringSafe(label);
  if (!txt) return "";
  const mm = txt.match(/^(\d{1,2})\/(\d{4})$/);
  if (mm) return `${mm[1].padStart(2, "0")}/${mm[2]}`;
  const parts = txt.split("/");
  if (parts.length === 2) {
    const idx = MONTH_LABELS.findIndex((m) => m.toLowerCase() === parts[0].toLowerCase());
    if (idx >= 0) return `${String(idx + 1).padStart(2, "0")}/${parts[1]}`;
  }
  return txt;
}

async function normalizePurchaseInput(body = {}, fallbackProjectId = "", opts = {}) {
  const assignId = opts.assignId ?? true;

  const idRaw = body.id ?? body.ID ?? body._id;
  const projectRaw =
    body.projectId ?? body.projetoId ?? body.projId ?? fallbackProjectId ?? "";

  let dataTitulo = normalizeDate(
    body.dataTitulo ?? body.data_titulo ?? body.data_titulo_nf ?? body.data_emissao_iso
  );
  let nf = toStringSafe(
    body.nf ?? body.nf_recibo ?? body.nfNumero ?? body.numeroNf ?? body.recibo ?? body.nf_num_9_mask ?? body.nf_num_9
  );
  let just = toStringSafe(
    body.just ?? body.justificativa ?? body.justificativaCompra ?? body.justificativa_para_compra
  );
  const nExtrato = toStringSafe(
    body.nExtrato ?? body.numero_extrato ?? body.numeroExtrato ?? body.n_extrato ?? body.extrato
  );
  const dataPagamento = normalizeDate(
    body.dataPagamento ?? body.data_pagamento ?? body.data_pagamento?.iso ?? body.data_pagto
  );
  const valor = normalizeMoney(
    body.valor ?? body.valor_pago ?? body.valorPago ?? body.valor_pagamento ?? body.valor_pago_num
  );
  const rubrica = toStringSafe(
    body.rubrica ?? body.tipo_rubrica ?? body.tipoRubrica ?? body.naturezaDisp
  );
  const mesAnoInput = toStringSafe(body.mesAno ?? body.mes_ano ?? "");
  const mesLabel = buildMesLabel(
    body.mesLabel ?? body.mes_label ?? mesAnoInput,
    dataPagamento
  );
  const mesAno = mesAnoInput || labelToMesAno(mesLabel);

  const docs = normalizeDocs(body);

  let objetoBase = toStringSafe(
    body.objeto ??
    body.objetoDescricao ??
    body.cotacaoObjeto ??
    body.cotacoes_objeto ??
    body.objeto_cotacao ??
    body.objeto_rascunho ??
    body.objetoMapa ??
    body.objetoDescricaoMapa ??
    ""
  );
  if (/^na[oã] informado$/i.test(objetoBase)) objetoBase = "";
  const propostasList = parsePropostasList(body);
  const cotAvisosSrc = body.cotacoesAvisos ?? body.cotacoes_avisos;
  const cotacoesAvisos = Array.isArray(cotAvisosSrc)
    ? cotAvisosSrc.map((v) => toStringSafe(v)).filter(Boolean)
    : [];

  const out = {
    favorecido: toStringSafe(body.favorecido ?? body.favorecidoNome ?? body.nomeFavorecido),
    cnpj: toStringSafe(body.cnpj ?? body.cnpjFav ?? body.favorecidoDoc),
    pcNumero: toStringSafe(body.pcNumero ?? body.numeroPc ?? body.n_pc),
    dataTitulo,
    nf,
    nExtrato,
    dataPagamento,
    valor,
    rubrica,
    mesLabel,
    mesAno,
    just,
    docs,
    objeto: objetoBase,
    cotacaoObjeto: objetoBase,
    cotacoes_objeto: objetoBase,
    objetoDescricao: objetoBase,
    propostas: propostasList,
    cotacoes_propostas: propostasList,
  };

  if (assignId || idRaw != null) {
    const id = idRaw != null ? String(idRaw) : String(Date.now() + Math.floor(Math.random() * 1000));
    out.id = id;
  }
  if (projectRaw) out.projectId = String(projectRaw);

  if ((!dataTitulo || !nf || !just) && docs && typeof docs === "object") {
    const meta = await extractDocsMetadata(docs);
    if (meta) {
      if (!dataTitulo) {
        const iso = normalizeDate(meta.data_emissao_iso ?? meta.dataTitulo);
        if (iso) {
          dataTitulo = iso;
          out.dataTitulo = iso;
        }
      }
      if (!nf) {
        const nfCandidate =
          meta.nf_num_9_mask ??
          meta.nf_num_9 ??
          meta.nf_num ??
          meta.nf_num_mask ??
          meta.nf ??
          "";
        const nfVal = toStringSafe(nfCandidate);
        if (nfVal) {
          nf = nfVal;
          out.nf = nfVal;
        }
      }
      if (!just) {
        const justVal = toStringSafe(meta.just);
        if (justVal) {
          just = justVal;
          out.just = justVal;
        }
      }
    }
  }

  // aliases para compatibilidade
  out.dataTitulo = dataTitulo;
  out.data_titulo = dataTitulo;
  out.data_emissao_iso = out.data_emissao_iso ?? dataTitulo;
  out.data_emissao = out.data_emissao ?? dataTitulo;
  out.nf = nf;
  out.nf_recibo = nf;
  out.nf_num = out.nf_num ?? nf;
  out.nf_num_mask = out.nf_num_mask ?? nf;
  out.nf_num_9 = out.nf_num_9 ?? nf;
  out.nf_num_9_mask = out.nf_num_9_mask ?? nf;
  if (!out.nf_mask && out.nf_num_9_mask) out.nf_mask = out.nf_num_9_mask;
  out.justificativa = just;
  out.justificativa_para_compra = out.justificativa_para_compra ?? just;
  out.numero_extrato = nExtrato;
  out.data_pagamento = dataPagamento;
  out.valor_pago = valor;
  out.valorPago = out.valorPago ?? valor;
  if (out.valor_pago_num == null) {
    if (typeof valor === "number") out.valor_pago_num = valor;
    else if (valor) {
      const parsed = Number(valor);
      out.valor_pago_num = Number.isFinite(parsed) ? parsed : null;
    } else {
      out.valor_pago_num = null;
    }
  }
  out.tipo_rubrica = rubrica;
  out.tipoRubrica = out.tipoRubrica ?? rubrica;
  out.mesLabel = mesLabel;
  out.mesAno = mesAno;
  out.mes_ano = mesAno;
  out.docs = docs;

  if (cotacoesAvisos.length) {
    out.cotacoesAvisos = cotacoesAvisos;
    out.cotacoes_avisos = cotacoesAvisos;
  }

  return out;
}

// merge que preserva objetos aninhados
function mergeDefined(prev = {}, incoming = {}) {
  const out = Array.isArray(prev) ? [...prev] : { ...prev };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      prev &&
      typeof prev[key] === "object" &&
      !Array.isArray(prev[key])
    ) {
      out[key] = mergeDefined(prev[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function presentPurchaseRow(row = {}) {
  const normalized = await normalizePurchaseInput(row, row.projectId ?? row.projetoId ?? "", {
    assignId: false,
  });
  // valores normalizados devem sobrescrever para garantir campos exigidos
  const merged = { ...row, ...normalized };
  if (merged.id == null && normalized.id != null) merged.id = normalized.id;
  if (merged.projectId == null && normalized.projectId != null) merged.projectId = normalized.projectId;
  return merged;
}

/* ========================================================================== *
 *  App & Middlewares
 * ========================================================================== */
const app = express();

// Segurança/CORS
app.use(helmet({ frameguard: false, contentSecurityPolicy: false }));
app.use(cors());

// ⚠️ fileUpload PRECISA vir ANTES dos parsers para evitar "Unexpected end of form"
app.use(fileUpload({
  createParentPath: true,
  useTempFiles: false,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  abortOnLimit: true,
  safeFileNames: true,
  preserveExtension: true
}));

// Body parsers (agora depois do fileUpload)
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Timeout mais folgado para OCR/parse
app.use((req, _res, next) => { req.setTimeout?.(120000); next(); });

// Logs leves
app.use((req, _res, next) => {
  if (req.url.startsWith("/api")) {
    const small = ["GET", "HEAD"].includes(req.method);
    console.log(`${req.method} ${req.url}${small ? "" : " (payload recebido)"}`);
  }
  next();
});

// Estáticos
app.use(express.static(PUB()));
app.use("/styles",  express.static(join(__dirname, "styles")));
app.use("/src",     express.static(join(__dirname, "src")));
app.use(
  "/vendor/pdfjs",
  express.static(join(__dirname, "node_modules", "pdfjs-dist", "build"))
);
app.use("/uploads", express.static(UPLOADS_DIR));

/* ========================================================================== *
 *  Uploads — endpoints compatíveis com o front
 *    - /api/upload           (single/multi; campo "file" ou qualquer nome)
 *    - /api/uploads/single   (fallback)
 *    - /api/uploads/cotacoes (múltiplos)
 * ========================================================================== */
function normalizeIncomingFiles(req) {
  if (!req.files || Object.keys(req.files).length === 0) return [];
  const arr = [];
  for (const key of Object.keys(req.files)) {
    const v = req.files[key];
    if (Array.isArray(v)) arr.push(...v);
    else arr.push(v);
  }
  return arr;
}

app.post("/api/upload", async (req, res) => {
  try {
    const files = normalizeIncomingFiles(req);
    if (!files.length) return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado." });
    const saved = [];
    for (const f of files) {
      const name = Date.now() + "-" + (f.name || "arquivo");
      const dest = join(UPLOADS_DIR, name);
      await f.mv(dest);
      saved.push({ name, url: `/uploads/${encodeURIComponent(name)}`, path: dest });
    }
    return res.json({ ok: true, files: saved });
  } catch (e) {
    console.error("[/api/upload] erro:", e);
    const isBusboy = /Unexpected end of form/i.test(String(e?.message || ""));
    return res.status(isBusboy ? 400 : 500).json({ ok: false, message: isBusboy ? "Upload incompleto." : "Falha no upload." });
  }
});

const uploadFallback = Router();
uploadFallback.post("/uploads/single", async (req, res) => {
  try {
    const files = normalizeIncomingFiles(req);
    if (!files.length) return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado." });
    const f = files[0];
    const name = Date.now() + "-" + (f.name || "arquivo");
    const dest = join(UPLOADS_DIR, name);
    await f.mv(dest);
    return res.json({ ok: true, files: [{ name, url: `/uploads/${encodeURIComponent(name)}`, path: dest }] });
  } catch (e) {
    console.error("[upload:single] erro:", e);
    return res.status(500).json({ ok: false, message: "Falha no upload." });
  }
});
uploadFallback.post("/uploads/cotacoes", async (req, res) => {
  try {
    const files = normalizeIncomingFiles(req);
    if (!files.length) return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado." });
    const saved = [];
    for (const f of files) {
      const name = Date.now() + "-" + (f.name || "cotacao.pdf");
      const dest = join(UPLOADS_DIR, name);
      await f.mv(dest);
      saved.push({ name, url: `/uploads/${encodeURIComponent(name)}`, path: dest });
    }
    return res.json({ ok: true, files: saved });
  } catch (e) {
    console.error("[upload:cotacoes] erro:", e);
    return res.status(500).json({ ok: false, message: "Falha no upload." });
  }
});

/* ========================================================================== *
 *  Rotas de Projects (listar/criar/editar/excluir)
 * ========================================================================== */
app.get("/api/projects", async (_req, res) => {
  const list = await readProjects();
  res.json({ ok: true, data: list });
});
app.post("/api/projects", async (req, res) => {
  const body = req.body || {};
  const data = normalizeProjectInput(body);
  if (!data.titulo || !data.vigenciaInicio || !data.vigenciaFim) {
    return res.status(400).json({
      ok: false,
      message: "Campos obrigatórios: título, vigência (início) e vigência (fim).",
    });
  }
  const list = await readProjects();
  const novo = {
    id: Date.now(),
    ...data,
    responsavel: data.gerente ?? body.responsavel ?? "",
    createdAt: new Date().toISOString(),
  };
  list.unshift(novo);
  await writeProjects(list);
  res.json({ ok: true, data: novo });
});
app.get("/api/projects/:id", async (req, res) => {
  const id = String(req.params.id);
  const list = await readProjects();
  const proj = list.find((p) => String(p.id) === id);
  if (!proj) return res.status(404).json({ ok: false, message: "Projeto não encontrado" });
  res.json({ ok: true, data: proj });
});
app.put("/api/projects/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const list = await readProjects();
    const idx = list.findIndex((p) => String(p.id) === id);
    if (idx < 0) return res.status(404).json({ ok: false, message: "Projeto não encontrado" });

    const incoming = normalizeProjectInput(req.body || {});
    const curr = list[idx];
    const updated = {
      ...curr,
      ...incoming,
      responsavel: (incoming.gerente ?? curr.gerente) ?? curr.responsavel ?? null,
      status: curr.status ?? "pendente",
      instituicao: curr.instituicao ?? "EDGE",
      updatedAt: new Date().toISOString(),
    };
    if (!updated.titulo || String(updated.titulo).trim() === "") {
      return res.status(400).json({ ok: false, message: "Título é obrigatório" });
    }
    list[idx] = updated;
    await writeProjects(list);
    res.json({ ok: true, data: updated });
  } catch (err) {
    console.error("[projects:PUT] error:", err);
    res.status(500).json({ ok: false, message: err?.message || "Falha ao atualizar projeto" });
  }
});
app.delete("/api/projects/:id", async (req, res) => {
  try {
    const id = String(req.params.id);
    const list = await readProjects();
    const idx = list.findIndex((p) => String(p.id) === id);
    if (idx < 0) return res.status(404).json({ ok: false, message: "Projeto não encontrado" });

    const removed = list.splice(idx, 1)[0];
    await writeProjects(list);
    res.json({ ok: true, data: { id: removed.id } });
  } catch (err) {
    console.error("[projects:DELETE] error:", err);
    res.status(500).json({ ok: false, message: "Falha ao excluir projeto" });
  }
});

/* ========================================================================== *
 *  Registro de routers e rotas de geração de documentos
 * ========================================================================== */
app.use("/api", uploadFallback);      // fallbacks de upload
app.use("/api", uploadsRouter);
app.use("/api", parseDocsRouter);
app.use("/api", vendorsRouter);
app.use("/api", purchasesRouter);     // interno (este arquivo)
// app.use("/api/generate", generateDocsRouter);     // ❌ desabilitar
// registerDocRoutes(app, { openai, TEMPLATE_BASE }); // ❌ desabilitar
app.use("/api", cnpjProxyRouter);
app.use("/api", docRouter);

// Expor base de templates e registrar rotas de geração (seu módulo)
const openai = ensureOpenAIClient();
if (!useLegacyMapaRoute) {
  console.log("[mapa] rota aprimorada de geração habilitada.");
}
registerDocRoutes(app, { openai, TEMPLATE_BASE });

/* ========================================================================== *
 *  Depuração de templates
 * ========================================================================== */
app.get("/api/debug/templates", (_req, res) => {
  const dirs = [ join(TEMPLATE_BASE, "folha_rosto"), join(TEMPLATE_BASE, "mapa") ];
  const listing = {};
  for (const d of dirs) {
    try { listing[d] = fs.readdirSync(d); } catch (e) { listing[d] = `NÃO ENCONTREI (${e.message})`; }
  }
  res.json({ TEMPLATE_BASE, listing });
});

/* ========================================================================== *
 *  Renderização DOCX (helpers locais)
 * ========================================================================== */
function readTemplateBuffer(rel) {
  const full = join(TEMPLATE_BASE, rel);
  if (!fs.existsSync(full)) {
    const msg = `Template não encontrado: ${full}`;
    console.error(msg);
    throw new Error(msg);
  }
  return fs.readFileSync(full);
}
function renderDocxFromTemplate(templateRelPath, data, forceDelims = "auto") {
  const buf = readTemplateBuffer(templateRelPath);
  const forced = forceDelims === "single" || forceDelims === "double"
    ? forceDelims
    : undefined;

  try {
    return renderDocxBuffer(buf, data, { forceDelimiters: forced });
  } catch (err) {
    console.error("[renderDocxFromTemplate] erro ao renderizar template", templateRelPath, err);
    throw err;
  }
}

/* ===================== Helpers (formatação PT-BR) ===================== */
function fmtBRDate(s) {
  if (!s) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(s))) return String(s);
  const d = dayjs(s);
  return d.isValid() ? d.format("DD/MM/YYYY") : String(s);
}
function fmtBRL(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string" && v.trim().startsWith("R$")) return v;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : String(v);
}
function todayParts() {
  const d = dayjs();
  return { localidade: "Maceió", dia: d.format("DD"), mes: d.format("MMMM"), ano: d.format("YYYY") };
}

/* === NORMALIZAÇÃO DE PROPOSTAS (aceita aliases do front) ================ */
function normalizePropostas(arr = []) {
  let menorIdx = -1, menorVal = Number.POSITIVE_INFINITY, jaTemSelecionada = false;
  const out = (arr || []).map((p, i) => {
    const ofertante      = String(p.ofertante || p.fornecedor || p.nome || "");
    const cnpj_ofertante = String(p.cnpj_ofertante || p.cnpj || p.cpf || p.cnpjCpf || "");
    const data_raw       = p.data_cotacao || p.data || p.dataCotacao || p.dataCotacaoBR || "";
    const data_cotacao   = fmtBRDate(data_raw);
    const valor_raw = p.valor || p.preco || p.total || p.valorBR || "";
    const valor     = (typeof valor_raw === "string" && valor_raw.includes("R$")) ? valor_raw : fmtBRL(valor_raw);
    const selecionada = !!(p.selecionada || p.selecao === "SELECIONADA" || p.selecao === "Selecionada" || p.selecao === "SIM");
    if (selecionada) jaTemSelecionada = true;
    const n = (typeof valor_raw === "number") ? valor_raw : Number(String(valor_raw).replace(/\./g,"").replace(",",".")); 
    if (Number.isFinite(n) && n < menorVal) { menorVal = n; menorIdx = i; }
    return {
      selecao: selecionada ? "SELECIONADA" : (p.selecao || `Cotação ${i + 1}`),
      ofertante,
      cnpj_ofertante,
      data_cotacao,
      valor,
      cnpj: cnpj_ofertante || p.cnpj || p.cpf || p.cnpjCpf || "",
      data: data_cotacao || p.data || p.dataCotacao || p.dataCotacaoBR || ""
    };
  });
  if (!jaTemSelecionada && menorIdx >= 0 && out[menorIdx]) out[menorIdx].selecao = "SELECIONADA";
  return out.filter(p => p.ofertante || p.cnpj_ofertante || p.data_cotacao || p.valor);
}

/* ===================== Leitura de PDFs e heurísticas ===================== */
async function pdfToTextFromBuffer(buf) {
  if (!buf || !buf.length) return "";
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buf);
    return (data?.text || "").replace(/\u0000/g, " ").trim();
  } catch (e) {
    console.warn("[pdf-parse] falhou:", e?.message || e);
    return "";
  }
}
async function ensureCotacoesText(cotacoes = []) {
  const out = [];
  for (const c of (cotacoes || [])) {
    let name = "cotacao.pdf";
    let url  = "";
    let text = "";
    if (typeof c === "string") { name = c; }
    else if (c && typeof c === "object") {
      name = String(c?.name || c?.filename || c?.fileName || name);
      url  = String(c?.url  || "");
      text = String(c?.text || "");
    }
    if (!text) {
      let buf = null;
      if (!buf && c && typeof c === "object" && c?.base64) {
        try { const b64 = c.base64.replace(/^data:.*;base64,/, ""); buf = Buffer.from(b64, "base64"); } catch {}
      }
      if (!buf && c && typeof c === "object" && c?.path && fs.existsSync(c.path)) {
        try { buf = fs.readFileSync(c.path); } catch {}
      }
      if (!buf && c && typeof c === "object" && c?.filename) {
        const clean = String(c.filename)
          .replace(/^https?:\/\/[^/]+\//i, "")
          .replace(/^uploads\//i, "")
          .replace(/^\/+/, "")
          .split(/[\\/]/)
          .pop();
        if (clean) {
          const p = join(process.cwd(), "data", "uploads", clean);
          if (fs.existsSync(p)) { try { buf = fs.readFileSync(p); } catch {} }
        }
      }
      if (!buf && url) {
        try {
          const base = `http://localhost:${process.env.PORT || 3000}`;
          const u = new URL(url, base);
          if (u.pathname.startsWith("/uploads/")) {
            const file = decodeURIComponent(u.pathname.split("/").pop());
            const p = join(process.cwd(), "data", "uploads", file);
            if (fs.existsSync(p)) buf = fs.readFileSync(p);
          }
        } catch {}
      }
      if (!buf && typeof c === "string") {
        const clean = String(c)
          .replace(/^https?:\/\/[^/]+\//i, "")
          .replace(/^uploads\//i, "")
          .replace(/^\/+/, "")
          .split(/[\\/]/)
          .pop();
        const p = clean ? join(process.cwd(), "data", "uploads", clean) : null;
        if (p && fs.existsSync(p)) { try { buf = fs.readFileSync(p); } catch {} }
      }
      if (buf) text = await pdfToTextFromBuffer(buf);
    }
    out.push({ name, text: text || "" });
  }
  return out;
}

async function extractFromCotacoesWithAI({ instituicao = "", rubrica = "", cotacoes = [] } = {}) {
  if (!hasOpenAI) return { objeto: "", propostas: [] };
  try {
    const client = ensureOpenAIClient();
    if (!client) return { objeto: "", propostas: [] };
    const blocks = (cotacoes || [])
      .map((c, idx) => {
        const name = c?.name || c?.filename || c?.fileName || `Cotacao_${idx + 1}`;
        const text = String(c?.text || "").slice(0, 20000);
        return `### COTAÇÃO ${idx + 1} (${name})\n${text}`;
      })
      .filter(Boolean);

    if (!blocks.length) return { objeto: "", propostas: [] };

    const prompt = `Instituição: ${instituicao || ""}\nRubrica: ${rubrica || ""}\n\nAnalise as cotações a seguir e retorne um JSON com os campos {\n  "objeto": string,\n  "propostas": [ {\"selecao\", \"ofertante\", \"cnpj\", \"dataCotacao\", \"valor\"} ]\n}.\n\n${blocks.join("\n\n")}`;

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "Você extrai dados estruturados de cotações comerciais e responde em JSON válido." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
    });

    const raw = resp.output_text || "{}";
    let data;
    try { data = JSON.parse(raw); } catch { data = {}; }

    const objeto = typeof data.objeto === "string" ? data.objeto.trim() : "";
    const propostas = Array.isArray(data.propostas)
      ? data.propostas.map((p, idx) => ({
          selecao: p.selecao || `Cotação ${idx + 1}`,
          ofertante: p.ofertante || "",
          cnpj_ofertante: p.cnpj_ofertante || p.cnpj || "",
          data_cotacao: fmtBRDate(p.dataCotacao || p.data_cotacao || p.data || ""),
          valor: fmtBRL(p.valor || p.valorBR || ""),
        }))
      : [];

    return { objeto, propostas };
  } catch (err) {
    const code = err?.status || err?.statusCode || err?.code;
    const msg  = String(err?.message || "").toLowerCase();
    if (code === 401 || code === "401" || msg.includes("incorrect api key") || msg.includes("invalid api key")) {
      invalidateOpenAIClient();
    }
    console.warn("[mapa] extractFromCotacoesWithAI falhou:", err?.message || err);
    return { objeto: "", propostas: [] };
  }
}
function guessFieldsFromText(txt = "") {
  const text = String(txt || "");
  const rxCNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
  const rxCPF  = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
  const cnpj   = (text.match(rxCNPJ) || [])[0] || "";
  const cpf    = !cnpj ? (text.match(rxCPF) || [])[0] : "";
  const docNum = cnpj || cpf || "";
  const rxDate = /\b([0-3]?\d)\/([01]?\d)\/(\d{2}|\d{4})\b/g;
  let dataCot = "";
  for (const m of text.matchAll(rxDate)) {
    const dd = +m[1], mm = +m[2];
    if (dd>=1 && dd<=31 && mm>=1 && mm<=12) { dataCot = m[0]; break; }
  }
  const rxBRL = /R?\$?\s*\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
  let valor = "", max = -1;
  for (const m of text.matchAll(rxBRL)) {
    const raw = m[0].replace(/[^\d,]/g, "");
    const n = Number(raw.replace(/\./g,"").replace(",", "."));
    if (Number.isFinite(n) && n > max) { max = n; valor = m[0].trim().replace(/^R?\$?\s*/, "R$ "); }
  }
  let ofertante = "";
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const cnpjIdx = lines.findIndex(l => rxCNPJ.test(l));
  if (cnpjIdx > 0) {
    for (let i = Math.max(0, cnpjIdx - 3); i <= cnpjIdx; i++) {
      const L = lines[i];
      const m = L.match(/raz[aã]o social\s*[:\-–]\s*(.+)/i);
      if (m) { ofertante = m[1].trim(); break; }
    }
  }
  if (!ofertante) {
    const m = text.match(/raz[aã]o social\s*[:\-–]\s*(.+)/i);
    if (m) ofertante = m[1].split(/\r?\n/)[0].trim();
  }
  return { ofertante, cnpj_ofertante: fmtBRDate(docNum) ? "" : docNum, data_cotacao: fmtBRDate(dataCot), valor: valor || "" };
}

/* ---- Endpoints diretos (mantidos antes do generateDocsRouter) ---- */
// FOLHA DE ROSTO
app.post("/api/generate/folha-rosto", (req, res) => {
  console.log("Payload recebido em folha-rosto.");
  try {
    const b = req.body || {};
    const isVertex = String(b?.instituicao || "").toUpperCase() === "VERTEX";
    const templateName = isVertex ? "folha_rosto/folha_rosto_vertex.docx" : "folha_rosto/folha_rosto_edge.docx";
    const naturezaDisp = (
      b?.processo?.tipo_rubrica || b?.tipoRubrica || b?.rubrica || b?.prestacao || b?.naturezaDisp || ""
    ).toString().trim();
    const data = {
      instituicao:    b.instituicao || "",
      projeto_codigo: b.proj?.projetoCodigo || b.projetoCodigo || b.codigo || "",
      projeto_nome:   b.proj?.projetoNome   || b.projeto       || b.titulo || "",
      pc_numero:      b.processo?.pcNumero  || b.numeroPc || b.pc_numero || "",
      natureza_disp:  naturezaDisp,
      rubrica:        naturezaDisp,
      favorecido:     b.favorecido || b.processo?.favorecidoNome || "",
      cnpj:           b.cnpjFav    || b.processo?.favorecidoDoc  || b.cnpj || "",
      n_extrato:      b.extrato || b.numeroExtrato || b.n_extrato || "",
      nf_recibo:      b.nf || b.processo?.nfNumero || b.nf_recibo || "",
      data_emissao:   b.dataEmissao   || b.processo?.nfDataEmissaoISO || b.data_emissao || "",
      data_pagamento: b.dataPagamento || b.processo?.dataPagamentoISO  || b.data_pagamento || "",
      valor_pago:     b.valor || b.valorPago || b.processo?.valorTotalBR || "",
    };
    const buffer = renderDocxFromTemplate(templateName, data, "double");
    res
      .set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .set("Content-Disposition", `attachment; filename="folha_rosto_${isVertex ? "vertex" : "edge"}.docx"`)
      .send(buffer);
  } catch (err) {
    console.error("[folha] erro:", err);
    res.status(500).type("text/plain; charset=utf-8")
      .send("*** Folha de Rosto (FALLBACK) *** Template não encontrado ou com erro.\n\n" + String(err?.message || err));
  }
});

// MAPA DE COTAÇÃO
if (useLegacyMapaRoute) {
  console.warn("[mapa] LEGACY_MAPA=1 habilitado — utilizando rota legada /api/generate/mapa-cotacao.");
  app.post("/api/generate/mapa-cotacao", async (req, res) => {
    console.log("Payload recebido em mapa-cotacao.");
    try {
      const b = req.body || {};
      const isVertex = String(b?.instituicao || "").toUpperCase() === "VERTEX";
      const templateName = isVertex ? "mapa/mapa_vertex.docx" : "mapa/mapa_edge.docx";
      const rubrica = (
        b?.processo?.tipo_rubrica || b?.tipoRubrica || b?.rubrica || b?.prestacao || b?.naturezaDisp || ""
      ).toString().trim();

      const frontPropsRaw = Array.isArray(b.propostas) ? b.propostas : [];
      let propostas = normalizePropostas(frontPropsRaw);
      let objeto = String(b.objeto || b.objetoDescricao || b.processo?.objeto || "");
      if (objeto && rubrica && objeto.trim().toLowerCase() === rubrica.trim().toLowerCase()) objeto = "";

      const cotacoesInput =
        (Array.isArray(b?.docs?.cotacoes) ? b.docs.cotacoes : null) ??
        (Array.isArray(b?.cotacoes) ? b.cotacoes : []);
      const cotacoes = cotacoesInput.length ? await ensureCotacoesText(cotacoesInput) : [];
      console.log("[mapa] cotacoes:", cotacoes.map(c => c.name));

      if ((!propostas || propostas.length === 0) && cotacoes.length > 0) {
        const guessed = cotacoes.map((c, i) => ({ selecao: `Cotação ${i + 1}`, ...guessFieldsFromText(c.text) }));
        propostas = normalizePropostas(guessed);
      }
      if ((!propostas || propostas.length === 0) && cotacoes.length > 0) {
        propostas = cotacoes.map((_, i) => ({ selecao: `Cotação ${i + 1}`, ofertante: "", cnpj_ofertante: "", data_cotacao: "", valor: "" }));
      }
      if (hasOpenAI && cotacoes.length && (!objeto || !propostas.length)) {
        const { objeto: aiObj, propostas: aiProps } = await extractFromCotacoesWithAI({ instituicao: b.instituicao || "", rubrica, cotacoes });
        if (!objeto && aiObj) objeto = aiObj;
        if (!propostas.length && aiProps?.length) propostas = aiProps;
        else if (aiProps?.length) {
          const L = Math.min(propostas.length, aiProps.length);
          for (let i = 0; i < L; i++) {
            const p = propostas[i] || {};
            const a = aiProps[i] || {};
            propostas[i] = {
              selecao:        p.selecao        || a.selecao        || `Cotação ${i + 1}`,
              ofertante:      p.ofertante      || a.ofertante      || "",
              cnpj_ofertante: p.cnpj_ofertante || a.cnpj_ofertante || a.cnpj || "",
              data_cotacao:   p.data_cotacao   || a.data_cotacao   || a.data || "",
              valor:          p.valor          || a.valor          || a.valorBR || "",
            };
          }
          if (aiProps.length > propostas.length) propostas = propostas.concat(aiProps.slice(propostas.length));
        }
      }

      const MIN_ROWS = 3;
      while (propostas.length < MIN_ROWS) {
        propostas.push({ selecao: `Cotação ${propostas.length + 1}`, ofertante: "", cnpj_ofertante: "", data_cotacao: "", valor: "" });
      }
      const propsForTemplate = (Array.isArray(propostas) ? propostas : []).map((p, i) => ({
        selecao:         p.selecao || `Cotação ${i + 1}`,
        ofertante:       p.ofertante || p.fornecedor || "",
        cnpj_ofertante:  p.cnpj_ofertante || p.cnpj || p.cpf || p.cnpjCpf || "",
        cnpj:            p.cnpj || p.cnpj_ofertante || p.cpf || p.cnpjCpf || "",
        data_cotacao:    p.data_cotacao || p.data || p.dataCotacao || p.dataCotacaoBR || "",
        data:            p.data || p.data_cotacao || p.dataCotacao || p.dataCotacaoBR || "",
        valor:           p.valor || p.valorBR || p.total || "",
      }));

      console.log("[mapa] propostas count:", propsForTemplate.length);

      const data_aquisicao = fmtBRDate(b.data_aquisicao || b.processo?.dataAquisicaoISO || b.dataPagamento || "");
      const complemento = " Seleção pautada pela melhor proposta e pelo custo-benefício, considerando conformidade técnica, prazo e valor.";
      const justificativa = String(b.justificativa || b.processo?.justificativa || "") + complemento;
      const rodape = todayParts();
      const local_data = `${rodape.localidade}, ${rodape.dia} de ${rodape.mes} de ${rodape.ano}`;
      const coordenador_nome = String(b.coordenador || b.proj?.coordenador || "");

      const data = {
        instituicao:     b.instituicao || "",
        cnpj_inst:       b.cnpjInstituicao || b.data?.cnpjInstituicao || b.proj?.cnpj || b.cnpj || "",
        termo_parceria:  b.termoParceria || b.data?.termoParceria || b.proj?.termoParceria || b.termo || "",
        projeto_nome:    b.proj?.projetoNome || b.projeto || b.titulo || "",
        codigo_projeto:  b.proj?.projetoCodigo || b.codigo || b.projetoCodigo || "",
        natureza_disp:   rubrica,
        objeto,
        propostas:       propsForTemplate,
        data_aquisicao,
        justificativa,
        local_data,
        coordenador_nome,
      };

      const buffer = renderDocxFromTemplate(templateName, data);
      res
        .set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .set("Content-Disposition", `attachment; filename="mapa_cotacao_${isVertex ? "vertex" : "edge"}.docx"`)
        .send(buffer);
    } catch (err) {
      console.error("[mapa] erro:", err);
      res.status(500).type("text/plain; charset=utf-8")
        .send("*** Mapa de Cotação (erro) *** Verifique nomes e pastas em src/templates/mapa.\n\n" + String(err?.message || err));
    }
  });
}

/* ===== Páginas ===== */
app.get("/",              (_req, res) => res.sendFile(PUB("index.html")));
app.get("/login",         (_req, res) => res.sendFile(PUB("index.html")));
app.get("/login.html",    (_req, res) => res.sendFile(PUB("index.html")));
app.get("/dashboard",     (_req, res) => res.sendFile(PUB("dashboard.html")));
app.get("/prestacao",     (_req, res) => res.sendFile(PUB("prestacao.html")));
app.get("/docfin",        (_req, res) => res.sendFile(PUB("docfin.html")));
app.get("/dashboard.html",(_req, res) => res.sendFile(PUB("dashboard.html")));
app.get("/prestacao.html",(_req, res) => res.sendFile(PUB("prestacao.html")));
app.get("/docfin.html",   (_req, res) => res.sendFile(PUB("docfin.html")));

/* ===== Compat: alias antigo ===== */
app.post("/api/docs/folha-rosto",  (req, res) => res.redirect(307, "/api/generate/folha-rosto"));
app.post("/api/docs/folha-rosto/", (req, res) => res.redirect(307, "/api/generate/folha-rosto"));

/* ===== Health & 404 ===== */
app.get("/api/health", (_req, res) => res.json({ ok: true, msg: "api up" }));
app.get("/healthz",    (_req, res) => res.json({ ok: true }));
app.get("/health",     (_req, res) => res.json({ ok: true }));

// 404 para /api
app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "Rota não encontrada." }));

// Handler de erros — trata busboy com 400 para o front entender
app.use((err, _req, res, _next) => {
  console.error("[UNHANDLED ERROR]", err);
  const isBusboy = /Unexpected end of form/i.test(String(err?.message || ""));
  res.status(isBusboy ? 400 : 500).json({ ok: false, error: isBusboy ? "Upload incompleto." : "Erro interno do servidor." });
});

/* ===== Start (único) ===== */
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = "0.0.0.0";
function startServer(port = DEFAULT_PORT) {
  if (globalThis.__serverStarted) return;
  globalThis.__serverStarted = true;
  const server = app.listen(port, HOST, () => {
    console.log(`✅ Servidor rodando em http://localhost:${port}`);
    console.log("TEMPLATE_BASE:", TEMPLATE_BASE);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`⚠️ Porta ${port} em uso. Tentando ${port + 1}...`);
      globalThis.__serverStarted = false;
      startServer(port + 1);
    } else {
      throw err;
    }
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => server.close(() => process.exit(0)));
  }
}
startServer();
