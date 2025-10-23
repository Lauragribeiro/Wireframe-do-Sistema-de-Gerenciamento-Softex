import OpenAI from "openai"

let openaiInstance: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY não configurada")
    }
    openaiInstance = new OpenAI({ apiKey })
  }
  return openaiInstance
}

export async function extractWithGPT(prompt: string, imageUrl?: string, maxRetries = 3): Promise<any> {
  const client = getOpenAIClient()

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[v0] Tentativa ${attempt} de extração com GPT`)

      const messages: any[] = [
        {
          role: "system",
          content:
            "Você é um assistente especializado em extrair dados estruturados de documentos. Sempre retorne JSON válido.",
        },
        {
          role: "user",
          content: imageUrl
            ? [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageUrl } },
              ]
            : prompt,
        },
      ]

      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error("Resposta vazia do GPT")
      }

      const parsed = JSON.parse(content)
      console.log(`[v0] Extração bem-sucedida na tentativa ${attempt}`)
      return parsed
    } catch (error) {
      console.error(`[v0] Erro na tentativa ${attempt}:`, error)
      if (attempt === maxRetries) {
        throw new Error(`Falha após ${maxRetries} tentativas: ${error}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
}
