// src/openaiProvider.js
import OpenAI from "openai";

const DEFAULT_OPENAI_KEY = "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";

let cachedKey = null;
let cachedClient = null;

export function resolveOpenAIKey() {
  const key = (process.env.OPENAI_API_KEY || DEFAULT_OPENAI_KEY || "").trim();
  return key;
}

export function ensureOpenAIClient() {
  const key = resolveOpenAIKey();
  if (!key) {
    cachedKey = null;
    cachedClient = null;
    return null;
  }
  if (cachedClient && cachedKey === key) {
    return cachedClient;
  }
  try {
    cachedClient = new OpenAI({ apiKey: key });
    cachedKey = key;
  } catch {
    cachedClient = null;
    cachedKey = null;
  }
  return cachedClient;
}

export function invalidateOpenAIClient() {
  cachedClient = null;
}

export function hasOpenAIKey() {
  return !!resolveOpenAIKey();
}
