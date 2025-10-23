import { type NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const purchase = await db.purchases.getById(id)

    if (!purchase) {
      return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 })
    }

    return NextResponse.json(purchase)
  } catch (error) {
    console.error("[v0] Erro ao buscar compra:", error)
    return NextResponse.json({ error: "Erro ao buscar compra" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const updated = await db.purchases.update(id, body)

    if (!updated) {
      return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    console.error("[v0] Erro ao atualizar compra:", error)
    return NextResponse.json({ error: "Erro ao atualizar compra" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const deleted = await db.purchases.delete(id)

    if (!deleted) {
      return NextResponse.json({ error: "Compra não encontrada" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Erro ao deletar compra:", error)
    return NextResponse.json({ error: "Erro ao deletar compra" }, { status: 500 })
  }
}
