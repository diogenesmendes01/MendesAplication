# PRD: ERP Multi-Empresa — Mendes Application

## 1. Introdução / Overview

Sistema ERP web completo para gerenciar um ecossistema de 8+ empresas do mesmo grupo, todas atuando no segmento de serviços ou produtos online. O sistema centraliza operações financeiras, comerciais, fiscais e de atendimento ao cliente, eliminando processos manuais e planilhas, com visão consolidada para a administradora e visão isolada por empresa.

O diferencial principal é o fluxo de **Boleto-Proposta**: um processo comercial onde propostas são enviadas aos clientes junto com boletos de cobrança via integração com APIs de e-mail e geração de boletos (ex: PinBank), integrando CRM, cobrança e atendimento ao cliente em um único fluxo.

### Problema

- Dados espalhados em sistemas diferentes por empresa
- Falta de visão consolidada do ecossistema
- Processos manuais com retrabalho significativo
- Ausência de um fluxo integrado entre proposta comercial, cobrança e atendimento

---

## 2. Goals

- Centralizar a gestão de 8+ empresas em uma única plataforma web
- Oferecer visão consolidada (holding) e visão isolada (por empresa)
- Automatizar o fluxo Boleto-Proposta: proposta → boleto → envio por e-mail → acompanhamento
- Integrar CRM, cobrança e SAC em um fluxo contínuo
- Prover controle financeiro completo (fluxo de caixa, contas a pagar/receber, conciliação, DRE)
- Atender requisitos fiscais/contábeis (notas fiscais, impostos)
- Suportar ~20 usuários (administrador + gestores por empresa)
- Permitir adição de novas empresas ao ecossistema sem retrabalho

---

## 3. User Stories

### Módulo: Gestão de Empresas / Multi-Tenancy

#### US-001: Cadastro de empresa (tenant)
**Descrição:** Como administrador do grupo, quero cadastrar uma nova empresa no sistema para que ela passe a ser gerenciada pelo ERP.

**Critérios de Aceite:**
- [ ] Formulário com campos: razão social, nome fantasia, CNPJ, inscrição estadual, endereço, telefone, e-mail, logo, segmento
- [ ] Validação de CNPJ (formato e unicidade)
- [ ] Empresa criada com status ativo/inativo
- [ ] Dados persistidos no banco com isolamento por tenant
- [ ] Typecheck/lint passa

#### US-002: Painel de seleção de empresa
**Descrição:** Como usuário com acesso a múltiplas empresas, quero selecionar qual empresa estou operando para ver apenas os dados daquela empresa.

**Critérios de Aceite:**
- [ ] Seletor de empresa visível no header/sidebar
- [ ] Ao trocar empresa, todos os dados da tela atualizam para a empresa selecionada
- [ ] Última empresa selecionada é lembrada na próxima sessão
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-003: Dashboard consolidado (visão holding)
**Descrição:** Como administrador do grupo, quero ver um dashboard consolidado com indicadores de todas as empresas para ter visibilidade total do ecossistema.

**Critérios de Aceite:**
- [ ] Receita total, despesas, lucro — consolidado e por empresa
- [ ] Gráfico comparativo entre empresas
- [ ] Quantidade de boletos emitidos, pagos, vencidos — consolidado
- [ ] Filtro por período (dia, semana, mês, ano, personalizado)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-004: Gestão de usuários e permissões
**Descrição:** Como administrador, quero criar usuários e definir a quais empresas e módulos cada um tem acesso.

**Critérios de Aceite:**
- [ ] CRUD de usuários (nome, e-mail, senha, papel)
- [ ] Papéis: Administrador (vê tudo), Gestor de empresa (vê só sua empresa)
- [ ] Atribuir usuário a uma ou mais empresas
- [ ] Permissões por módulo (financeiro, comercial, SAC, fiscal)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Módulo: CRM / Comercial — Fluxo Boleto-Proposta

#### US-005: Cadastro de clientes
**Descrição:** Como gestor comercial, quero cadastrar clientes (PF/PJ) para poder enviar propostas e boletos.

**Critérios de Aceite:**
- [ ] Formulário com campos: nome/razão social, CPF/CNPJ, e-mail, telefone, endereço
- [ ] Clientes vinculados à empresa (tenant) — algumas empresas podem compartilhar clientes
- [ ] Busca e filtro por nome, CPF/CNPJ, e-mail
- [ ] Histórico de interações visível na ficha do cliente
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-006: Criação de proposta comercial
**Descrição:** Como gestor comercial, quero criar uma proposta comercial com itens/serviços e valores para enviar ao cliente.

