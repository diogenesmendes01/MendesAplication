# PRD — SAC Evolution + Performance Foundation
**Versão:** 1.0  
**Data:** 27/03/2026  
**Status:** Draft — Aguardando aprovação  
**Responsável:** Vex ⚡

---

## 1. Objetivo

Evoluir o módulo SAC do MendesERP de uma listagem única de tickets para uma **central de atendimento multi-canal** com navegação por canal, dashboard master, Kanban + tabela, e configuração de IA por canal. Ao mesmo tempo, aplicar **ajustes de performance** (índices, virtualização, SSE namespaces) que preparam o sistema para escalar.

**Restrição absoluta:** ZERO BREAKING CHANGES no backend. Webhooks, workers, API routes, schema Prisma = NÃO TOCAR (exceto novos índices aditivos). Toda mudança é **frontend + routing**.

---

## 2. Contexto Atual

### Estado do SAC hoje (origin/main)
- **Routing:** `/sac` → redirect pra `/sac/tickets` (página única)
- **Listagem:** Tabela com filtro por canal (dropdown: Todos/Email/WhatsApp), tabs por tipo (Todos/SLA Crítico/Reembolsos/Meus Tickets), paginação server-side
- **Detalhe:** `/sac/tickets/[id]` — timeline unificada com mensagens de todos os canais + IA + notas + reembolsos
- **Dashboard:** KPIs inline no topo da listagem (ticket-dashboard.tsx) — tickets por status, por canal, SLA, reembolsos
- **RA Integration:** Mergeada (PR #356) — `RECLAMEAQUI` no enum `ChannelType`, campos `ra*` no Ticket, `ra-actions.ts`, `ra-suggestion-card.tsx`, `ra-moderation-dialog.tsx`, `ra-reputation-card.tsx`
- **Backend:** `_listTicketsInternal` já suporta filtro por `channelType` ✅
- **SSE:** Channel por empresa `company:${companyId}` — eventos `sla-update`, `timeline-update`
- **Virtualização:** Nenhuma
- **Índices SAC:** 7 índices no Ticket (companyId+status, companyId+slaBreached, companyId+clientId, companyId+assigneeId, companyId+status+updatedAt, companyId+slaBreached+status, companyId+status+priority)

### Problema
- Timeline única misturando 3 canais + IA + notas + reembolsos = **muito ruído**
- Conforme IA escala nos 3 canais, operador perde visão do que aconteceu
- Sem visão Kanban — operadores que gerenciam fluxo precisam ver o pipeline visual
- Dashboard misturado — métricas de email, WhatsApp e RA no mesmo bolo
- Performance vai degradar com volume (sem virtualização, SSE sem namespace)

---

## 3. Decisões Tomadas (Brainstorming 27/03)

| # | Decisão | Detalhe |
|---|---------|---------|
| 1 | **Navegação por canal** | `/sac` (master), `/sac/email`, `/sac/whatsapp`, `/sac/reclameaqui` |
| 2 | **Dashboard próprio por canal** | Métricas específicas de cada canal no topo da página do canal |
| 3 | **Backend compartilhado** | Mesmas actions, mesmo schema — frontend filtra por `channelType` |
| 4 | **Detalhe do ticket** | Continua uma tela só (`/sac/tickets/[id]`), adapta UI ao canal |
| 5 | **Dual view** | Toggle tabela ↔ Kanban (preferência salva no localStorage) |
| 6 | **Kanban** | Colunas = status existentes (OPEN, IN_PROGRESS, WAITING_CLIENT, RESOLVED, CLOSED) |
| 7 | **Flags como badges** | "Precisa humano", "SLA risco", "Reembolso", "Sugestão IA" são badges nos cards — NÃO status |
| 8 | **Config IA por canal** | Separar configuração do agente IA por canal (modo, prompt, auto/suggest/off) |
| 9 | **Extensível** | Estrutura pronta pra novos canais sem over-engineering agora |

---

## 4. Arquitetura de Routing

### Antes
```
/sac → redirect → /sac/tickets (tudo junto)
/sac/tickets/[id] → detalhe
```

### Depois
```
/sac                    → Dashboard master (todos os canais consolidados)
/sac/email              → Listagem + dashboard Email
/sac/whatsapp           → Listagem + dashboard WhatsApp
/sac/reclameaqui        → Listagem + dashboard Reclame Aqui
/sac/tickets/[id]       → Detalhe do ticket (mantém rota — universal)
```

### Estrutura de arquivos

```
src/app/(app)/sac/
├── page.tsx                          ← Dashboard master (NOVO)
├── layout.tsx                        ← Layout com nav lateral/tabs de canal (NOVO)
├── components/
│   ├── channel-nav.tsx               ← Navegação entre canais (NOVO)
│   ├── ticket-table.tsx              ← Tabela extraída (REFACTOR)
│   ├── ticket-kanban.tsx             ← View Kanban (NOVO)
│   ├── ticket-card.tsx               ← Card do Kanban (NOVO)
│   ├── view-toggle.tsx               ← Toggle tabela/kanban (NOVO)
│   ├── channel-dashboard.tsx         ← Dashboard genérico por canal (NOVO)
│   ├── master-dashboard.tsx          ← Dashboard consolidado (NOVO)
│   └── ticket-filters.tsx            ← Filtros extraídos (REFACTOR)
├── email/
│   └── page.tsx                      ← Listagem Email (NOVO)
├── whatsapp/
│   └── page.tsx                      ← Listagem WhatsApp (NOVO)
├── reclameaqui/
│   └── page.tsx                      ← Listagem RA (NOVO)
├── tickets/
│   ├── [id]/
│   │   ├── page.tsx                  ← (existente, adaptar UI por canal)
│   │   ├── ticket-timeline.tsx       ← (existente)
│   │   ├── ra-suggestion-card.tsx    ← (existente)
│   │   ├── ra-moderation-dialog.tsx  ← (existente)
│   │   ├── cancellation-dialog.tsx   ← (existente)
│   │   └── refund-dialogs.tsx        ← (existente)
│   ├── actions.ts                    ← (existente — NÃO TOCAR lógica)
│   ├── dashboard-actions.ts          ← (existente — estender com filtro canal)
│   ├── ra-actions.ts                 ← (existente)
│   └── ra-reputation-card.tsx        ← (existente — mover pra components/)
└── shared/
    └── ticket-list-page.tsx          ← Page template reusável (NOVO)
```

---

## 5. Componentes Novos

### 5.1 Channel Nav (`channel-nav.tsx`)

Navegação horizontal no topo do SAC, estilo tabs:

```
┌─────────────────────────────────────────────────────┐
│  📊 Overview    📧 Email [23]    💬 WhatsApp [8]    🌐 RA [5]  │
└─────────────────────────────────────────────────────┘
```

- Active state: underline accent + bold
- Badge com contagem de tickets abertos por canal
- Contagem via `dashboard-actions.ts` (já retorna por canal)
- Responsivo: horizontal scroll em mobile

### 5.2 Master Dashboard (`master-dashboard.tsx`)

Dashboard consolidado na `/sac`:

```
Row 1: [Total Abertos] [SLA Violado] [Tempo Médio] [Satisfação RA]
Row 2: [Gráfico: Volume por Canal — barras] [Gráfico: Tendência 7 dias — linha]
Row 3: [Top 5 Tickets Urgentes — lista] [Distribuição por Atendente — barras]
```

- KPIs agregados de todos os canais
- Gráficos Recharts com paleta do canal (Email=#3b82f6, WhatsApp=#22c55e, RA=#8b5cf6)
- Click-through: clicar num canal no gráfico → navega pra página do canal

### 5.3 Channel Dashboard (`channel-dashboard.tsx`)

Dashboard específico por canal (reutilizável):

**Email:**
```
[Inbox Pendente] [Respondidos Hoje] [Tempo Médio Resposta] [Backlog >24h]
```

**WhatsApp:**
```
[Conversas Ativas] [Esperando Cliente] [IA Respondeu Auto] [Humano Necessário]
```

**Reclame Aqui:**
```
[Nota Geral] [Respondidas/Total] [Taxa Resolução] [Voltaria a Fazer Negócio %]
+ RaReputationCard (já existe)
```

- Componente genérico que recebe `channelType` e renderiza KPIs específicos
- Métricas vêm de `dashboard-actions.ts` (estender com param `channelType`)

### 5.4 Ticket Kanban (`ticket-kanban.tsx`)

Visualização Kanban dos tickets:

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  ABERTO  │  │ ANDAMENTO│  │ AGUARD.  │  │ RESOLVIDO│  │ FECHADO  │
│   (12)   │  │   (5)    │  │   (3)    │  │   (8)    │  │  (45)    │
├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤
│ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │          │  │          │
│ │Card 1│ │  │ │Card 4│ │  │ │Card 7│ │  │          │  │          │
│ │🔴 SLA│ │  │ │🤖 IA │ │  │ │⏳ 2d │ │  │          │  │          │
│ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │          │  │          │
│ ┌──────┐ │  │          │  │          │  │          │  │          │
│ │Card 2│ │  │          │  │          │  │          │  │          │
│ │💰 $$$ │ │  │          │  │          │  │          │  │          │
│ └──────┘ │  │          │  │          │  │          │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

**Colunas:** Status existentes do enum `TicketStatus`
| Coluna | Status | Label PT |
|--------|--------|----------|
| 1 | `OPEN` | Aberto |
| 2 | `IN_PROGRESS` | Em Andamento |
| 3 | `WAITING_CLIENT` | Aguardando Cliente |
| 4 | `RESOLVED` | Resolvido |
| 5 | `CLOSED` | Fechado |

**Header de coluna:** Label + contagem + valor total de reembolsos (se houver)

**Sem drag & drop na v1** — complexidade alta, benefício marginal. Mudar status pelo detalhe do ticket. Avaliar DnD na v2 se operadores pedirem.

### 5.5 Ticket Card (`ticket-card.tsx`)

Card compacto pro Kanban:

```
┌────────────────────────────┐
│ #1234 — João Silva         │
│ Cobrança indevida          │ ← subject truncado
│                            │
│ 🔴 SLA   🤖 IA   💰 Reemb │ ← badges/flags
│ 📧 Email    há 2h    [DM] │ ← canal + tempo + assignee
└────────────────────────────┘
```

**Badges (flags — NÃO status):**

| Flag | Condição | Badge |
|------|----------|-------|
| SLA Violado | `slaBreached === true` | 🔴 vermelho |
| SLA em Risco | `slaBreached === false` + < 30min pro deadline | 🟡 amarelo |
| Sugestão IA pendente | Tem suggestion não aprovada/descartada | 🤖 roxo |
| Precisa Humano | IA escalou | 👤 azul |
| Reembolso | Tem refund `AWAITING_APPROVAL` | 💰 âmbar |

**Interações:**
- Click → navega pra `/sac/tickets/[id]`
- Hover → shadow + translateY(-1px) (padrão PRD redesign)

### 5.6 View Toggle (`view-toggle.tsx`)

Toggle simples tabela/kanban:

```
[📋 Tabela] [📊 Kanban]
```

- Preferência salva em `localStorage("sac-view-mode")`
- Default: tabela (familiar, já existe)
- Componente mínimo — `ToggleGroup` do shadcn

### 5.7 Ticket List Page Template (`ticket-list-page.tsx`)

Page template reusável que as 3 páginas de canal usam:

```tsx
interface TicketListPageProps {
  channelType: ChannelType;
  channelLabel: string;
  channelIcon: LucideIcon;
  dashboardConfig: ChannelDashboardConfig;
}

export function TicketListPage({ channelType, ... }: TicketListPageProps) {
  return (
    <>
      <ChannelDashboard channelType={channelType} config={dashboardConfig} />
      <ViewToggle />
      {viewMode === "table" ? (
        <TicketTable channelType={channelType} />
      ) : (
        <TicketKanban channelType={channelType} />
      )}
    </>
  );
}
```

Cada página de canal (`/sac/email/page.tsx`, etc.) é ~10 linhas:
```tsx
export default function SacEmailPage() {
  return (
    <TicketListPage
      channelType="EMAIL"
      channelLabel="Email"
      channelIcon={Mail}
      dashboardConfig={emailDashboardConfig}
    />
  );
}
```

---

## 6. Adaptação do Detalhe do Ticket

O detalhe (`/sac/tickets/[id]`) continua uma rota única mas adapta a UI ao canal:

### Por canal:

| Canal | Adaptações na UI |
|-------|-----------------|
| **Email** | Mostrar headers (From/To/Subject), thread view agrupada por email |
| **WhatsApp** | Estilo chat (balões, timestamps, status entrega ✓✓) |
| **Reclame Aqui** | `RaSuggestionCard`, `RaModerationDialog`, badge de rating, status RA |
| **Manual/Web** | Layout padrão atual |

### Breadcrumb contextual:
```
SAC > Email > #1234 — João Silva
SAC > WhatsApp > #5678 — Maria Souza
SAC > Reclame Aqui > #9012 — Pedro Lima
```

O breadcrumb linka de volta pra página do canal de origem (não pra `/sac/tickets`).

---

## 7. Config IA por Canal

### Situação atual
- Config IA global em `/configuracoes/ai` — um config por empresa
- `AiConfig` model com campos de provider, model, prompt, mode

### Proposta
- **Não mudar schema** (zero breaking changes)
- Usar o campo `channel` já existente no `AiConfig` (ou adicionar se não existe)
- UI em `/configuracoes/ai` ganha tabs por canal:

```
┌─────────────────────────────────────────────┐
│  📧 Email    💬 WhatsApp    🌐 Reclame Aqui  │
├─────────────────────────────────────────────┤
│                                             │
│  Modo: [Sugestão ▾]                         │
│  Prompt do sistema: [________________]      │
│  Provider: [Claude Sonnet ▾]                │
│  Auto-responder: [OFF]                      │
│                                             │
└─────────────────────────────────────────────┘
```

- Cada canal pode ter modo diferente (ex: WhatsApp = auto-responder, Email = sugestão, RA = off)
- Workers já verificam `channel.type` → usam config do canal correspondente

---

## 8. Performance Foundation

### 8.1 Índices de Banco (aditivos)

| Model | Índice | Justificativa |
|-------|--------|---------------|
| `Client` | `@@index([companyId, createdAt])` | Listagem de clientes ordenada |
| `Invoice` | `@@index([companyId, status, createdAt])` | Listagem com filtro + sort |
| `Proposal` | `@@index([companyId, status, createdAt])` | Pipeline comercial |
| `TaxEntry` | `@@index([companyId, status, dueDate])` | Dashboard fiscal |
| `AiUsageLog` | `@@index([companyId, isSimulation])` | Filtro logs simulação |
| `Document` | `@@index([companyId, createdAt])` | Listagem docs |
| `DocumentChunk` | `@@index([documentId])` | Chunks por documento |
| `FiscalConfig` | `@@index([companyId])` | Lookup config fiscal |
| `AdditionalContact` | `@@index([clientId])` | Contatos do cliente |
| `AuditLog` | `@@index([companyId, createdAt])` | Listagem auditoria |
| `Refund` | `@@index([companyId, status, createdAt])` | Listagem reembolsos |

**Audit de queries perigosas:**

| Local | Problema | Fix |
|-------|----------|-----|
| `auditoria/actions.ts:158` | `take: 10000` | Cursor pagination |
| `plano-de-contas/actions.ts:214` | `findMany` sem limit | Add `take: 500` default |
| `impostos/actions.ts:157-210` | 3x `findMany` sem limit | Add limit guard |

### 8.2 Virtualização

**Lib:** `@tanstack/react-virtual` (2KB gzip, headless)

**Onde aplicar:**

| Componente | Prioridade |
|------------|------------|
| Tickets list (tabela) | 🔴 Alta |
| Kanban columns (scroll vertical) | 🔴 Alta |
| Clientes list | 🔴 Alta |
| Audit log | 🔴 Alta |
| Contas a receber/pagar | 🟡 Média |
| Notas fiscais | 🟡 Média |
| Timeline do ticket | 🟡 Média |

**Component:** `VirtualTable` genérico — wrapper headless sobre tabelas shadcn existentes.

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualTable<T>({ data, columns, estimateSize = 48 }: Props<T>) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan: 10,
  });
  // ... render virtual rows com position absolute
}
```

**Regras:**
- Virtualizar quando `data.length > 50`
- `overscan: 10` pra scroll suave
- Sticky headers (thead fora do container de scroll)
- Paginação server-side inalterada

### 8.3 SSE Namespaces

**Antes:** Canal único `company:${companyId}` — tudo no mesmo pipe.

**Depois:** Namespaces por módulo.

| Namespace | Eventos | Consumers |
|-----------|---------|-----------|
| `sac` | `sla-update`, `timeline-update`, `ticket-created`, `ticket-assigned` | Sidebar, SAC pages |
| `dashboard` | `kpi-update`, `revenue-update` | Dashboard |
| `financial` | `payment-received`, `bill-due` | Financeiro |
| `fiscal` | `invoice-status`, `tax-alert` | Fiscal |
| `commercial` | `proposal-update` | Comercial |
| `system` | `notification`, `maintenance` | Todas |

**Mudanças:**

1. **`/api/events/route.ts`** — aceitar param `ns` (comma-separated):
```ts
const namespaces = (url.searchParams.get("ns") || "system")
  .split(",").filter(ns => ALLOWED_NAMESPACES.includes(ns));

