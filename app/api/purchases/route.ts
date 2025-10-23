import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import type { Purchase } from "@/lib/types"
import { generateObjectAndJustification } from "@/lib/ai/generate-object-justification"

export async function GET() {
  try {
    const purchases = await db.purchases.getAll()
    return NextResponse.json(purchases)
  } catch (error) {
    console.error("[v0] Erro ao buscar compras:", error)
    return NextResponse.json({ error: "Erro ao buscar compras" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log("[v0] Criando nova compra:", body)

    let { objeto, justificativa } = body

    if (!objeto || !justificativa || objeto.trim() === "" || justificativa.trim() === "") {
      console.log("[v0] Gerando objeto e justificativa automaticamente")
      const generated = await generateObjectAndJustification(body)
      objeto = objeto || generated.objeto
      justificativa = justificativa || generated.justificativa
    }

    const purchase: Purchase = {
      id: `purchase-${Date.now()}`,
      instituicao: body.instituicao || "vertex",
      cnpj: body.cnpj || "",
      termoParceria: body.termoParceria || "",
      projeto: body.projeto || "",
      rubrica: body.rubrica || "",
      naturezaDispendio: body.naturezaDispendio || "",
      favorecido: body.favorecido || "",
      cnpjFavorecido: body.cnpjFavorecido || "",
      numeroNF: body.numeroNF || "",
      valorNF: body.valorNF || 0,
      dataEmissaoNF: body.dataEmissaoNF || new Date().toISOString().split("T")[0],
      dataPagamento: body.dataPagamento || new Date().toISOString().split("T")[0],
      objeto,
      justificativa,
      propostas: body.propostas || [],
      documentos: body.documentos || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    console.log("[v0] Compra criada com sucesso:", purchase.id)
    const created = await db.purchases.create(purchase)
    return NextResponse.json(created)
  } catch (error) {
    console.error("[v0] Erro ao criar compra:", error)
    return NextResponse.json({ error: "Erro ao criar compra" }, { status: 500 })
  }
}
