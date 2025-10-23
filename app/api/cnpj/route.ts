import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const cnpj = searchParams.get("cnpj")

    if (!cnpj) {
      return NextResponse.json({ error: "CNPJ não fornecido" }, { status: 400 })
    }

    const cleanCNPJ = cnpj.replace(/\D/g, "")

    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCNPJ}`)
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.log("[v0] BrasilAPI falhou, tentando ReceitaWS")
    }

    try {
      const response = await fetch(`https://www.receitaws.com.br/v1/cnpj/${cleanCNPJ}`)
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch (error) {
      console.error("[v0] ReceitaWS também falhou")
    }

    return NextResponse.json({ error: "CNPJ não encontrado" }, { status: 404 })
  } catch (error) {
    console.error("[v0] Erro ao consultar CNPJ:", error)
    return NextResponse.json({ error: "Erro ao consultar CNPJ" }, { status: 500 })
  }
}
