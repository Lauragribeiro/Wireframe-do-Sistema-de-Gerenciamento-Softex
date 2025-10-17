// src/utils/templateGuards.js
export function ensureFields(payload, required, templateName) {
  const faltando = required.filter(k => !payload[k] || payload[k].trim() === "");
  if (faltando.length) {
    console.warn(`[${templateName}] Campos ausentes: ${faltando.join(", ")}`);
  }
}

export const REQUIRED_MAPA = [
  "instituicao","cnpj_instituicao","termo_parceria","projeto",
  "natureza_disp","objeto","data_aquisicao","justificativa"
];

export const REQUIRED_FOLHA = [
  "instituicao","cnpj_instituicao","termo_parceria","projeto",
  "prestacao_contas","natureza_disp","favorecido_nome","favorecido_doc",
  "nf_num","nf_data_emissao","dt_pagamento","valor_total"
];
