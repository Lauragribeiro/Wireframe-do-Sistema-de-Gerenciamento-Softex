import type { ExtractedData } from "../types"
import { extractWithGPT } from "./openai-client"

const DOCUMENT_PROMPT = `Analise o documento e extraia as seguintes informações:

- instituicao: "vertex" ou "edge" (identifique pela instituição mencionada)
- cnpj: CNPJ da instituição (apenas números)
- termoParceria: número do termo de parceria
- projeto: nome do projeto
- rubrica: código ou nome da rubrica
- naturezaDispendio: tipo de despesa
- favorecido: nome do fornecedor/favorecido
- cnpjFavorecido: CNPJ do favorecido (apenas números)
- numeroNF: número da nota fiscal
- valorNF: valor da nota fiscal (número decimal)
- dataEmissaoNF: data de emissão da NF (formato YYYY-MM-DD)
- dataPagamento: data do pagamento (formato YYYY-MM-DD)
- objeto: descrição do objeto da compra
- justificativa: justificativa da dispensa de licitação

Retorne JSON com os campos encontrados. Se um campo não for encontrado, omita-o.`

export async function extractDocumentData(text: string, imageUrl?: string): Promise<ExtractedData> {
  try {
    console.log("[v0] Iniciando extração de dados do documento")

    const fullPrompt = `${DOCUMENT_PROMPT}\n\nTexto do documento:\n${text}`
    const result = await extractWithGPT(fullPrompt, imageUrl, 2)

    const data: ExtractedData = {
      instituicao: result.instituicao === "edge" ? "edge" : "vertex",
      cnpj: result.cnpj ? String(result.cnpj).replace(/\D/g, "") : undefined,
      termoParceria: result.termoParceria,
      projeto: result.projeto,
      rubrica: result.rubrica,
      naturezaDispendio: result.naturezaDispendio,
      favorecido: result.favorecido,
      cnpjFavorecido: result.cnpjFavorecido ? String(result.cnpjFavorecido).replace(/\D/g, "") : undefined,
      numeroNF: result.numeroNF,
      valorNF: result.valorNF ? Number.parseFloat(String(result.valorNF).replace(",", ".")) : undefined,
      dataEmissaoNF: result.dataEmissaoNF,
      dataPagamento: result.dataPagamento,
      objeto: result.objeto,
      justificativa: result.justificativa,
    }

    console.log("[v0] Dados extraídos com sucesso")
    return data
  } catch (error) {
    console.error("[v0] Erro ao extrair dados do documento:", error)
    return {}
  }
}
