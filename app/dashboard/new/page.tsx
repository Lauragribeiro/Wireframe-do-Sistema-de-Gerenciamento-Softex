"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ArrowLeft, Upload, FileText, Loader2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export default function NewPurchasePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>("")

  // Form state
  const [instituicao, setInstituicao] = useState("SOFTEX")
  const [projeto, setProjeto] = useState("")
  const [termoParceria, setTermoParceria] = useState("")
  const [rubrica, setRubrica] = useState("")
  const [objeto, setObjeto] = useState("")
  const [justificativa, setJustificativa] = useState("")

  // Files state
  const [nfFile, setNfFile] = useState<File | null>(null)
  const [oficioFile, setOficioFile] = useState<File | null>(null)
  const [ordemFile, setOrdemFile] = useState<File | null>(null)
  const [cotacaoFiles, setCotacaoFiles] = useState<File[]>([])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setUploadProgress("Preparando arquivos...")

    try {
      const formData = new FormData()

      // Add form fields
      formData.append("instituicao", instituicao)
      formData.append("projeto", projeto)
      formData.append("termoParceria", termoParceria)
      formData.append("rubrica", rubrica)
      formData.append("objeto", objeto)
      formData.append("justificativa", justificativa)

      // Add files
      if (nfFile) formData.append("nf", nfFile)
      if (oficioFile) formData.append("oficio", oficioFile)
      if (ordemFile) formData.append("ordem", ordemFile)
      cotacaoFiles.forEach((file) => formData.append("cotacoes", file))

      setUploadProgress("Enviando documentos...")

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Erro ao enviar documentos")
      }

      const result = await response.json()

      setUploadProgress("Extraindo dados dos documentos...")

      // Create purchase with extracted data
      const purchaseResponse = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instituicao,
          projeto,
          termoParceria,
          rubrica,
          objeto,
          justificativa,
          ...result.extractedData,
        }),
      })

      if (!purchaseResponse.ok) {
        throw new Error("Erro ao criar prestação")
      }

      setUploadProgress("Concluído!")
      router.push("/dashboard/purchases")
    } catch (error) {
      console.error("Erro:", error)
      alert("Erro ao criar prestação. Tente novamente.")
    } finally {
      setLoading(false)
      setUploadProgress("")
    }
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" onClick={() => router.push("/dashboard")} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="mb-6">
          <h1 className="text-3xl font-bold">Nova Prestação de Contas</h1>
          <p className="text-muted-foreground">Preencha os dados e faça upload dos documentos</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Dados do Projeto */}
          <Card>
            <CardHeader>
              <CardTitle>Dados do Projeto</CardTitle>
              <CardDescription>Informações básicas da prestação</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="instituicao">Instituição</Label>
                  <Select value={instituicao} onValueChange={setInstituicao}>
                    <SelectTrigger id="instituicao">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SOFTEX">SOFTEX</SelectItem>
                      <SelectItem value="OUTRA">Outra Instituição</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="projeto">Código do Projeto</Label>
                  <Input
                    id="projeto"
                    value={projeto}
                    onChange={(e) => setProjeto(e.target.value)}
                    placeholder="Ex: PROJ-2025-001"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="termo">Termo de Parceria</Label>
                  <Input
                    id="termo"
                    value={termoParceria}
                    onChange={(e) => setTermoParceria(e.target.value)}
                    placeholder="Ex: TP-001/2025"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rubrica">Rubrica</Label>
                  <Input
                    id="rubrica"
                    value={rubrica}
                    onChange={(e) => setRubrica(e.target.value)}
                    placeholder="Ex: 3.1.1"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="objeto">Objeto</Label>
                <Textarea
                  id="objeto"
                  value={objeto}
                  onChange={(e) => setObjeto(e.target.value)}
                  placeholder="Descreva o objeto da prestação..."
                  rows={3}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="justificativa">Justificativa</Label>
                <Textarea
                  id="justificativa"
                  value={justificativa}
                  onChange={(e) => setJustificativa(e.target.value)}
                  placeholder="Justifique a necessidade da aquisição..."
                  rows={4}
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Upload de Documentos */}
          <Card>
            <CardHeader>
              <CardTitle>Documentos</CardTitle>
              <CardDescription>Faça upload dos documentos necessários</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nf">Nota Fiscal (NF)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="nf"
                    type="file"
                    accept=".pdf,.xml,.png,.jpg,.jpeg"
                    onChange={(e) => setNfFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                  />
                  {nfFile && <FileText className="h-5 w-5 text-green-500" />}
                </div>
                <p className="text-xs text-muted-foreground">Formatos: PDF, XML, PNG, JPG</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="oficio">Ofício</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="oficio"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setOficioFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                  />
                  {oficioFile && <FileText className="h-5 w-5 text-green-500" />}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ordem">Ordem de Compra</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ordem"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(e) => setOrdemFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                  />
                  {ordemFile && <FileText className="h-5 w-5 text-green-500" />}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cotacoes">Cotações (mínimo 3)</Label>
                <Input
                  id="cotacoes"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  multiple
                  onChange={(e) => setCotacaoFiles(Array.from(e.target.files || []))}
                  className="cursor-pointer"
                />
                {cotacaoFiles.length > 0 && (
                  <p className="text-sm text-green-600">{cotacaoFiles.length} arquivo(s) selecionado(s)</p>
                )}
                <p className="text-xs text-muted-foreground">Selecione pelo menos 3 cotações</p>
              </div>
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => router.push("/dashboard")} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || cotacaoFiles.length < 3} className="flex-1">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {uploadProgress || "Processando..."}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Criar Prestação
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
