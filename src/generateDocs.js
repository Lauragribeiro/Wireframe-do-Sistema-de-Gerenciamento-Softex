// src/generateDocs.js — ESM
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const TPL_DIR = path.join(__dirname, "templates", "folha_rosto");
function pickTemplate(instituicao = "EDGE") {
  const edge   = path.join(TPL_DIR, "folha_rosto_edge.docx");
  const vertex = path.join(TPL_DIR, "folha_rosto_vertex.docx");
  const inst   = String(instituicao || "").toUpperCase();
  if (inst.includes("VERTEX") && fs.existsSync(vertex)) return vertex;
  if (fs.existsSync(edge)) return edge;
  return fs.existsSync(vertex) ? vertex : edge;
}

// server.js monta em /api/generate -> POST /api/generate/folha-rosto
router.post("/folha-rosto", async (req, res) => {
  try {
    const { filenameHint = "folha_de_rosto.docx", instituicao } = req.body || {};
    // TODO: troque por sua função que GERA o Buffer do DOCX (docxtemplater etc.)
    // const buf = await montarFolhaDocx(req.body);
    const buf = fs.readFileSync(pickTemplate(instituicao)); // entrega o template (válido) por enquanto
    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filenameHint)}"`,
      "Content-Length": buf.length,
      "Cache-Control": "no-store",
    });
    res.send(buf);
  } catch (err) {
    console.error("[/api/generate/folha-rosto] erro:", err);
    res.status(500).json({ error: "Falha ao gerar documento" });
  }
});

export default router;
