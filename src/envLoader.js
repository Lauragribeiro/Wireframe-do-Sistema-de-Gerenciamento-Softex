import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const CANDIDATES = [
  process.env.DOTENV_PATH,
  path.join(projectRoot, '.env.local'),
  path.join(projectRoot, '.env'),
].filter(Boolean);

const loaded = new Set();

for (const candidate of CANDIDATES) {
  const resolved = path.resolve(candidate);
  if (loaded.has(resolved)) continue;
  loaded.add(resolved);
  if (!fs.existsSync(resolved)) continue;
  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const parsed = parseEnv(content);
    applyEnv(parsed);
  } catch (err) {
    console.warn('[envLoader] Falha ao ler', resolved, err);
  }
}

function parseEnv(src = '') {
  const env = {};
  const lines = String(src).split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)?$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? '';
    // preserve inline comments when value is quoted
    if (value) {
      value = value.trim();
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
        if (first === '"') {
          value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
        }
      } else {
        const hashIdx = value.indexOf(' #');
        value = hashIdx >= 0 ? value.slice(0, hashIdx).trim() : value;
      }
    }
    env[key] = value;
  }
  return env;
}

function applyEnv(env) {
  if (!env) return;
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
