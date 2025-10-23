import type { Proposal } from "../types"
import { extractWithGPT } from "./openai-client"

const PROPOSALS_PROMPT = `Analise o documento e extraia TODAS as propostas de cotação encontradas.

Para cada proposta, extraia:
- fornecedor: nome completo da empresa
- cnpj: CNPJ formatado (apenas números)
- valor: valor numérico (sem R$ ou pontos, apenas números e vírgula decimal)
- dataEmissao: data no formato YYYY-MM-DD
- numeroDocumento: número da nota/proposta (opcional)

IMPORTANTE:
1. Extraia TODAS as propostas encontradas, não apenas uma
2. Se houver múltiplas propostas, retorne um array com todas elas
3. Normalize os valores removendo símbolos de moeda
4. Converta datas para formato ISO (YYYY-MM-DD)
5. Remova caracteres especiais do CNPJ (apenas números)

Retorne no formato JSON:
{
  "propostas": [
    {
      "fornecedor": "Nome da Empresa 1",
      "cnpj": "12345678000190",
      "valor": 1500.50,
      "dataEmissao": "2025-01-15",
      "numeroDocumento": "NF-001"
    },
    {
      "fornecedor": "Nome da Empresa 2",
      "cnpj": "98765432000110",
      "valor": 1800.00,
      "dataEmissao": "2025-01-16",
      "numeroDocumento": "NF-002"
    }
  ]
}`

export async function extractProposals(text: string, imageUrl?: string): Promise<Proposal[]> {
  try {
    console.log("[v0] Iniciando extração de propostas")

    const fullPrompt = `${PROPOSALS_PROMPT}\n\nTexto do documento:\n${text}`
    const result = await extractWithGPT(fullPrompt, imageUrl, 3)

    if (!result.propostas || !Array.isArray(result.propostas)) {
      console.error("[v0] Formato inválido de propostas:", result)
      return []
    }

    const proposals: Proposal[] = result.propostas.map((p: any) => ({
      fornecedor: p.fornecedor || "",
      cnpj: String(p.cnpj || "").replace(/\D/g, ""),
      valor: Number.parseFloat(String(p.valor || 0).replace(",", ".")),
      dataEmissao: p.dataEmissao || new Date().toISOString().split("T")[0],
      numeroDocumento: p.numeroDocumento,
    }))

    console.log(`[v0] ${proposals.length} propostas extraídas com sucesso`)
    return proposals
  } catch (error) {
    console.error("[v0] Erro ao extrair propostas:", error)
    return []
  }
}
