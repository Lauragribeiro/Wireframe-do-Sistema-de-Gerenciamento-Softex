// src/uploads.js — ESM
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

// base: ./data/uploads/YYYY/MM
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function safeName(name) {
  // tira acentos/caracteres estranhos e preserva extensão
  const ext = path.extname(name || "").toLowerCase();
  const base = path.basename(name || "", ext)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 80) || "arquivo";
  return `${Date.now()}-${base}${ext}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const dir = path.join(process.cwd(), "data", "uploads",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, safeName(file.originalname))
});

const fileFilter = (_req, file, cb) => {
  // ajuste a whitelist de tipos conforme seu fluxo:
  const okTypes = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp"
  ];
  if (okTypes.includes(file.mimetype)) return cb(null, true);
  cb(new Error("Tipo de arquivo não permitido"));
};

const maxSize = Number(process.env.UPLOAD_MAX_BYTES || 25 * 1024 * 1024); // 25MB
const upload = multer({ storage, fileFilter, limits: { fileSize: maxSize } });

// POST /api/upload (campo 'file')
router.post("/upload", upload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, error: "missing_file" });

  // URL pública (ver server.js abaixo)
  const abs = f.path;
  const rel = abs.split(path.sep).slice(-3).join("/"); // YYYY/MM/filename
  const url = `/uploads/${rel}`;

  return res.json({
    ok: true,
    file: {
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      filename: path.basename(f.filename),
      url
    }
  });
});

// GET /api/uploads (lista simples, opcional)
router.get("/uploads", (_req, res) => {
  const base = path.join(process.cwd(), "data", "uploads");
  if (!fs.existsSync(base)) return res.json({ ok: true, files: [] });

  const walk = (dir) => {
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) out.push(...walk(p));
      else {
        const rel = p.replace(base, "").replace(/^[\\/]/, "").split(path.sep).join("/");
        out.push({ rel, size: stat.size, url: `/uploads/${rel}` });
      }
    }
    return out;
  };
  return res.json({ ok: true, files: walk(base) });
});

export default router;
