# Roadmap de Desenvolvimento — Sistema Softex

## Fase 1: Planejamento & Modelagem
- [x] Levantar requisitos e fluxos principais
- [ ] Desenhar modelo de dados (ERD)
- [ ] Especificar endpoints e contratos de API (OpenAPI/Swagger)

## Fase 2: Backend
- [ ] Configurar projeto Node.js/Express
- [ ] Modelos e migrations (Sequelize ou equivalente)
- [ ] Implementar autenticação (JWT/sessão)
- [ ] CRUD de Projetos
- [ ] CRUD de Lançamentos Financeiros (incluindo OCR)
- [ ] Upload/download de arquivos (integração com storage)
- [ ] Geração de documentos (docxtemplater/mammoth)
- [ ] Estruturação e download de pacotes finais (ZIP/PDF)
- [ ] Administração (templates, rubricas, usuários)
- [ ] Testes unitários e integração

## Fase 3: MVP OCR & Automação
- [ ] Implementar endpoint OCR para extração automática de dados financeiros
- [ ] Automatizar preenchimento da tabela financeira

## Fase 4: Frontend
- [ ] Configurar projeto (React, Next.js ou Vue.js)
- [ ] Tela de Login
- [ ] Dashboard de Projetos
- [ ] Prestação de Contas (tabela editável, abas)
- [ ] Automação e preview de documentos
- [ ] Download de pacotes finais
- [ ] Telas administrativas
- [ ] Tela de perfil

## Fase 5: Deploy & QA
- [ ] Configurar ambiente de produção
- [ ] Deploy frontend e backend
- [ ] Testes de aceitação (E2E)
- [ ] Ajustes finais e documentação

---

**Dicas:**  
- Priorize o fluxo de autenticação e CRUD financeiro/Projetos.
- Em paralelo, avance o OCR e geração de documentos como MVP.
- Documente cada endpoint e modelo para facilitar o trabalho do frontend


📊 Wireframe do Sistema de Gerenciamento Softex
1. Tela de Login

Campos

 Email

 Senha

Botões

[Entrar]

[Esqueci minha senha]

Extras

Logo da Softex

Link para "Ajuda / FAQ"

2. Dashboard de Projetos

Header

Logo Softex + Nome do Sistema

Menu: Projetos | Prestação de Contas | Administração | Perfil

Conteúdo

Botão [+ Novo Projeto]

Lista em cards/tabela com:

Nome do Projeto

Código

Vigência

Responsável

Status (Em andamento, Finalizado, Pendente)

[Acessar Prestação de Contas]

3. Prestação de Contas (por Projeto)

Tabs

Documentação Financeira | Automação de Documentos | Pacote Final

3.1 Aba "Documentação Financeira"

Tabela (tipo Airtable/Excel) com colunas:

Favorecido

PC (drop-down: 1, 2, 3, 4)

CNPJ

Nº NF/Recibo

Nº Extrato

Data Pagamento (calendário)

Valor Pago (R$)

Rubrica (drop-down: Custos Incorridos, Equipamentos, Infraestrutura, Outros correlatos, etc.)

Mês de Referência

Justificativa (texto)

Anexos (upload múltiplo, drag & drop)

Botões

[Adicionar Linha]

[Importar Documentos] (com OCR/Parser para preencher automático)

[Salvar]

3.2 Aba "Automação de Documentos"

Campos/Formulário

Seletor: Tipo de Rubrica (custos incorridos, equipamentos, etc.)

Formulário inteligente: exibe os campos obrigatórios de cada rubrica.

Upload dos documentos-base (nota fiscal, extrato, ofício, cotações etc.).

Botões

[Gerar Folha de Rosto]

[Gerar Nota de Débito]

[Gerar Mapa de Cotação]

[Gerar Ofício]

[Gerar Ordem de Fornecimento]

Preview

Visualização do documento gerado em PDF/Word antes de salvar.

3.3 Aba "Pacote Final"

Passos (wizard/etapas):

Selecionar processo de compra (lista do projeto).

O sistema organiza os documentos exigidos pela rubrica.

Preview da ordem final.

Botões

[Baixar em PDF Único]

[Baixar ZIP com todos os anexos]

4. Tela Administrativa

Configurações

Upload de modelos (Folha de Rosto, Nota de Débito, Mapa de Cotação).

Cadastro/Edição de Rubricas (nome + documentos obrigatórios).

Gestão de usuários e permissões.

Botões

[Adicionar Rubrica]

[Adicionar Template]

[Salvar Configurações]

5. Tela de Perfil do Usuário

Nome, Email, Cargo, Projetos atribuídos.

Botão [Alterar Senha].

Preferências de Notificação (checkboxes).

🔄 Fluxo Geral do Usuário

Faz login.

Cria/clica em um projeto no Dashboard.

Preenche ou importa dados na aba Documentação Financeira.

O sistema lê os anexos e gera automaticamente os campos.

Na aba Automação de Documentos, gera os documentos exigidos por rubrica.

Na aba Pacote Final, organiza tudo e baixa o dossiê completo.



