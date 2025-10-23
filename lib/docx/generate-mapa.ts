// Geração de mapa de cotação em DOCX
import type { Purchase, Proposal } from "../types"

export interface MapaData {
  purchase: Purchase
  proposals: Proposal[]
  metadata: {
    generatedAt: string
    generatedBy: string
  }
}

export async function generateMapaCotacao(data: MapaData): Promise<Buffer> {
  // Implementação simplificada - em produção, usar docxtemplater ou docx
  const content = `
MAPA DE COTAÇÃO

Instituição: ${data.purchase.instituicao.toUpperCase()}
Projeto: ${data.purchase.projeto}
Termo de Parceria: ${data.purchase.termoParceria}
Rubrica: ${data.purchase.rubrica}

OBJETO:
${data.purchase.objeto}

JUSTIFICATIVA:
${data.purchase.justificativa}

PROPOSTAS RECEBIDAS:

${data.proposals
  .map(
    (p, i) => `
${i + 1}. ${p.fornecedor}
   CNPJ: ${formatCNPJ(p.cnpj)}
   Valor: R$ ${p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
   Data: ${formatDate(p.dataEmissao)}
   ${p.numeroDocumento ? `Documento: ${p.numeroDocumento}` : ""}
`,
  )
  .join("\n")}

PROPOSTA VENCEDORA:
${data.proposals[0]?.fornecedor || "Não definido"}
Valor: R$ ${(data.proposals[0]?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}

Gerado em: ${new Date(data.metadata.generatedAt).toLocaleString("pt-BR")}
Por: ${data.metadata.generatedBy}
`

  return Buffer.from(content, "utf-8")
}

function formatCNPJ(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "")
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString("pt-BR")
}
