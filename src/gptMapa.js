// src/gptMapa.js
import fs from "node:fs";

import { ensureOpenAIClient } from "./openaiProvider.js";
import {
  SYSTEM_EXTRACAO_COTACOES,
  USER_EXTRACAO_COTACOES,
  SYSTEM_GERACAO_TEXTO,
  USER_GERACAO_TEXTO,
  PROMPT_CONSOLIDA_PROPOSTAS,
} from "./promptsMapa.js";
import { extractCotacaoFromPdf } from "./gptExtracts.js";

function requireClient() {
  const client = ensureOpenAIClient();
  if (!client) {
    throw new Error("OpenAI API key ausente ou inválida");
  }
  return client;
}

async function uploadCotacaoFiles(client, arquivos = []) {
  const uploads = [];
  for (const arquivo of arquivos || []) {
    const filePath = arquivo?.path;
    if (!filePath) continue;
    try {
      await fs.promises.access(filePath);
    } catch {
      continue;
    }
    try {
      const stream = fs.createReadStream(filePath);
      const uploaded = await client.files.create({
        file: stream,
        purpose: "vision",
      });
      uploads.push({
        file_id: uploaded?.id,
        label: arquivo?.name || arquivo?.label || "cotacao",
      });
    } catch (err) {
      console.warn(
        "[mapa] falha ao anexar cotação para leitura:",
        arquivo?.name || arquivo?.path || "(sem nome)",
        err?.message || err
      );
    }
  }
  return uploads;
}

const EXTRACAO_SCHEMA = {
  name: "cotacao_mapa",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["propostas", "objeto_rascunho", "avisos"],
    properties: {
      objeto_rascunho: { type: ["string", "null"], description: "Resumo objetivo do objeto comum." },
      avisos: {
        type: "array",
        items: { type: "string" },
        description: "Inconsistências ou dúvidas encontradas.",
      },
      propostas: {
        type: "array",
        description: "Lista das propostas detectadas nas cotações.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["selecao", "ofertante", "cnpj_cpf", "data_cotacao", "valor"],
          properties: {
            selecao: { type: "string", description: "Identificador sequencial da proposta." },
            ofertante: { type: ["string", "null"] },
            cnpj_cpf: { type: ["string", "null"] },
            data_cotacao: { type: ["string", "null"], description: "Data no formato DD/MM/AAAA." },
            valor: { type: ["number", "string", "null"], description: "Valor total ofertado." },
            observacao: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

/**
 * Extrai propostas de cotações (texto já OCRizado)
 * @param {Object} params
 * @param {string} params.instituicao
 * @param {string} params.codigo_projeto
 * @param {string} params.rubrica
 * @param {string} params.lista_cotacoes_texto  // concatenação do texto das cotações
 * @param {Array<{name?: string, path: string}>} [params.cotacoes_arquivos]
 * @param {string} [params.cotacoes_anexos]
 * @returns {Promise<{propostas: Array, objeto_rascunho: string|null, avisos: string[]}>}
 */
export async function extrairCotacoesDeTexto(params) {
  const userPrompt = USER_EXTRACAO_COTACOES(params);
  const client = requireClient();
  const arquivos = Array.isArray(params?.cotacoes_arquivos) ? params.cotacoes_arquivos : [];
  const anexos = await uploadCotacaoFiles(client, arquivos);
  const validAttachments = anexos.filter((item) => item?.file_id);

  const userContent = validAttachments.length
    ? [
        { type: "input_text", text: userPrompt },
        ...validAttachments.map((item) => ({ type: "input_file", file_id: item.file_id })),
      ]
    : userPrompt;

  let resp;
  try {
    resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_EXTRACAO_COTACOES },
        { role: "user", content: userContent },
      ],
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: EXTRACAO_SCHEMA },
    });
  } finally {
    if (validAttachments.length) {
      const deletions = validAttachments.map((item) =>
        client.files
          .del(item.file_id)
          .catch((err) =>
            console.warn(
              "[mapa] falha ao remover arquivo temporário da cotação:",
              item.file_id,
              err?.message || err
            )
          )
      );
      await Promise.allSettled(deletions);
    }
  }

  const raw = resp?.output_text || "{}";
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { propostas: [], objeto_rascunho: null, avisos: ["JSON inválido"] };
  }
  if (!Array.isArray(json.propostas)) json.propostas = [];
  if (!Array.isArray(json.avisos)) json.avisos = [];
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
      { role: "user", content: userPrompt },
    ],
    temperature: 0.5,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "objeto_justificativa",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["objeto", "justificativa"],
          properties: {
            objeto: { type: "string" },
            justificativa: { type: "string" },
          },
        },
      },
    },
  });

  const raw = resp.output_text || "{}";
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    json = { objeto: "", justificativa: "" };
  }
  return {
    objeto: String(json.objeto || "").trim(),
    justificativa: String(json.justificativa || "").trim(),
  };
}

function parseBRL(v) {
  if (!v) return NaN;
  const n = Number(String(v).replace(/[R$\s\.]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export async function buildPropostas(openai, cotacoesPaths = []) {
  const extracoes = [];
  for (const p of cotacoesPaths) {
    const data = await extractCotacaoFromPdf(openai, p);
    extracoes.push(data);
  }

  if (openai) {
    const res = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: PROMPT_CONSOLIDA_PROPOSTAS.system },
        {
          role: "user",
          content: `${PROMPT_CONSOLIDA_PROPOSTAS.user}\n\n${JSON.stringify(extracoes)}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: {
        name: "consolida_propostas",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            propostas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  selecao: { type: ["string", "null"] },
                  ofertante: { type: ["string", "null"] },
                  cnpj_ofertante: { type: ["string", "null"] },
                  data_cotacao: { type: ["string", "null"] },
                  valor: { type: ["string", "null"] },
                },
              },
            },
          },
        },
      } },
    });
    const out = JSON.parse(res.output_text ?? "{}");
    if (Array.isArray(out?.propostas) && out.propostas.length) {
      return out.propostas;
    }
  }

  const base = extracoes.map((x) => ({
    selecao: "",
    ofertante: x?.ofertante ?? "",
    cnpj_ofertante: x?.cnpj_ofertante ?? null,
    data_cotacao: x?.data_cotacao ?? null,
    valor: x?.valor ?? null,
    _num: parseBRL(x?.valor),
  }));
  const allHave = base.every((b) => Number.isFinite(b._num));
  return (allHave ? base.sort((a, b) => a._num - b._num) : base).map(({ _num, ...r }) => r);
}
