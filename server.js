// server.js — ESM
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cnpjProxyRouter from "./src/cnpjProxy.js";
import uploadsRouter from "./src/uploads.js";


// Routers (cada um deve fazer `export default router`)
import parseDocsRouter     from "./src/parseDocs.js";
import vendorsRouter       from "./src/vendors.js";
import purchasesRouter     from "./src/purchases.js";
import generateDocsRouter  from "./src/generateDocs.js"; // geração de DOCX

// __dirname em ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUB = (...p) => path.join(__dirname, "public", ...p);

const app  = express();            // <<-- CRIA O APP ANTES DE USAR
const PORT = process.env.PORT || 3000;

/* ===== Middlewares ===== */
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true }));

/* ===== (opcional) log leve de requisições ===== */
app.use((req, _res, next) => {
  if (req.url.startsWith("/api")) {
    console.log(`${req.method} ${req.url}`);
  }
  next();
});

/* ===== Estáticos ===== */
app.use(express.static(PUB()));                 // /, /index.html, /dashboard.html, /docfin.html etc.
app.use("/styles", express.static(path.join(__dirname, "styles")));
app.use("/src",    express.static(path.join(__dirname, "src"))); // para carregar JS do front
app.use("/uploads", express.static(path.join(__dirname, "data", "uploads")));

/* ===== APIs ===== */
app.use("/api", parseDocsRouter);
app.use("/api", vendorsRouter);
app.use("/api", purchasesRouter);
app.use("/api/generate", generateDocsRouter);   // rotas de geração de documentos
app.use("/api", cnpjProxyRouter);
app.use("/api", uploadsRouter);

/* ===== API de Projetos (persistência simples em arquivo) ===== */
const PROJECTS_FILE = path.join(__dirname, "data", "projects.json");

const PROJECTS_SEED = [
  { id: 1, titulo: "Projeto Alfa",  codigo: "Z10 SOFT-001",  vigenciaInicio: "2025-01-01", vigenciaFim: "2025-12-31", responsavel: "Maria", status: "em_andamento", instituicao: "EDGE" },
  { id: 2, titulo: "Projeto Beta",  codigo: "Z30-002",       vigenciaInicio: "2025-02-01", vigenciaFim: "2025-11-30", responsavel: "João",  status: "pendente",     instituicao: "VERTEX" },
  { id: 3, titulo: "Projeto Gama",  codigo: "Z10-003",       vigenciaInicio: "2025-03-01", vigenciaFim: "2025-09-30", responsavel: "Ana",   status: "finalizado",  instituicao: "EDGE" }
];

function ensureProjectsFile() {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) {
      fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
      fs.writeFileSync(PROJECTS_FILE, JSON.stringify(PROJECTS_SEED, null, 2), "utf8");
    }
  } catch {}
}
function readProjects() {
  ensureProjectsFile();
  try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf8") || "[]"); }
  catch { return []; }
}
function writeProjects(list) {
  fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(list, null, 2), "utf8");
}

// GET lista
app.get("/api/projects", (_req, res) => {
  res.json({ ok: true, data: readProjects() });
});

// POST cria (“+Novo Projeto”)
app.post("/api/projects", (req, res) => {
  const { titulo, codigo, vigenciaInicio, vigenciaFim, status, gerente, instituicao } = req.body || {};
  if (!titulo || !codigo || !vigenciaInicio || !vigenciaFim || !status || !gerente) {
    return res.status(400).json({ ok:false, message:"Campos obrigatórios faltando." });
  }
  const list = readProjects();
  const novo = {
    id: Date.now(),
    titulo: String(titulo),
    codigo: String(codigo),
    vigenciaInicio: String(vigenciaInicio),
    vigenciaFim: String(vigenciaFim),
    responsavel: String(gerente),
    status: String(status),
    instituicao: (instituicao === "VERTEX" ? "VERTEX" : "EDGE") // default EDGE
  };
  list.unshift(novo);
  writeProjects(list);
  res.json({ ok:true, data: novo });
});

/* ===== Páginas (atalhos sem .html) ===== */
app.get("/", (_req, res) => res.sendFile(PUB("index.html")));
app.get("/login", (_req, res) => res.sendFile(PUB("index.html"))); // ajuste se houver login dedicado
app.get("/dashboard", (_req, res) => res.sendFile(PUB("dashboard.html")));
app.get("/prestacao", (_req, res) => res.sendFile(PUB("prestacao.html")));
app.get("/docfin", (_req, res) => res.sendFile(PUB("docfin.html")));

/* (opcional) aliases explícitos */
app.get("/dashboard.html", (_req, res) => res.sendFile(PUB("dashboard.html")));
app.get("/prestacao.html", (_req, res) => res.sendFile(PUB("prestacao.html")));
app.get("/docfin.html", (_req, res) => res.sendFile(PUB("docfin.html")));

/* ===== Debug ===== */
app.get("/healthz", (_req, res) => res.json({ ok: true }));

/* ===== Start ===== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
// Compat: aceitar chamadas antigas para /api/docs/folha-rosto
app.post("/api/docs/folha-rosto", (req, res) => {
  res.redirect(307, "/api/generate/folha-rosto");
});
app.post("/api/docs/folha-rosto/", (req, res) => {
  res.redirect(307, "/api/generate/folha-rosto");
});

