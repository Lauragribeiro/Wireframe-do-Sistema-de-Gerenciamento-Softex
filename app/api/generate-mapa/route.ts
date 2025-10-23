import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { generateMapaCotacao } from "@/lib/docx/generate-mapa"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { purchaseId, generatedBy } = body

    if (!purchaseId) {
      return NextResponse.json({ error: "ID da compra não fornecido" }, { status: 400 })
    }

    const purchase = await db.purchases.getById(purchaseId)

    if (!purchase) {
      return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 })
    }

    const buffer = await generateMapaCotacao({
      purchase,
      proposals: purchase.propostas,
      metadata: {
        generatedAt: new Date().toISOString(),
        generatedBy: generatedBy || "Sistema",
      },
    })

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="mapa-cotacao-${purchase.id}.docx"`,
      },
    })
  } catch (error) {
    console.error("[v0] Erro ao gerar mapa:", error)
    return NextResponse.json({ error: "Erro ao gerar mapa de cotação" }, { status: 500 })
  }
}
