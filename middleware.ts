import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Rotas públicas que não precisam de autenticação
  const publicRoutes = ["/login", "/api/auth/login"]

  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Para rotas protegidas, verificar se há token (simplificado)
  // Em produção, validar o token no servidor
  const authHeader = request.headers.get("authorization")

  // Permitir acesso a rotas de API sem verificação de header (será verificado no handler)
  if (pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  // Redirecionar para login se não autenticado (verificação client-side)
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
