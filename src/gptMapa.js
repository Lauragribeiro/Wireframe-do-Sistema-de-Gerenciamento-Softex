// src/gptMapa.js
import { ensureOpenAIClient } from "./openaiProvider.js";
import {
  SYSTEM_EXTRACAO_COTACOES,
  USER_EXTRACAO_COTACOES,
  SYSTEM_GERACAO_TEXTO,
  USER_GERACAO_TEXTO
} from "./promptsMapa.js";

function requireClient() {
  const client = ensureOpenAIClient();
  if (!client) {
    throw new Error("OpenAI API key ausente ou inválida");
  }
  return client;
}

/**
 * Extrai propostas de cotações (texto já OCRizado)
 * @param {Object} params
 * @param {string} params.instituicao
 * @param {string} params.codigo_projeto
 * @param {string} params.rubrica
 * @param {string} params.lista_cotacoes_texto  // concatenação do texto das cotações
 * @returns {Promise<{propostas: Array, objeto_rascunho: string|null, avisos: string[]}>}
 */
export async function extrairCotacoesDeTexto(params) {
  const userPrompt = USER_EXTRACAO_COTACOES(params);
  const client = requireClient();
  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: SYSTEM_EXTRACAO_COTACOES },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.1
  });

  const raw = resp.output_text || "{}";
  let json;
  try { json = JSON.parse(raw); } catch { json = { propostas: [], objeto_rascunho: null, avisos: ["JSON inválido"] }; }
  // Normalização leve
  json.propostas = Array.isArray(json.propostas) ? json.propostas : [];
  json.avisos = Array.isArray(json.avisos) ? json.avisos : [];
  return json;
}

/**
 * Gera Objeto e Justificativa finais
 * @param {Object} params
 * @param {string} params.instituicao
 * @param {string} params.projeto
 * @param {string} params.codigo_projeto
 * @param {string} params.rubrica
 * @param {string} params.justificativa_base
 * @param {string} params.json_propostas  // string JSON das propostas
 * @param {string} params.data_pagamento  // DD/MM/AAAA
 * @param {string} params.localidade      // ex.: "Maceió"
 * @returns {Promise<{objeto: string, justificativa: string}>}
 */
export async function gerarObjetoEJustificativa(params) {
  const userPrompt = USER_GERACAO_TEXTO(params);
  const client = requireClient();
  const resp = await client.responses.create({
    model: "gpt-4o",
    input: [
      { role: "system", content: SYSTEM_GERACAO_TEXTO },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.5
  });

  const raw = resp.output_text || "{}";
  let json;
  try { json = JSON.parse(raw); } catch { json = { objeto: "", justificativa: "" }; }
  return {
    objeto: String(json.objeto || "").trim(),
    justificativa: String(json.justificativa || "").trim()
  };
}
// src/gptMapa.js
import { PROMPT_CONSOLIDA_PROPOSTAS } from "./promptsMapa.js";
import { extractCotacaoFromPdf } from "./gptExtracts.js";

function parseBRL(v) {
  if (!v) return NaN;
  const n = Number(String(v).replace(/[R$\s\.]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export async function buildPropostas(openai, cotacoesPaths = []) {
  // 1) extrai uma por uma
  const extracoes = [];
  for (const p of cotacoesPaths) {
    const data = await extractCotacaoFromPdf(openai, p);
    extracoes.push(data);
  }

  // 2) se você quiser consolidar pela IA (opcional)
  if (openai) {
    const res = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: PROMPT_CONSOLIDA_PROPOSTAS.system },
        { role: "user", content: PROMPT_CONSOLIDA_PROPOSTAS.user + "\n\n" + JSON.stringify(extracoes) },
      ],
    });
    const out = JSON.parse(res.output_text ?? "{}");
    if (Array.isArray(out?.propostas) && out.propostas.length) {
      return out.propostas;
    }
  }

  // 3) fallback local: normaliza, ordena por valor quando possível
  const base = extracoes.map(x => ({
    selecao: "",
    ofertante: x?.ofertante ?? "",
    cnpj_ofertante: x?.cnpj_ofertante ?? null,
    data_cotacao: x?.data_cotacao ?? null,
    valor: x?.valor ?? null,
    _num: parseBRL(x?.valor),
  }));
  const allHave = base.every(b => Number.isFinite(b._num));
  return (allHave ? base.sort((a, b) => a._num - b._num) : base).map(({ _num, ...r }) => r);
}
