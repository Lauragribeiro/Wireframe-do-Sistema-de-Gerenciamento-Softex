// index.js (ESM único)
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// === Importe SOMENTE os routers que existem no seu src/ ===
import purchasesRouter     from "./src/purchases.js";     // /api/purchases (GET/PUT/POST)
import parseDocsRouter     from "./src/parseDocs.js";     // /api/parse-docs, /api/extrair-documento-imagem
// Se você criou o proxy de CNPJ, mantenha a linha abaixo; senão, comente.
// import cnpjProxyRouter     from "./src/cnpjProxy.js";     // /api/cnpj/:cnpj
// Se você criou a geração de DOCX, mantenha a linha abaixo; senão, comente.
import generateDocsRouter  from "./src/generateDocs.js";  // /api/generate/folha-rosto

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();

// Middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use(express.static(path.join(__dirname, "public")));

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true, msg: "api up" }));

// API routers (ordem não crítica)
app.use("/api", purchasesRouter);
app.use("/api", parseDocsRouter);
// if (cnpjProxyRouter) app.use("/api", cnpjProxyRouter);
app.use("/api", generateDocsRouter);

// Raiz
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 404 para endpoints de API não mapeados
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: `Rota não encontrada: ${req.method} ${req.originalUrl}` });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   ➜ Health: http://localhost:${PORT}/api/health`);
});