**Critérios de Aceite:**
- [ ] Selecionar cliente existente ou cadastrar novo
- [ ] Adicionar itens à proposta (descrição, quantidade, valor unitário)
- [ ] Calcular total automaticamente
- [ ] Campos: condições de pagamento, validade da proposta, observações
- [ ] Status da proposta: rascunho, enviada, aceita, recusada, expirada
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-007: Geração de boleto vinculado à proposta
**Descrição:** Como gestor comercial, quero gerar um boleto a partir de uma proposta aceita para cobrar o cliente.

**Critérios de Aceite:**
- [ ] Botão "Gerar Boleto" na proposta aceita
- [ ] Integração com API de boletos (PinBank ou similar) para gerar boleto real
- [ ] Boleto vinculado à proposta (rastreabilidade)
- [ ] Opção de parcelamento (gerar múltiplos boletos)
- [ ] Status do boleto: gerado, enviado, pago, vencido, cancelado
- [ ] Typecheck/lint passa

#### US-008: Envio de proposta + boleto por e-mail
**Descrição:** Como gestor comercial, quero enviar a proposta e o boleto ao cliente por e-mail automaticamente.

**Critérios de Aceite:**
- [ ] Botão "Enviar por E-mail" na proposta/boleto
- [ ] Integração com API de envio de e-mail (SendGrid, SES, ou similar)
- [ ] Template de e-mail personalizável por empresa (logo, cores, texto)
- [ ] PDF da proposta e boleto anexados ao e-mail
- [ ] Registro do envio no histórico do cliente
- [ ] Status atualizado para "enviada"
- [ ] Typecheck/lint passa

#### US-009: Pipeline comercial (Kanban)
**Descrição:** Como gestor comercial, quero visualizar todas as propostas em um board Kanban para acompanhar o funil de vendas.

**Critérios de Aceite:**
- [ ] Colunas: Rascunho → Enviada → Aceita → Boleto Gerado → Pago
- [ ] Drag-and-drop para mover propostas entre colunas
- [ ] Filtro por cliente, período, valor
- [ ] Indicadores: total por coluna, taxa de conversão
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Módulo: SAC — Serviço de Atendimento ao Cliente

#### US-010: Abertura de ticket de atendimento
**Descrição:** Como atendente, quero registrar um chamado de cliente vinculado a um boleto/proposta para rastrear o atendimento.

**Critérios de Aceite:**
- [ ] Formulário: cliente, assunto, descrição, prioridade (alta, média, baixa)
- [ ] Vincular ticket a uma proposta e/ou boleto existente
- [ ] Status: aberto, em andamento, aguardando cliente, resolvido, fechado
- [ ] Atribuir responsável pelo ticket
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-011: Histórico de atendimento na ficha do cliente
**Descrição:** Como atendente, quero ver todo o histórico de tickets, propostas e boletos de um cliente em um só lugar.

**Critérios de Aceite:**
- [ ] Timeline unificada: tickets, propostas, boletos, e-mails enviados
- [ ] Ordenação cronológica (mais recente primeiro)
- [ ] Filtros por tipo (ticket, proposta, boleto)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-012: Respostas e comunicação no ticket
**Descrição:** Como atendente, quero responder ao cliente dentro do ticket e opcionalmente enviar a resposta por e-mail.

**Critérios de Aceite:**
- [ ] Campo de resposta com texto formatado
- [ ] Opção de enviar resposta por e-mail ao cliente
- [ ] Histórico de mensagens no ticket (tipo chat)
- [ ] Notificação ao responsável quando cliente responde
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Módulo: Financeiro

#### US-013: Contas a receber
**Descrição:** Como gestor financeiro, quero gerenciar todas as contas a receber da empresa para controlar a entrada de dinheiro.

**Critérios de Aceite:**
- [ ] Lista de contas a receber com: cliente, valor, vencimento, status (pendente, pago, vencido)
- [ ] Boletos gerados aparecem automaticamente como contas a receber
- [ ] Baixa manual e automática (via conciliação bancária)
- [ ] Filtros por status, período, cliente
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-014: Contas a pagar
**Descrição:** Como gestor financeiro, quero registrar e gerenciar contas a pagar para controlar as despesas.

