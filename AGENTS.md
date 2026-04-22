# AGENTS.md — MendesERP

> Lido pelo Dev no início de CADA iteração. Manter atualizado.

## Como rodar o projeto

```bash
# Instalar dependências
cd erp && npm install

# Gerar Prisma client (precisa de DATABASE_URL)
npx prisma generate

# Rodar em dev
npm run dev

# Typecheck
npx tsc --noEmit

# Lint (obrigatório antes de commitar)
npm run lint

# Build (precisa de DATABASE_URL real para SSG das rotas de auth)
npm run build
```

## Stack

- **Framework:** Next.js 15 (App Router)
- **Linguagem:** TypeScript (strict)
- **UI:** Tailwind CSS + shadcn/ui
- **Banco:** PostgreSQL via Prisma ORM
- **Auth:** JWT custom (cookies httpOnly)
- **Fonte:** Plus Jakarta Sans (via next/font/google)

## Estrutura de pastas

```
erp/
├── src/
│   ├── app/
│   │   ├── (app)/           ← páginas autenticadas (layout com sidebar)
│   │   │   ├── dashboard/
│   │   │   ├── comercial/
│   │   │   ├── sac/
│   │   │   ├── financeiro/
│   │   │   ├── fiscal/
│   │   │   └── configuracoes/
│   │   ├── api/              ← API routes
│   │   ├── login/
│   │   ├── globals.css       ← design tokens (paleta warm, shadows)
│   │   └── layout.tsx        ← root layout (fonte)
│   ├── components/
│   │   ├── ui/               ← shadcn components
│   │   ├── sidebar.tsx       ← sidebar redesenhada
│   │   └── header.tsx        ← header com breadcrumb dinâmico
│   ├── contexts/
│   │   ├── company-context.tsx  ← multi-tenant
│   │   └── user-context.tsx     ← sessão do usuário
│   ├── hooks/
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── session.ts        ← getSession / requireSession
│   │   └── auth.ts           ← JWT, hash
│   └── ...
├── prisma/
│   └── schema.prisma
├── tailwind.config.ts        ← design tokens mapeados
└── package.json
```

## Padrões do projeto

- **Server Actions** para queries do banco (não API routes para UI)
- **Multi-tenant:** toda query filtra por `companyId` via `requireCompanyAccess()`
- **Sessão:** `requireSession()` retorna `{ userId, email, role }`
- **Design tokens:** usar variáveis CSS do globals.css (--accent, --text-primary, etc.)
- **Cores:** paleta warm (off-white #FAFAF8, accent violet #6366F1, borders #E8E4DF)
- **Shadows:** warm-tinted (rgba(28,25,23,...))
- **darkMode: "class"** mas nenhuma classe .dark é adicionada = dark mode off
- **Conventional Commits:** feat/fix/refactor/chore

## Gotchas (não esqueça)

- `DATABASE_URL` precisa existir pra prisma generate e build
- O build local sem banco real falha nas rotas de auth (SSG) — normal
- `npm run lint` é o gate do CI — se não passar, PR falha
- Imports não usados = erro de lint (`@typescript-eslint/no-unused-vars`)
- `useEventStream` aceita `string | null`, não `undefined` — usar `?? null`
- UserContext existe — usar `useUser()` pra nome/role no frontend
- CompanyContext existe — usar `useCompany()` pra empresa selecionada

## Comandos de qualidade (obrigatórios antes de commitar)

```bash
cd erp
npm run lint          # OBRIGATÓRIO — gate do CI
npx tsc --noEmit      # recomendado (pode falhar sem .next/types)
```

## Referências de design

- PRD redesign: `~/workspace/dev/erp/prd-frontend-redesign.md`
- PRD UX: `~/workspace/dev/erp/prd-ux.md`
- HTML target: `~/workspace/media/inbound/erp-preview---dbfd0623-b7f6-4d86-abbe-f79682980819`

## Histórico de aprendizados

- Fase 1+2 merged (10/03/2026): paleta warm, Plus Jakarta Sans, sidebar redesign, componentes core
- `darkMode` deve ser "class" (não remover a linha — Tailwind volta pra "media")
- roleLabels precisa incluir MANAGER
- Breadcrumb filtra CUIDs/UUIDs → mostra "Detalhe"
