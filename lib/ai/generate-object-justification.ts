import { extractWithGPT } from "./openai-client"

export async function generateObjectAndJustification(
  purchaseData: any,
): Promise<{ objeto: string; justificativa: string }> {
  try {
    console.log("[v0] Gerando objeto e justificativa")

    const prompt = `Com base nos dados da compra abaixo, gere:

1. OBJETO: Uma descrição clara e concisa do objeto da compra (1-2 frases)
2. JUSTIFICATIVA: Uma justificativa técnica para dispensa de licitação, explicando:
   - Por que este fornecedor foi escolhido
   - Características técnicas do produto/serviço
   - Urgência ou especificidade da demanda
   - Conformidade com a legislação

Dados da compra:
${JSON.stringify(purchaseData, null, 2)}

Retorne no formato JSON:
{
  "objeto": "Descrição do objeto...",
  "justificativa": "Justificativa detalhada..."
}`

    const result = await extractWithGPT(prompt, undefined, 2)

    return {
      objeto: result.objeto || "Objeto não especificado",
      justificativa: result.justificativa || "Justificativa não especificada",
    }
  } catch (error) {
    console.error("[v0] Erro ao gerar objeto e justificativa:", error)
    return {
      objeto: "Objeto não especificado",
      justificativa: "Justificativa não especificada",
    }
  }
}
