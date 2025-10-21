// src/gptExtract.js
import { ensureOpenAIClient } from "./openaiProvider.js";

function requireClient() {
  const client = ensureOpenAIClient();
  if (!client) {
    throw new Error("OpenAI API key ausente ou inválida");
  }
  return client;
}

// prompt-base: pedimos JSON estrito com chaves que o front já usa
const SYSTEM = `Você é um extrator para prestação de contas. 
Retorne JSON estrito com:
{
  "data_pagamento": {"iso": "YYYY-MM-DD"},
  "numero_extrato": {"raw": "string"},
  "valor_pago": {"raw": "string", "valor_pago_num": number|null},
  "mes_ao_pagamento": {"mes": "MM", "ano": "YYYY"},
  "nf": {"numero": "string|empty"},
  "data_titulo": {"iso": "YYYY-MM-DD"},
  "cnpj": {"raw": "00.000.000/0000-00"},
  "justificativa": {"texto": "string|empty"},
  "pcNumero": "string|empty",
  "mesLabel": "MM/YYYY|empty"
}
Use vazio ("") quando não achar. Não invente.`;

function normalizeMonthYear(iso) {
  if (!iso) return { mes: "", ano: "", mesLabel: "" };
  const d = new Date(`${iso}T00:00:00`);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return { mes: mm, ano: String(yyyy), mesLabel: `${mm}/${yyyy}` };
}

export async function extractFromText({ text, purpose }) {
  const user = `Documento (${purpose}). Texto a seguir:\n\n${text.slice(0, 200_000)}`;
  const client = requireClient();
  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: SYSTEM },
      { role: "user", content: user }
    ],
    temperature: 0
  });

  const raw = resp.output_text || "{}";
  let j; try { j = JSON.parse(raw); } catch { j = {}; }

  // pequenos “saneamentos”
  const iso = j?.data_pagamento?.iso || "";
  const { mes, ano, mesLabel } = normalizeMonthYear(iso);
  j.mes_ao_pagamento = j.mes_ao_pagamento || { mes, ano };
  j.mes_ano_pagamento = j.mes_ano_pagamento || { mes, ano };
  j.mesLabel = j.mesLabel || mesLabel;

  return j;
}

export async function extractFromImage({ dataURL, purpose }) {
  const client = requireClient();
  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "input_text", text: `Imagem de ${purpose}. Extraia os campos solicitados.` },
          { type: "input_image", image_url: dataURL }
        ]
      }
    ],
    temperature: 0
  });

  const raw = resp.output_text || "{}";
  let j; try { j = JSON.parse(raw); } catch { j = {}; }
  const iso = j?.data_pagamento?.iso || "";
  const { mes, ano, mesLabel } = normalizeMonthYear(iso);
  j.mes_ao_pagamento = j.mes_ao_pagamento || { mes, ano };
  j.mes_ano_pagamento = j.mes_ano_pagamento || { mes, ano };
  j.mesLabel = j.mesLabel || mesLabel;

  return j;
}
// src/gptExtracts.js
import fs from "node:fs";
import path from "node:path";
import { PROMPT_EXTRAI_COTACAO } from "./prompts.js";

export async function extractCotacaoFromPdf(openai, pdfFilePath) {
  // IA disponível?
  if (openai) {
    // Se você já usa "responses" com "input: [{role:'user',content:[{type:'input_text'...},{type:'input_file',...}]}]]"
    // adapte para o seu client atual. A ideia é: enviar prompt + arquivo e receber JSON.
    const fileName = path.basename(pdfFilePath);
    const userText = PROMPT_EXTRAI_COTACAO.user + `\nArquivo: ${fileName}`;
    const res = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: PROMPT_EXTRAI_COTACAO.system },
        { role: "user", content: userText },
        // ANEXAR PDF conforme sua integração existente
      ],
      // Se você já usa "json_mode": true no seu client, ative aqui
    });
    // adapte a leitura do JSON:
    const json = JSON.parse(res.output_text ?? "{}");
    return json;
  }

  // Fallback simples (sem IA): tenta ler de um JSON auxiliar ao lado do PDF
  const guess = pdfFilePath.replace(/\.pdf$/i, ".json");
  if (fs.existsSync(guess)) {
    return JSON.parse(fs.readFileSync(guess, "utf8"));
  }
  return { ofertante: null, cnpj_ofertante: null, data_cotacao: null, valor: null };
}
