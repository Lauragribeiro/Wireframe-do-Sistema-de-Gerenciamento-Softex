// src/vendors.js — ESM (compatível com "type": "module")
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Persistência simples em JSON local (data/vendors.json)
const DATA_FILE = path.join(__dirname, "..", "data", "vendors.json");

function readJSON() {
  try {
    const txt = fs.readFileSync(DATA_FILE, "utf8");
    return txt ? JSON.parse(txt) : [];
  } catch {
    return [];
  }
}

function writeJSON(arr) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), "utf8");
}

const router = express.Router();

/** GET /api/vendors */
router.get("/vendors", (_req, res) => {
  res.json({ ok: true, data: readJSON() });
});

/** POST /api/vendors  (exemplo de inclusão) */
router.post("/vendors", (req, res) => {
  const { cnpj = "", razao_social = "", nome_fantasia = "" } = req.body || {};
  const row = {
    id: Date.now(),
    cnpj,
    razao_social,
    nome_fantasia
  };
  const list = readJSON();
  list.unshift(row);
  writeJSON(list);
  res.json({ ok: true, data: row });
});

export default router;
