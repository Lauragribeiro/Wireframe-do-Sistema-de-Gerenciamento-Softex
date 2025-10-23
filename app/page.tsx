export default function Page() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-foreground">Sistema de Gerenciamento Softex</h1>
          <p className="mt-2 text-muted-foreground">Gerencie prestações de contas, documentos e mapas de cotação</p>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-card-foreground">Nova Prestação</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Crie uma nova prestação de contas com upload de documentos
            </p>
            <button className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Criar Nova
            </button>
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-card-foreground">Minhas Prestações</h2>
            <p className="mt-2 text-sm text-muted-foreground">Visualize e gerencie todas as prestações de contas</p>
            <button className="mt-4 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/90">
              Ver Todas
            </button>
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-card-foreground">Gerar Documentos</h2>
            <p className="mt-2 text-sm text-muted-foreground">Exporte mapas de cotação e outros documentos</p>
            <button className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent/90">
              Gerar
            </button>
          </div>
        </div>

        <div className="mt-8 rounded-lg border bg-card p-6">
          <h2 className="text-2xl font-semibold text-card-foreground">Status da Sincronização</h2>
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">Tipos e banco de dados sincronizados</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">APIs de upload e extração configuradas</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">Módulos de IA para extração de propostas ativos</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="text-sm text-muted-foreground">
                Aguardando módulo de geração de mapa de cotação (DOCX)
              </span>
            </div>
          </div>
        </div>

        <div className="mt-8 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-6">
          <h3 className="font-semibold text-yellow-700 dark:text-yellow-400">Próximos Passos</h3>
          <ul className="mt-2 space-y-1 text-sm text-yellow-600 dark:text-yellow-300">
            <li>• Adicionar módulo de geração de documentos DOCX (lib/docx/generate-mapa.ts)</li>
            <li>• Criar API de geração de mapa de cotação (app/api/generate-mapa/route.ts)</li>
            <li>• Corrigir problema de campos em branco no mapa de cotação</li>
            <li>• Configurar variável de ambiente OPENAI_API_KEY</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
