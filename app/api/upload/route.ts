import { type NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { extractDocumentData } from "@/lib/ai/extract-document-data"
import { extractProposals } from "@/lib/ai/extract-proposals"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()

    // Extract all files
    const nfFile = formData.get("nf") as File | null
    const oficioFile = formData.get("oficio") as File | null
    const ordemFile = formData.get("ordem") as File | null
    const cotacaoFiles = formData.getAll("cotacoes") as File[]

    console.log("[v0] Recebidos arquivos:", {
      nf: nfFile?.name,
      oficio: oficioFile?.name,
      ordem: ordemFile?.name,
      cotacoes: cotacaoFiles.length,
    })

    // Create upload directory
    const uploadDir = path.join(
      process.cwd(),
      "data",
      "uploads",
      new Date().getFullYear().toString(),
      String(new Date().getMonth() + 1).padStart(2, "0"),
    )
    await mkdir(uploadDir, { recursive: true })

    const savedFiles: any = {}
    let extractedData: any = {}

    // Process NF file
    if (nfFile) {
      const nfBuffer = Buffer.from(await nfFile.arrayBuffer())
      const nfPath = path.join(uploadDir, `nf-${Date.now()}-${nfFile.name}`)
      await writeFile(nfPath, nfBuffer)
      savedFiles.nf = nfPath

      console.log("[v0] Extraindo dados da NF...")
      const nfText = await extractTextFromFile(nfBuffer, nfFile.name)
      const nfData = await extractDocumentData(nfText)
      extractedData = { ...extractedData, ...nfData }
    }

    // Process Oficio file
    if (oficioFile) {
      const oficioBuffer = Buffer.from(await oficioFile.arrayBuffer())
      const oficioPath = path.join(uploadDir, `oficio-${Date.now()}-${oficioFile.name}`)
      await writeFile(oficioPath, oficioBuffer)
      savedFiles.oficio = oficioPath
    }

    // Process Ordem file
    if (ordemFile) {
      const ordemBuffer = Buffer.from(await ordemFile.arrayBuffer())
      const ordemPath = path.join(uploadDir, `ordem-${Date.now()}-${ordemFile.name}`)
      await writeFile(ordemPath, ordemBuffer)
      savedFiles.ordem = ordemPath
    }

    // Process Cotacao files and extract proposals
    const propostas: any[] = []
    for (let i = 0; i < cotacaoFiles.length; i++) {
      const cotFile = cotacaoFiles[i]
      const cotBuffer = Buffer.from(await cotFile.arrayBuffer())
      const cotPath = path.join(uploadDir, `cotacao-${i + 1}-${Date.now()}-${cotFile.name}`)
      await writeFile(cotPath, cotBuffer)

      if (!savedFiles.cotacoes) savedFiles.cotacoes = []
      savedFiles.cotacoes.push(cotPath)

      console.log(`[v0] Extraindo proposta da cotação ${i + 1}...`)
      const cotText = await extractTextFromFile(cotBuffer, cotFile.name)
      const cotProposals = await extractProposals(cotText)
      propostas.push(...cotProposals)
    }

    extractedData.propostas = propostas

    console.log("[v0] Extração concluída:", {
      arquivos: Object.keys(savedFiles).length,
      propostas: propostas.length,
    })

    return NextResponse.json({
      success: true,
      files: savedFiles,
      extractedData,
    })
  } catch (error) {
    console.error("[v0] Erro no upload:", error)
    return NextResponse.json({ error: "Erro ao processar arquivos", details: String(error) }, { status: 500 })
  }
}

async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase()

  try {
    // XML files (NF-e)
    if (ext === ".xml") {
      return buffer.toString("utf-8")
    }

    // PDF files - basic text extraction
    if (ext === ".pdf") {
      // In production, use pdf-parse or pdfjs-dist
      // For now, return empty string and rely on AI to handle
      console.log("[v0] PDF detected, usando extração básica")
      return buffer.toString("utf-8")
    }

    // Image files - would use OCR in production
    if ([".png", ".jpg", ".jpeg"].includes(ext)) {
      console.log("[v0] Imagem detectada, OCR seria aplicado aqui")
      return ""
    }

    // Default: try to read as text
    return buffer.toString("utf-8")
  } catch (error) {
    console.error("[v0] Erro ao extrair texto:", error)
    return ""
  }
}