**Critérios de Aceite:**
- [ ] CRUD de contas a pagar: fornecedor, valor, vencimento, categoria, descrição
- [ ] Status: pendente, pago, vencido
- [ ] Recorrência (mensal, semanal, etc.)
- [ ] Alertas de contas próximas do vencimento
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-015: Fluxo de caixa
**Descrição:** Como gestor financeiro, quero visualizar o fluxo de caixa para entender entradas e saídas ao longo do tempo.

**Critérios de Aceite:**
- [ ] Gráfico de fluxo de caixa (entradas vs saídas) por período
- [ ] Visão por empresa e consolidada (holding)
- [ ] Projeção futura baseada em contas a pagar/receber
- [ ] Saldo atual e projetado
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-016: Conciliação bancária
**Descrição:** Como gestor financeiro, quero conciliar extratos bancários automaticamente com as contas do sistema.

**Critérios de Aceite:**
- [ ] Importação de extrato (arquivo OFX/CSV ou integração bancária)
- [ ] Matching automático entre lançamentos do extrato e contas do sistema
- [ ] Tela para conciliação manual de itens não conciliados
- [ ] Relatório de conciliação
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-017: DRE e relatórios gerenciais
**Descrição:** Como administrador, quero gerar DRE e relatórios gerenciais por empresa e consolidado para tomada de decisão.

**Critérios de Aceite:**
- [ ] DRE (Demonstração do Resultado do Exercício) por empresa
- [ ] DRE consolidado do grupo
- [ ] Filtro por período (mensal, trimestral, anual)
- [ ] Exportação em PDF e Excel
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Módulo: Fiscal / Contábil

#### US-018: Emissão de nota fiscal de serviço (NFS-e)
**Descrição:** Como gestor fiscal, quero emitir notas fiscais de serviço eletrônicas a partir de propostas/boletos pagos.

**Critérios de Aceite:**
- [ ] Geração de NFS-e vinculada a proposta/boleto pago
- [ ] Integração com prefeitura ou API de emissão (ex: eNotas, Focus NFe)
- [ ] Campos obrigatórios: tomador, serviço, valor, alíquota ISS
- [ ] Envio automático da NF por e-mail ao cliente
- [ ] Typecheck/lint passa

#### US-019: Controle de impostos
**Descrição:** Como gestor fiscal, quero visualizar os impostos devidos por empresa para manter a conformidade fiscal.

**Critérios de Aceite:**
- [ ] Dashboard de impostos por empresa: ISS, PIS, COFINS, IRPJ, CSLL
- [ ] Cálculo automático baseado nas notas emitidas e regime tributário da empresa
- [ ] Alertas de vencimento de guias
- [ ] Visão consolidada do grupo
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-020: Plano de contas contábil
**Descrição:** Como contador/gestor, quero manter um plano de contas para categorizar receitas e despesas corretamente.

**Critérios de Aceite:**
- [ ] Plano de contas hierárquico (grupos e subgrupos)
- [ ] Plano de contas padrão criado automaticamente para novas empresas
- [ ] Personalização por empresa
- [ ] Todas as movimentações financeiras vinculadas a uma conta contábil
- [ ] Typecheck/lint passa

---

### Módulo: Infraestrutura / Compartilhamento

#### US-021: Compartilhamento de clientes entre empresas
**Descrição:** Como administrador, quero que algumas empresas possam compartilhar a base de clientes para evitar cadastros duplicados.

**Critérios de Aceite:**
- [ ] Configuração por empresa: clientes próprios ou compartilhados com grupo X
- [ ] Cliente compartilhado aparece nas empresas vinculadas
- [ ] Histórico de cada empresa separado (proposta da empresa A ≠ proposta da empresa B)
- [ ] Typecheck/lint passa

#### US-022: Autenticação e login
**Descrição:** Como usuário, quero fazer login com e-mail e senha para acessar o sistema de forma segura.

**Critérios de Aceite:**
- [ ] Tela de login com e-mail e senha
- [ ] JWT com refresh token
- [ ] Recuperação de senha por e-mail
- [ ] Sessão expira após inatividade
- [ ] Após login, redireciona para dashboard da empresa (ou seleção de empresa se tiver múltiplas)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-023: Log de auditoria
**Descrição:** Como administrador, quero que todas as ações dos usuários sejam registradas em um log de auditoria para rastreabilidade e segurança.

