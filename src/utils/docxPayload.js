// src/utils/docxPayload.js
export function S(v) { return (v ?? "") + ""; }

export function norm(obj = {}) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = S(obj[k]);
  return out;
}

export function buildPayloadBase({ proj = {}, processo = {}, llm = {}, extras = {} } = {}) {
  const base = {
    // comuns
    instituicao: proj.instituicao,
    cnpj_instituicao: proj.cnpj,
    termo_parceria: proj.termoParceria,
    projeto: proj.projetoNome || proj.projetoCodigo,
    natureza_disp: processo.naturezaDisp || llm.naturezaDisp,
    cidade: extras.cidade || "Maceió",
    data_extenso: extras.dataExtenso,

    // MAPA
    objeto: processo.objeto || llm.objeto,
    data_aquisicao: processo.dataAquisicaoISO,
    justificativa: processo.justificativa || llm.justificativa,
    propostas_json: JSON.stringify(processo.propostas || []),

    // FOLHA
    prestacao_contas: processo.pcNumero,
    favorecido_nome: processo.favorecidoNome,
    favorecido_doc: processo.favorecidoDoc,
    extrato_num: processo.extratoNumero,
    nf_num: processo.nfNumero,
    nf_data_emissao: processo.nfDataEmissaoISO,
    dt_pagamento: processo.dataPagamentoISO,
    valor_total: processo.valorTotalBR,
  };

  base.data_aquisicao_br = toBR(base.data_aquisicao);
  base.nf_data_emissao_br = toBR(base.nf_data_emissao);
  base.dt_pagamento_br = toBR(base.dt_pagamento);

  return norm(base);
}

function toBR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
// src/utils/docxPayload.js
import dayjs from "dayjs";
import "dayjs/locale/pt-br.js";
dayjs.locale("pt-br");

function toBRDate(d) {
  if (!d) return null;
  // aceita "YYYY-MM-DD" ou "DD/MM/AAAA"
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  const m = dayjs(d);
  return m.isValid() ? m.format("DD/MM/YYYY") : null;
}
function toBRL(v) {
  if (v == null || v === "") return "";
  // se já vier "R$ " retorna como está
  if (typeof v === "string" && v.trim().startsWith("R$")) return v.trim();
  const num = Number(
    String(v)
      .replace(/[R$\s\.]/g, "")
      .replace(",", ".")
  );
  if (Number.isFinite(num)) {
    return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return String(v);
}

export function buildFolhaPayload(purchase) {
  const naturezaDisp = (purchase?.tipo_rubrica ?? purchase?.rubrica ?? "").toString().trim();
  return {
    // ...outros campos que você já monta
    natureza_disp: naturezaDisp,
  };
}

export function normalizePropostas(list = []) {
  return list.map(p => ({
    selecao: p.selecao || "",
    ofertante: p.ofertante || "",
    cnpj_ofertante: p.cnpj_ofertante ?? null,
    data_cotacao: toBRDate(p.data_cotacao),
    valor: toBRL(p.valor),
  }));
}

export function buildMapaPayload(purchase, propostas = []) {
  const naturezaDisp = (purchase?.tipo_rubrica ?? purchase?.rubrica ?? "").toString().trim();
  return {
    // ...demais campos do cabeçalho do Mapa
    natureza_disp: naturezaDisp,
    propostas: normalizePropostas(propostas),
  };
}
