// src/uploads.js — ESM, único
import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeName(name) {
  const ext = path.extname(name || "").toLowerCase();
  const base = path.basename(name || "", ext)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 80) || "arquivo";
  return `${Date.now()}-${base}${ext}`;
}

// pasta: data/uploads/YYYY/MM
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

const allowedExt = new Set(["pdf","png","jpg","jpeg","webp","ofx","xml"]);
const allowedMime = new Set([
  "application/pdf",
  "image/png","image/jpeg","image/webp",
  "application/ofx","application/x-ofx",
  "application/xml","text/xml",
  "application/octet-stream"
]);

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.UPLOAD_MAX_BYTES || 25 * 1024 * 1024) },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const ext  = name.split(".").pop();
    if (allowedExt.has(ext) || allowedMime.has(file.mimetype)) return cb(null, true);
    cb(new Error("Tipo de arquivo não permitido"));
  }
});

// POST /api/upload (campo 'file')
router.post("/upload", upload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, error: "missing_file" });

  // monta URL pública (server.js precisa expor /uploads estático)
  const rel = f.destination.split(path.sep).slice(-2).join("/") + "/" + f.filename; // YYYY/MM/filename
  const url = `/uploads/${rel}`;

  res.json({
    ok: true,
    file: {
      url,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      filename: f.filename
    }
  });
});

// GET /api/uploads (lista simples - opcional)
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
  res.json({ ok: true, files: walk(base) });
});

export default router;