**Critérios de Aceite:**
- [ ] Toda ação relevante gera um registro: criação, edição, exclusão, login, logout, mudança de status
- [ ] Registro contém: usuário, ação, entidade afetada, dados antes/depois, timestamp, IP, empresa
- [ ] Tela de consulta de logs com filtros: usuário, ação, período, empresa, entidade
- [ ] Logs imutáveis (não podem ser editados ou deletados por nenhum usuário)
- [ ] Exportação de logs em CSV
- [ ] Retenção mínima de 12 meses
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

## 4. Requisitos Funcionais

### Multi-Tenancy
- **FR-01:** O sistema deve isolar dados por empresa (tenant) — nenhum usuário pode ver dados de empresa sem permissão
- **FR-02:** O administrador do grupo deve poder visualizar dados consolidados de todas as empresas
- **FR-03:** O sistema deve suportar adição de novas empresas sem alteração de código

### Fluxo Boleto-Proposta
- **FR-04:** O sistema deve permitir criar propostas comerciais com itens, valores e condições
- **FR-05:** A partir de uma proposta aceita, o sistema deve gerar boleto(s) via API externa (PinBank)
- **FR-06:** O sistema deve enviar proposta + boleto por e-mail ao cliente via API de e-mail
- **FR-07:** O sistema deve rastrear o ciclo completo: proposta → boleto → pagamento

### CRM
- **FR-08:** O sistema deve manter cadastro de clientes (PF/PJ) vinculados a empresas
- **FR-09:** O sistema deve exibir pipeline comercial em formato Kanban
- **FR-10:** O sistema deve registrar todo histórico de interações com o cliente

### SAC
- **FR-11:** O sistema deve permitir abertura de tickets vinculados a propostas/boletos
- **FR-12:** O sistema deve suportar comunicação bidirecional dentro do ticket
- **FR-13:** O sistema deve exibir timeline unificada do cliente (tickets + propostas + boletos)

### Financeiro
- **FR-14:** O sistema deve gerenciar contas a pagar e receber por empresa
- **FR-15:** O sistema deve gerar fluxo de caixa com projeção futura
- **FR-16:** O sistema deve realizar conciliação bancária (manual e automática)
- **FR-17:** O sistema deve gerar DRE por empresa e consolidado

### Fiscal
- **FR-18:** O sistema deve emitir NFS-e via integração com API de notas fiscais
- **FR-19:** O sistema deve calcular impostos devidos por empresa baseado no regime tributário
- **FR-20:** O sistema deve manter plano de contas contábil hierárquico

### Infraestrutura
- **FR-21:** O sistema deve suportar compartilhamento seletivo de clientes entre empresas
- **FR-22:** O sistema deve implementar autenticação JWT com refresh token
- **FR-23:** O sistema deve controlar permissões por empresa e por módulo

### Auditoria
- **FR-24:** O sistema deve registrar log imutável de todas as ações dos usuários (criar, editar, excluir, login, mudança de status)
- **FR-25:** Cada log deve conter: usuário, ação, entidade, dados antes/depois, timestamp, IP, empresa (tenant)
- **FR-26:** O sistema deve prover tela de consulta de logs com filtros e exportação CSV

### Integrações (preparação)
- **FR-27:** O sistema deve abstrair o envio de e-mail em uma interface genérica (destinatário, assunto, corpo HTML, anexos) para permitir plugar qualquer provedor no futuro
- **FR-28:** O sistema deve abstrair a emissão de NFS-e em uma interface genérica para integrar com qualquer API quando definido

---

## 5. Non-Goals (Fora do Escopo)

- **Aplicativo mobile** — apenas web responsivo
- **E-commerce / loja virtual** — não é uma plataforma de vendas online
- **Gestão de estoque físico** — as empresas vendem serviços/produtos online, sem estoque físico
- **RH / Folha de pagamento** — não inclui gestão de pessoas
- **Chat ao vivo com cliente** — SAC é via tickets, não chat real-time
- **Integração com marketplaces** (Mercado Livre, Shopee, etc.)
- **BI avançado / data warehouse** — relatórios gerenciais sim, mas não BI completo
- **Multi-idioma** — sistema apenas em português (pt-BR)

---

## 6. Design Considerations

