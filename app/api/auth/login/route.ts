import { type NextRequest, NextResponse } from "next/server"
import { authenticate } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: "Email e senha são obrigatórios" }, { status: 400 })
    }

    const session = await authenticate(email, password)

    if (!session) {
      return NextResponse.json({ error: "Credenciais inválidas" }, { status: 401 })
    }

    return NextResponse.json(session)
  } catch (error) {
    console.error("[v0] Erro no login:", error)
    return NextResponse.json({ error: "Erro ao fazer login" }, { status: 500 })
  }
}