const unsubscribes = namespaces.map(ns =>
  sseBus.subscribe(`company:${companyId}:${ns}`, handler)
);
```

2. **`use-event-stream.ts`** — aceitar array de namespaces:
```ts
export function useEventStream(
  companyId: string | null,
  namespaces: string[],
  handlers: Record<string, EventHandler>
)
```

3. **Publishers** — migrar de `"company:X"` → `"company:X:sac"`:
   - `whatsapp-inbound.ts` (2 calls)
   - `sac/tickets/actions.ts` (10+ calls)

4. **Backward compat** — sem `ns` param → subscribe em `system`

---

## 9. Fases de Implementação

### Story 1 — Database Indexes + Query Guards (~1 sessão dev)
1. Migration Prisma: 11 novos índices
2. Refatorar queries `take > 1000` pra cursor pagination
3. Adicionar limit guards em `findMany` sem `take`
4. Validar com `EXPLAIN ANALYZE`

### Story 2 — Estrutura de Routing + Channel Nav (~1 sessão dev)
1. Criar `src/app/(app)/sac/layout.tsx` com `ChannelNav`
2. Criar `src/app/(app)/sac/page.tsx` como dashboard master (placeholder)
3. Criar páginas `/sac/email`, `/sac/whatsapp`, `/sac/reclameaqui`
4. Extrair tabela existente → `ticket-table.tsx` (refactor, zero mudança de lógica)
5. Extrair filtros → `ticket-filters.tsx`
6. Criar `ticket-list-page.tsx` template
7. Testar: cada rota filtra pelo canal correto

### Story 3 — Kanban View (~1 sessão dev)
1. Criar `ticket-kanban.tsx` com colunas por status
2. Criar `ticket-card.tsx` com badges/flags
3. Criar `view-toggle.tsx` com localStorage
4. Integrar no `ticket-list-page.tsx`
5. Testar: toggle funciona, cards renderizam, click navega

### Story 4 — Channel Dashboards (~1 sessão dev)
1. Estender `dashboard-actions.ts` com filtro por `channelType`
2. Criar `channel-dashboard.tsx` genérico
3. Criar `master-dashboard.tsx` consolidado
4. Configurar KPIs específicos por canal
5. Mover `ra-reputation-card.tsx` pra dashboard RA

### Story 5 — Detalhe do Ticket — Adaptação por Canal (~1 sessão dev)
1. Detectar `channelType` no detalhe e adaptar header/breadcrumb
2. Email: mostrar headers (from/to/subject)
3. WhatsApp: estilo chat (balões)
4. RA: garantir suggestion/moderation cards proeminentes
5. Breadcrumb contextual: SAC > Canal > Ticket

### Story 6 — Virtualização (~1 sessão dev)
1. `npm install @tanstack/react-virtual`
2. Criar `VirtualTable` genérico
3. Aplicar na ticket-table
4. Aplicar no kanban (scroll virtual nas colunas)
5. Aplicar em clientes e auditoria
6. Testar com 500+ rows

### Story 7 — SSE Namespaces (~1 sessão dev)
1. Atualizar `/api/events/route.ts` com param `ns`
2. Atualizar `use-event-stream.ts`
3. Migrar publishers → namespace `sac`
4. Atualizar consumers (sidebar, timeline)
5. Testar isolamento: SAC page só recebe `sac` events

### Story 8 — Config IA por Canal (~1 sessão dev)
1. Verificar se `AiConfig` já tem campo `channel` (ou adicionar migration)
2. UI: tabs por canal em `/configuracoes/ai`
3. Workers: usar config do canal correspondente
4. Testar: WhatsApp auto, Email sugestão, RA off

---

## 10. Critérios de Aceite

### Routing & Navegação
- [ ] `/sac` mostra dashboard master com métricas de todos os canais
- [ ] `/sac/email`, `/sac/whatsapp`, `/sac/reclameaqui` mostram tickets filtrados pelo canal
- [ ] `ChannelNav` mostra contagem de tickets abertos por canal
- [ ] Breadcrumbs contextuais funcionam ida e volta
- [ ] Nenhum redirect quebrado — URLs antigas (`/sac/tickets`) continuam funcionando

### Kanban
- [ ] Toggle tabela/kanban funciona e salva preferência
- [ ] Colunas = 5 status do `TicketStatus`
- [ ] Cards mostram: subject, cliente, badges, canal, tempo, assignee
- [ ] Click no card navega pro detalhe
- [ ] Header de coluna com contagem

### Dashboards
- [ ] Master dashboard: 4+ KPIs agregados + 2 gráficos + lista urgentes
- [ ] Dashboard por canal: KPIs específicos renderizados corretamente
- [ ] RA dashboard inclui `RaReputationCard`

### Performance
- [ ] 11 índices criados via migration
- [ ] Queries perigosas refatoradas (nenhum `take > 1000`)
- [ ] Virtualização aplicada nas 4 tabelas prioritárias
- [ ] Scroll suave com 500+ rows
- [ ] SSE namespaces funcionando — cada página escuta só seus eventos
- [ ] Mesma connection SSE, múltiplos namespaces

### Config IA
- [ ] Tabs por canal na configuração de IA
- [ ] Modo independente por canal (auto/suggest/off)
- [ ] Workers respeitam config do canal

### Backward Compatibility
- [ ] Schema Prisma: apenas adições (índices, enum value se necessário)
- [ ] Webhooks, workers, API routes: ZERO mudança de lógica
- [ ] URLs existentes funcionam (redirect se necessário)
- [ ] SSE sem `ns` param → fallback pra `system`

---

## 11. O Que NÃO Fazer

- ❌ Drag & drop no Kanban (v2 se pedirem)
- ❌ Mudar status do ticket pelo Kanban (só pelo detalhe)
- ❌ Criar novos modelos Prisma (usar os existentes)
- ❌ Separar tabelas de mensagens por canal (overkill)
- ❌ Dark mode nas páginas novas
- ❌ Criar connection SSE separada por namespace
- ❌ Over-engineering pra canais futuros (Telegram, Instagram, etc.) — só preparar a estrutura

---

## 12. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Refactor da tabela quebra filtros existentes | Alto | Extrair sem mudar lógica, testar cada filtro |
| Dashboard por canal sem dados suficientes | Baixo | Fallback pra "sem dados" com empty state |
| SSE migration quebra badges do sidebar | Alto | Feature flag + fallback channel |
| Kanban com muitos tickets (500+ OPEN) | Médio | Virtualização vertical nas colunas |
| Config IA sem campo channel no schema | Médio | Verificar primeiro; se não tem, migration aditiva |
| Performance dos novos índices | Baixo | Monitorar write latency pós-deploy |

---

## 13. Dependências

| Story | Depende de |
|-------|-----------|
| Story 1 (Indexes) | Nenhuma — pode rodar em paralelo |
| Story 2 (Routing) | Nenhuma — estrutura pura |
| Story 3 (Kanban) | Story 2 (precisa do template de página) |
| Story 4 (Dashboards) | Story 2 (precisa das rotas de canal) |
| Story 5 (Detalhe) | Story 2 (breadcrumbs) |
| Story 6 (Virtual) | Story 2 + Story 3 (tabela e kanban existem) |
| Story 7 (SSE) | Nenhuma — pode rodar em paralelo |
| Story 8 (Config IA) | Nenhuma — independente |

**Paralelizáveis:** Stories 1, 2, 7, 8 podem rodar ao mesmo tempo.  
**Sequenciais:** 2 → 3 → 6, 2 → 4, 2 → 5

---

## 14. Métricas de Sucesso

| Métrica | Antes | Target |
|---------|-------|--------|
| Tempo pra encontrar ticket de um canal | ~10s (filtrar dropdown) | ~2s (click na aba) |
| Visão do pipeline de status | Inexistente | Kanban visual |
| Métricas por canal | Misturadas | Isoladas e acionáveis |
| Render de 500+ tickets | ~500 DOM nodes | ~20 (virtual) |
| SSE events processados por page | Todos da empresa | Só do módulo ativo |
| Queries sem index | 5+ seq scans | 0 |

---

*PRD gerado por Vex ⚡ | MendesERP SAC Evolution + Performance Foundation v1.0*
