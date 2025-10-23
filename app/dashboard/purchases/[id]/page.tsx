"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, Download, FileText, Calendar, DollarSign, Building2 } from "lucide-react"
import type { Purchase } from "@/lib/types"

export default function PurchaseDetailPage() {
  const router = useRouter()
  const params = useParams()
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (params.id) {
      loadPurchase(params.id as string)
    }
  }, [params.id])

  const loadPurchase = async (id: string) => {
    try {
      const response = await fetch(`/api/purchases/${id}`)
      if (response.ok) {
        const data = await response.json()
        setPurchase(data)
      }
    } catch (error) {
      console.error("Erro ao carregar prestação:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateMapa = async () => {
    if (!purchase) return

    try {
      const response = await fetch("/api/generate-mapa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseId: purchase.id,
          generatedBy: "Usuário",
        }),
      })

      if (!response.ok) throw new Error("Erro ao gerar mapa")

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `mapa-cotacao-${purchase.id}.docx`
      a.click()
    } catch (error) {
      console.error("Erro:", error)
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

  if (!purchase) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Prestação não encontrada</p>
        <Button onClick={() => router.push("/dashboard/purchases")}>Voltar</Button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <Button variant="ghost" onClick={() => router.push("/dashboard/purchases")} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">Detalhes da Prestação</h1>
            <p className="text-muted-foreground">Visualize todas as informações</p>
          </div>
          <Button onClick={handleGenerateMapa}>
            <Download className="mr-2 h-4 w-4" />
            Baixar Mapa
          </Button>
        </div>

        <div className="space-y-6">
          {/* Informações Gerais */}
          <Card>
            <CardHeader>
              <CardTitle>Informações Gerais</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Instituição</p>
                  <p className="text-lg font-semibold">{purchase.instituicao}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Projeto</p>
                  <p className="text-lg font-semibold">{purchase.projeto}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Termo de Parceria</p>
                  <p className="text-lg">{purchase.termoParceria}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Rubrica</p>
                  <p className="text-lg">{purchase.rubrica}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Objeto</p>
                <p className="text-sm leading-relaxed">{purchase.objeto}</p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-muted-foreground">Justificativa</p>
                <p className="text-sm leading-relaxed">{purchase.justificativa}</p>
              </div>
            </CardContent>
          </Card>

          {/* Nota Fiscal */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                <CardTitle>Nota Fiscal</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="flex items-start gap-3">
                  <Building2 className="mt-1 h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Favorecido</p>
                    <p className="font-semibold">{purchase.favorecido}</p>
                    <p className="text-sm text-muted-foreground">{purchase.cnpjFavorecido}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <FileText className="mt-1 h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Número NF</p>
                    <p className="font-semibold">{purchase.numeroNF}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="mt-1 h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Valor</p>
                    <p className="font-semibold">
                      R$ {purchase.valorNF.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="mt-1 h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Data de Emissão</p>
                    <p className="font-semibold">{new Date(purchase.dataEmissaoNF).toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Propostas */}
          <Card>
            <CardHeader>
              <CardTitle>Propostas Recebidas</CardTitle>
              <CardDescription>{purchase.propostas.length} proposta(s) cadastrada(s)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {purchase.propostas.map((proposta, index) => (
                  <div key={index} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-semibold">{proposta.fornecedor}</h4>
                      <Badge variant={index === 0 ? "default" : "secondary"}>
                        {index === 0 ? "Vencedora" : `Proposta ${index + 1}`}
                      </Badge>
                    </div>
                    <div className="grid gap-2 text-sm md:grid-cols-3">
                      <div>
                        <span className="text-muted-foreground">CNPJ:</span>
                        <p className="font-medium">{proposta.cnpj}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Valor:</span>
                        <p className="font-medium">
                          R$ {proposta.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Data:</span>
                        <p className="font-medium">{new Date(proposta.dataEmissao).toLocaleDateString("pt-BR")}</p>
                      </div>
                    </div>
                    {proposta.numeroDocumento && (
                      <p className="mt-2 text-sm text-muted-foreground">Documento: {proposta.numeroDocumento}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
