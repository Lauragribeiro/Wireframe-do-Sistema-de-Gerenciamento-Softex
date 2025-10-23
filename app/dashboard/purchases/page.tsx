"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Download, Eye, Trash2 } from "lucide-react"
import type { Purchase } from "@/lib/types"

export default function PurchasesPage() {
  const router = useRouter()
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPurchases()
  }, [])

  const loadPurchases = async () => {
    try {
      const response = await fetch("/api/purchases")
      const data = await response.json()
      setPurchases(data)
    } catch (error) {
      console.error("Erro ao carregar compras:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta prestação?")) return

    try {
      await fetch(`/api/purchases/${id}`, { method: "DELETE" })
      loadPurchases()
    } catch (error) {
      console.error("Erro ao excluir:", error)
    }
  }

  const handleGenerateMapa = async (id: string) => {
    try {
      const response = await fetch("/api/generate-mapa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: id, generatedBy: "Usuário" }),
      })

      if (!response.ok) throw new Error("Erro ao gerar mapa")

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `mapa-cotacao-${id}.docx`
      a.click()
    } catch (error) {
      console.error("Erro ao gerar mapa:", error)
      alert("Erro ao gerar mapa de cotação")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p>Carregando...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Button variant="ghost" onClick={() => router.push("/dashboard")} className="mb-2">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
            <h1 className="text-3xl font-bold">Minhas Prestações</h1>
            <p className="text-muted-foreground">Gerencie todas as prestações de contas</p>
          </div>
          <Button onClick={() => router.push("/dashboard/new")}>Nova Prestação</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Prestações de Contas</CardTitle>
            <CardDescription>{purchases.length} prestação(ões) cadastrada(s)</CardDescription>
          </CardHeader>
          <CardContent>
            {purchases.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">Nenhuma prestação cadastrada ainda.</p>
                <Button className="mt-4" onClick={() => router.push("/dashboard/new")}>
                  Criar Primeira Prestação
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Favorecido</TableHead>
                    <TableHead>NF</TableHead>
                    <TableHead>Valor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Propostas</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell className="font-medium">{purchase.projeto}</TableCell>
                      <TableCell>{purchase.favorecido}</TableCell>
                      <TableCell>{purchase.numeroNF}</TableCell>
                      <TableCell>R$ {purchase.valorNF.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell>{new Date(purchase.dataEmissaoNF).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{purchase.propostas.length} propostas</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/dashboard/purchases/${purchase.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleGenerateMapa(purchase.id)}>
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(purchase.id)}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