### UI/UX
- Layout com sidebar fixa: navegação por módulos (Dashboard, Comercial, SAC, Financeiro, Fiscal, Configurações)
- Header com: seletor de empresa, nome do usuário, notificações
- Design system consistente com componentes reutilizáveis
- Responsivo (desktop-first, mas funcional em tablet)
- Tema claro com possibilidade de tema escuro futuramente

### Padrões de interface
- Tabelas com paginação, busca e filtros
- Formulários com validação inline
- Modais para ações rápidas, páginas completas para CRUD
- Toast notifications para feedback de ações
- Loading states e empty states em todas as listagens

---

## 7. Technical Considerations

### Stack sugerida
- **Frontend:** React/Next.js com TypeScript, TailwindCSS, Shadcn/UI
- **Backend:** Node.js com Fastify (já usado no api-pinbank) ou Next.js API Routes
- **Banco de dados:** PostgreSQL com isolamento por tenant (schema ou row-level security)
- **ORM:** Prisma (já usado no api-pinbank)
- **Autenticação:** JWT com refresh token
- **E-mail:** SendGrid, Amazon SES ou similar
- **Boletos:** API PinBank (integração existente em api-pinbank)
- **Notas Fiscais:** eNotas, Focus NFe ou similar
- **Deploy:** Vercel (frontend) + Railway/Render (backend) ou VPS

### Arquitetura
- Multi-tenant com Row Level Security (RLS) no PostgreSQL
- API RESTful com versionamento
- Separação clara: frontend SPA ↔ backend API
- Filas para processamento assíncrono (envio de e-mails, geração de boletos)

### Integrações existentes
- `api-pinbank`: já possui integração com PinBank para boletos — reaproveitar lógica
- Schemas de boleto, liquidação, transferência já definidos

### Performance
- Paginação server-side em todas as listagens
- Cache para dados pouco mutáveis (plano de contas, dados da empresa)
- Índices no banco para queries frequentes (por tenant, por status, por data)

---

## 8. Success Metrics

- Todas as 8 empresas migradas e operando no sistema em até 3 meses após lançamento da V1
- Redução de 80% no uso de planilhas para controle financeiro
- Tempo médio do fluxo Boleto-Proposta (criar proposta → cliente receber e-mail) < 5 minutos
- 100% dos boletos gerados e rastreados pelo sistema (zero boleto fora do ERP)
- Zero vazamento de dados entre empresas (isolamento de tenant verificado)
- Tempo de resposta das páginas < 2 segundos

---

## 9. Ordem de Implementação (Fases)

| Fase | Módulo | User Stories |
|------|--------|-------------|
| **Fase 1** | Gestão de Empresas / Multi-Tenancy + Autenticação | US-001, US-002, US-003, US-004, US-022, US-023 |
| **Fase 2** | Financeiro | US-013, US-014, US-015, US-016, US-017 |
| **Fase 3** | SAC — Atendimento ao Cliente | US-010, US-011, US-012 |
| **Fase 4** | CRM / Comercial — Fluxo Boleto-Proposta | US-005, US-006, US-007, US-008, US-009 |
| **Fase 5** | Fiscal / Contábil | US-018, US-019, US-020 |
| **Fase 6** | Infraestrutura / Compartilhamento | US-021 |

> **Nota:** Autenticação (US-022) e Auditoria (US-023) são implementados na Fase 1 pois são pré-requisitos de todos os outros módulos.

---

## 10. Open Questions

1. **Qual API de e-mail usar?** Ainda a definir — o sistema será preparado com interface genérica (enviar e-mail, corpo, anexos) para plugar qualquer provedor
2. **Qual API de NFS-e usar?** Ainda não decidido — sistema preparado com camada de abstração para integrar quando definido
3. **O regime tributário é o mesmo para todas as empresas** (Simples, Lucro Presumido, Lucro Real)?
4. **Existe um domínio/marca definida para o ERP?** (ex: erp.mendes.com.br)
5. **Os clientes compartilhados entre empresas — quais empresas compartilham entre si?** É configurável ou fixo?
6. **Os templates de e-mail são diferentes por empresa** ou existe um padrão único?
7. **Como funciona o parcelamento de boletos?** Número fixo de parcelas ou flexível? Com juros/multa?
8. **A conciliação bancária deve integrar com algum banco específico via API** ou apenas importação de arquivo OFX/CSV?
