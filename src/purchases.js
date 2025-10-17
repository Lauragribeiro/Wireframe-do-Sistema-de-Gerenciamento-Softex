// src/purchases.js — versão completa e corrigida (compatível com parseDocs.js)
import express from "express";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/* ========= Persistência em arquivo JSON =========
   Estrutura do arquivo: { [projectId: string]: Array<Row> }
   - Suporta:
     GET  /api/purchases?projectId=XYZ  -> retorna rows do projeto
     PUT  /api/purchases { projectId, rows } -> sobrescreve rows do projeto
     POST /api/purchases { ...campos, projectId? } -> insere 1 row (projeto "default" se omitido)
================================================= */

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "purchases.json");

async function ensureStore() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(DATA_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

async function loadAll() {
  await ensureStore();
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveAll(map) {
  await ensureStore();
  await fsp.writeFile(DATA_FILE, JSON.stringify(map, null, 2), "utf8");
}

// --- helper para sanitizar (sem perder docs) ---
function keepDocs(docs) {
  if (!docs || typeof docs !== "object")
    return { nf: null, oficio: null, ordem: null, cotacoes: [], comprovante: null };
  const out = {
    nf: docs.nf ?? null,
    oficio: docs.oficio ?? null,
    ordem: docs.ordem ?? null,
    cotacoes: Array.isArray(docs.cotacoes) ? docs.cotacoes.slice(0, 20) : [],
    comprovante: docs.comprovante ?? null,
  };
  return out;
}

// saneamento de uma linha (mantendo docs como objeto)
function sanitizeRow(r = {}) {
  return {
    id: String(r.id ?? Date.now()),
    favorecido: String(r.favorecido ?? ""),
    pcNumero: String(r.pcNumero ?? ""),
    cnpj: String(r.cnpj ?? ""),
    dataTitulo: r.dataTitulo ?? r.data_emissao_iso ?? "",
    nf: String(r.nf ?? r.nf_recibo ?? r.nf_num_9 ?? ""),
    nExtrato: String(r.nExtrato ?? r.numero_extrato ?? ""),
    dataPagamento: r.dataPagamento ?? r.data_pagamento?.iso ?? "",
    valor: r.valor ?? r.valor_pago_num ?? "",
    rubrica: String(r.rubrica ?? r.tipoRubrica ?? r.tipo_rubrica ?? ""),
    mesLabel: String(r.mesLabel ?? r.mesAno ?? (r.mes && r.ano ? `${r.mes}/${r.ano}` : "")),
    just: String(r.just ?? r.justificativa ?? "").trim(),
    docs: keepDocs(r.docs),
  };
}

/* ========= Rotas ========= */

// GET /api/purchases?projectId=123
router.get("/purchases", async (req, res) => {
  try {
    const projectId = String(req.query.projectId ?? "default").trim();
    const all = await loadAll();
    const rows = all[projectId] || [];
    res.json({ ok: true, data: rows });
  } catch (e) {
    res
      .status(500)
      .json({ ok: false, error: "load_failed", detail: String(e?.message || e) });
  }
});

// PUT /api/purchases  { projectId, rows: [...] }
router.put("/purchases", async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || "").trim();
    const arr = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!projectId || !arr) {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }
    const rows = arr.slice(0, 1000).map(sanitizeRow);
    const all = await loadAll();
    all[projectId] = rows;
    await saveAll(all);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("PUT /purchases erro:", e);
    res
      .status(500)
      .json({ ok: false, error: "save_failed", detail: String(e?.message || e) });
  }
});

// POST /api/purchases  (insere 1 linha) — aceita opcional projectId
router.post("/purchases", async (req, res) => {
  try {
    const projectId = String(req.body?.projectId ?? "default").trim();
    const row = sanitizeRow(req.body || {});
    const all = await loadAll();
    if (!Array.isArray(all[projectId])) all[projectId] = [];
    all[projectId].unshift(row);
    await saveAll(all);
    res.json({ ok: true, data: row });
  } catch (e) {
    console.error("POST /purchases erro:", e);
    res
      .status(500)
      .json({ ok: false, error: "insert_failed", detail: String(e?.message || e) });
  }
});

export default router;

