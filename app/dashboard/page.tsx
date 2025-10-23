"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Plus, List, LogOut, User } from "lucide-react"
import type { User as AuthUser } from "@/lib/auth"

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Verificar autenticação
    const sessionData = localStorage.getItem("auth_session") || sessionStorage.getItem("auth_session")

    if (!sessionData) {
      router.push("/login")
      return
    }

    try {
      const session = JSON.parse(sessionData)
      setUser(session.user)
    } catch {
      router.push("/login")
    } finally {
      setLoading(false)
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem("auth_session")
    sessionStorage.removeItem("auth_session")
    router.push("/login")
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Carregando...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between p-4">
          <div>
            <h1 className="text-2xl font-bold">Sistema de Gerenciamento Softex</h1>
            <p className="text-sm text-muted-foreground">Dashboard</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4" />
              <div className="text-sm">
                <p className="font-medium">{user?.name}</p>
                <p className="text-muted-foreground">{user?.role}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl p-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold">Bem-vindo, {user?.name}!</h2>
          <p className="mt-2 text-muted-foreground">Gerencie prestações de contas, documentos e mapas de cotação</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg"
            onClick={() => router.push("/dashboard/new")}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <CardTitle>Nova Prestação</CardTitle>
              </div>
              <CardDescription>Crie uma nova prestação de contas com upload de documentos</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full">Criar Nova</Button>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg"
            onClick={() => router.push("/dashboard/purchases")}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <List className="h-5 w-5 text-secondary" />
                <CardTitle>Minhas Prestações</CardTitle>
              </div>
              <CardDescription>Visualize e gerencie todas as prestações de contas</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="secondary" className="w-full">
                Ver Todas
              </Button>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer transition-shadow hover:shadow-lg"
            onClick={() => router.push("/dashboard/generate")}
          >
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-accent" />
                <CardTitle>Gerar Documentos</CardTitle>
              </div>
              <CardDescription>Exporte mapas de cotação e outros documentos</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full bg-transparent">
                Gerar
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Status Section */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Status do Sistema</CardTitle>
            <CardDescription>Funcionalidades disponíveis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">Sistema de autenticação ativo</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">Banco de dados sincronizado</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">APIs de upload e extração configuradas</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">Módulo de geração de mapa de cotação ativo</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">Extração de propostas com IA funcionando</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
