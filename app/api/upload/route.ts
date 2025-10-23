import { type NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"
import { extractDocumentData } from "@/lib/ai/extract-document-data"
import { extractProposals } from "@/lib/ai/extract-proposals"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const type = formData.get("type") as string

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    const uploadDir = path.join(
      process.cwd(),
      "data",
      "uploads",
      new Date().getFullYear().toString(),
      String(new Date().getMonth() + 1).padStart(2, "0"),
    )
    await mkdir(uploadDir, { recursive: true })

    const filename = `${Date.now()}-${file.name}`
    const filepath = path.join(uploadDir, filename)
    await writeFile(filepath, buffer)

    console.log(`[v0] Arquivo salvo: ${filepath}`)

    let extractedData = {}
    const text = buffer.toString("utf-8")

    if (type === "proposals") {
      const proposals = await extractProposals(text)
      extractedData = { proposals }
    } else {
      extractedData = await extractDocumentData(text)
    }

    return NextResponse.json({
      success: true,
      filename,
      filepath: `/uploads/${filename}`,
      extractedData,
    })
  } catch (error) {
    console.error("[v0] Erro no upload:", error)
    return NextResponse.json({ error: "Erro ao processar arquivo" }, { status: 500 })
  }
}
