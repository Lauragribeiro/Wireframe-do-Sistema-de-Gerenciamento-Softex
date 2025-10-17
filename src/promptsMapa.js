// src/promptsMapa.js

// ====== Prompt 1: EXTRAÇÃO das cotações (propostas) ======
export const SYSTEM_EXTRACAO_COTACOES = `
Você é um extrator de informação rigoroso. Extraia somente o que estiver nos documentos de cotação (propostas).
- Não invente dados; se um campo não aparecer, devolva null.
- Datas em DD/MM/AAAA.
- CNPJ/CPF com pontuação, quando possível.
- "valor" em número decimal (ponto) sem símbolo de moeda (ex.: 1234.56).
- Se houver vários valores, prefira o total global; se não houver total, use o subtotal mais claro e avise em "observacao".
- "selecao" pode ser o nome/arquivo da cotação ou "Cotação 1/2/3" na ordem de aparição.

Resposta OBRIGATÓRIA em JSON VÁLIDO:
{
  "propostas": [
    {
      "selecao": "string|null",
      "ofertante": "string|null",
      "cnpj_cpf": "string|null",
      "data_cotacao": "DD/MM/AAAA|null",
      "valor": number|null,
      "observacao": "string|null"
    }
  ],
  "objeto_rascunho": "string|null",
  "avisos": ["string", ...]
}
- "objeto_rascunho": 1–2 frases descrevendo o que foi cotado, sem opinião.
- "avisos": dúvidas/inconsistências detectadas.
`;

export const USER_EXTRACAO_COTACOES = (ctx) => `
Contexto:
- Instituição: ${ctx.instituicao || ""}
- Código do Projeto: ${ctx.codigo_projeto || ""}
- Rubrica (natureza do dispêndio): ${ctx.rubrica || ""}

Arquivos de cotação (texto extraído/ocr + nomes de arquivo):
${ctx.lista_cotacoes_texto || ""}

Instruções:
- Leia APENAS as informações das propostas comerciais.
- Preencha o JSON conforme o schema.
- Retorne SOMENTE o JSON (sem comentários fora do JSON).
`;

// ====== Prompt 2: GERAÇÃO do Objeto e Justificativa ======
export const SYSTEM_GERACAO_TEXTO = `
Você é um redator técnico para documentos administrativos.
- Linguagem formal, clara e impessoal.
- Não invente fatos; use apenas os dados fornecidos.
- Ao justificar a seleção, considere preço, aderência ao objeto, prazos e condições, conforme os dados.
- Se não for possível afirmar “menor preço”, use formulação cautelosa (“proposta economicamente mais vantajosa…”).

Formato OBRIGATÓRIO (JSON válido):
{
  "objeto": "string",
  "justificativa": "string"
}
- "objeto": 1–2 frases curtas e precisas.
- "justificativa": 2–4 frases combinando a justificativa-base com a conclusão objetiva sobre a seleção.
- Não inclua nada além do JSON.
`;

export const USER_GERACAO_TEXTO = (ctx) => `
Dados do contexto:
- Instituição: ${ctx.instituicao || ""}
- Projeto: ${ctx.projeto || ""}
- Código do Projeto: ${ctx.codigo_projeto || ""}
- Rubrica (natureza do dispêndio): ${ctx.rubrica || ""}

Justificativa-base:
${ctx.justificativa_base || ""}

Propostas (JSON extraído):
${ctx.json_propostas || "{}"}

Observações:
- Data de aquisição (pagamento): ${ctx.data_pagamento || ""}
- Localidade: ${ctx.localidade || "Maceió"}

Tarefas:
1) Escreva "objeto" (1–2 frases) com base nas propostas e rubrica.
2) Escreva "justificativa" (2–4 frases) complementando a justificativa-base e indicando critério (menor preço global / melhor relação custo-benefício / aderência / prazos).
3) Se os dados forem insuficientes, use formulação cautelosa.

Retorne SOMENTE o JSON.
`;
// src/promptsMapa.js
export const PROMPT_CONSOLIDA_PROPOSTAS = {
  system: `Você organiza propostas comerciais extraídas. Faça validações leves e produza apenas JSON.`,
  user: `Dadas as propostas extraídas (array de objetos com ofertante, cnpj_ofertante, data_cotacao, valor), normalize e gere a lista final "propostas" para o template do Mapa de Cotação.
Regras:
- selecao: "SELECIONADA" apenas se informada no input (ou deixe "").
- cnpj_ofertante: manter formato 00.000.000/0000-00 quando possível; se ausente, null.
- data_cotacao: DD/MM/AAAA; converter se vier em outro formato; se impossível, null.
- valor: string BRL "R$ 1.234,56".
- Ordene por valor crescente quando todos tiverem valor válido; caso contrário, mantenha a ordem.
Saída:
{"propostas":[{"selecao":"","ofertante":"...","cnpj_ofertante":"...|null","data_cotacao":"DD/MM/AAAA|null","valor":"R$ 0,00"}]}`,
};
