// Geração de mapa de cotação em DOCX
import type { Purchase, Proposal } from "../types"
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType } from "docx"

export interface MapaData {
  purchase: Purchase
  proposals: Proposal[]
  metadata: {
    generatedAt: string
    generatedBy: string
  }
}

export async function generateMapaCotacao(data: MapaData): Promise<Buffer> {
  try {
    const { purchase, proposals, metadata } = data

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            // Header
            new Paragraph({
              children: [
                new TextRun({
                  text: "MAPA DE COTAÇÃO",
                  bold: true,
                  size: 32,
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),

            // Institution Info
            new Paragraph({
              children: [
                new TextRun({ text: "Instituição: ", bold: true }),
                new TextRun({ text: purchase.instituicao.toUpperCase() }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [new TextRun({ text: "Projeto: ", bold: true }), new TextRun({ text: purchase.projeto })],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Termo de Parceria: ", bold: true }),
                new TextRun({ text: purchase.termoParceria }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [new TextRun({ text: "Rubrica: ", bold: true }), new TextRun({ text: purchase.rubrica })],
              spacing: { after: 400 },
            }),

            // Object
            new Paragraph({
              children: [new TextRun({ text: "OBJETO:", bold: true, size: 24 })],
              spacing: { before: 200, after: 200 },
            }),
            new Paragraph({
              children: [new TextRun({ text: purchase.objeto })],
              spacing: { after: 400 },
            }),

            // Justification
            new Paragraph({
              children: [new TextRun({ text: "JUSTIFICATIVA:", bold: true, size: 24 })],
              spacing: { before: 200, after: 200 },
            }),
            new Paragraph({
              children: [new TextRun({ text: purchase.justificativa })],
              spacing: { after: 400 },
            }),

            // Proposals Header
            new Paragraph({
              children: [new TextRun({ text: "PROPOSTAS RECEBIDAS:", bold: true, size: 24 })],
              spacing: { before: 400, after: 200 },
            }),

            // Proposals Table
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                // Header row
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ text: "Fornecedor", bold: true })],
                      shading: { fill: "CCCCCC" },
                    }),
                    new TableCell({
                      children: [new Paragraph({ text: "CNPJ", bold: true })],
                      shading: { fill: "CCCCCC" },
                    }),
                    new TableCell({
                      children: [new Paragraph({ text: "Valor (R$)", bold: true })],
                      shading: { fill: "CCCCCC" },
                    }),
                    new TableCell({
                      children: [new Paragraph({ text: "Data", bold: true })],
                      shading: { fill: "CCCCCC" },
                    }),
                  ],
                }),
                // Data rows
                ...proposals.map(
                  (p, i) =>
                    new TableRow({
                      children: [
                        new TableCell({
                          children: [new Paragraph(p.fornecedor)],
                          shading: i === 0 ? { fill: "E8F5E9" } : undefined,
                        }),
                        new TableCell({
                          children: [new Paragraph(formatCNPJ(p.cnpj))],
                          shading: i === 0 ? { fill: "E8F5E9" } : undefined,
                        }),
                        new TableCell({
                          children: [new Paragraph(p.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 }))],
                          shading: i === 0 ? { fill: "E8F5E9" } : undefined,
                        }),
                        new TableCell({
                          children: [new Paragraph(formatDate(p.dataEmissao))],
                          shading: i === 0 ? { fill: "E8F5E9" } : undefined,
                        }),
                      ],
                    }),
                ),
              ],
            }),

            // Winner
            new Paragraph({
              children: [new TextRun({ text: "PROPOSTA VENCEDORA:", bold: true, size: 24 })],
              spacing: { before: 400, after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Fornecedor: ", bold: true }),
                new TextRun({ text: proposals[0]?.fornecedor || "Não definido" }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Valor: ", bold: true }),
                new TextRun({
                  text: `R$ ${(proposals[0]?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
                }),
              ],
              spacing: { after: 400 },
            }),

            // Footer
            new Paragraph({
              children: [
                new TextRun({
                  text: `Gerado em: ${new Date(metadata.generatedAt).toLocaleString("pt-BR")}`,
                  italics: true,
                  size: 20,
                }),
              ],
              spacing: { before: 600 },
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Por: ${metadata.generatedBy}`,
                  italics: true,
                  size: 20,
                }),
              ],
            }),
          ],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    return buffer
  } catch (error) {
    console.error("[v0] Erro ao gerar DOCX:", error)
    // Fallback to simple text format
    return generateSimpleMapaCotacao(data)
  }
}

function generateSimpleMapaCotacao(data: MapaData): Buffer {
  const { purchase, proposals, metadata } = data

  const content = `
MAPA DE COTAÇÃO

Instituição: ${purchase.instituicao.toUpperCase()}
Projeto: ${purchase.projeto}
Termo de Parceria: ${purchase.termoParceria}
Rubrica: ${purchase.rubrica}

OBJETO:
${purchase.objeto}

JUSTIFICATIVA:
${purchase.justificativa}

PROPOSTAS RECEBIDAS:

${proposals
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
${proposals[0]?.fornecedor || "Não definido"}
Valor: R$ ${(proposals[0]?.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}

Gerado em: ${new Date(metadata.generatedAt).toLocaleString("pt-BR")}
Por: ${metadata.generatedBy}
`

  return Buffer.from(content, "utf-8")
}

function formatCNPJ(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "")
  if (clean.length !== 14) return cnpj
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
}

function formatDate(date: string): string {
  try {
    const d = new Date(date)
    return d.toLocaleDateString("pt-BR")
  } catch {
    return date
  }
}
