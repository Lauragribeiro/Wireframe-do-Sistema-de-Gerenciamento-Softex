// src/cnpjProxy.js — ESM
import { Router } from "express";

// Se seu Node for 18+ já tem fetch global. Se for <18, descomente a linha abaixo:
// import fetch from "node-fetch";

const router = Router();

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "edge-vertex/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ROTA FINAL: GET /api/cnpj/:cnpj  (server.js faz app.use("/api", router))
router.get("/cnpj/:cnpj", async (req, res) => {
  const d = String(req.params.cnpj || "").replace(/\D/g, "");
  if (d.length !== 14) {
    return res.status(400).json({ ok: false, error: "bad_cnpj" });
  }

  try {
    let razao = "";

    // 1) BrasilAPI
    try {
      const j = await fetchJSON(`https://brasilapi.com.br/api/cnpj/v1/${d}`);
      razao = j?.razao_social || j?.nome_fantasia || "";
    } catch {}

    // 2) Fallback Receitaws
    if (!razao) {
      try {
        const j2 = await fetchJSON(`https://www.receitaws.com.br/v1/cnpj/${d}`);
        razao = j2?.nome || j2?.fantasia || "";
      } catch {}
    }

    if (!razao) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    return res.json({ ok: true, cnpj: d, razao_social: razao });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "cnpj_lookup_failed",
      detail: String(e?.message || e),
    });
  }
});

export default router;

