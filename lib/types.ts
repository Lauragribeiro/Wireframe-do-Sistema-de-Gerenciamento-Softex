// Tipos principais do sistema de gerenciamento Softex

export type Institution = "vertex" | "edge"

export interface Vendor {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string
  endereco?: string
  telefone?: string
  email?: string
  createdAt: string
}

export interface Proposal {
  fornecedor: string
  cnpj: string
  valor: number
  dataEmissao: string
  numeroDocumento?: string
}

export interface Purchase {
  id: string
  instituicao: Institution
  cnpj: string
  termoParceria: string
  projeto: string
  rubrica: string
  naturezaDispendio: string
  favorecido: string
  cnpjFavorecido: string
  numeroNF: string
  valorNF: number
  dataEmissaoNF: string
  dataPagamento: string
  objeto: string
  justificativa: string
  propostas: Proposal[]
  documentos: string[]
  createdAt: string
  updatedAt: string
}

export interface ExtractedData {
  instituicao?: Institution
  cnpj?: string
  termoParceria?: string
  projeto?: string
  rubrica?: string
  naturezaDispendio?: string
  favorecido?: string
  cnpjFavorecido?: string
  numeroNF?: string
  valorNF?: number
  dataEmissaoNF?: string
  dataPagamento?: string
  objeto?: string
  justificativa?: string
}

export interface CNPJData {
  cnpj: string
  razao_social: string
  nome_fantasia?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  telefone?: string
  email?: string
}
