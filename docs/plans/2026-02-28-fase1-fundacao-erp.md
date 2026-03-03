# Fase 1: Fundação do ERP — Multi-Tenancy, Autenticação e Auditoria

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Criar a fundação do ERP multi-empresa com autenticação JWT, gestão de tenants, permissões por empresa/módulo, dashboard consolidado e log de auditoria.

**Architecture:** Monorepo com frontend Next.js (App Router) e backend Fastify separado. O backend expõe uma API REST com JWT. O banco PostgreSQL usa Row Level Security (RLS) para isolamento de dados por tenant. O código do `api-pinbank` será incorporado como módulo dentro do backend do ERP.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + TailwindCSS + Shadcn/UI | Fastify 5 + Prisma 7 + Zod 4 + PostgreSQL | JWT (jose) | Vitest

---

## Estrutura do Monorepo

```
mendes-erp/
├── apps/
│   ├── web/                          # Frontend Next.js
│   │   ├── src/
│   │   │   ├── app/                  # App Router pages
│   │   │   │   ├── (auth)/           # Grupo: login, recuperar senha
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── recuperar-senha/page.tsx
│   │   │   │   ├── (dashboard)/      # Grupo: páginas autenticadas
│   │   │   │   │   ├── layout.tsx    # Sidebar + Header + AuthGuard
│   │   │   │   │   ├── page.tsx      # Dashboard consolidado
│   │   │   │   │   ├── empresas/     # CRUD empresas
│   │   │   │   │   ├── usuarios/     # CRUD usuários
│   │   │   │   │   └── auditoria/    # Consulta de logs
│   │   │   │   ├── layout.tsx        # Root layout
│   │   │   │   └── globals.css
│   │   │   ├── components/
│   │   │   │   ├── ui/               # Shadcn components
│   │   │   │   ├── layout/           # Sidebar, Header, EmpresaSelector
│   │   │   │   └── shared/           # DataTable, EmptyState, etc.
│   │   │   ├── lib/
│   │   │   │   ├── api.ts            # Fetch wrapper com JWT
│   │   │   │   └── auth.ts           # Auth context, token storage
│   │   │   └── hooks/
│   │   │       └── use-empresa.ts    # Hook para empresa selecionada
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── tsconfig.json
│   │
│   └── api/                          # Backend Fastify
│       ├── src/
│       │   ├── app.ts                # Fastify factory
│       │   ├── server.ts             # Entry point
│       │   ├── config/
│       │   │   ├── env.ts            # Env vars
│       │   │   └── prisma.ts         # Prisma client singleton
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── auth.schema.ts
│       │   │   │   ├── auth.middleware.ts    # JWT verify + inject user
│       │   │   │   └── auth.test.ts
│       │   │   ├── tenant/
│       │   │   │   ├── tenant.controller.ts
│       │   │   │   ├── tenant.service.ts
│       │   │   │   ├── tenant.repository.ts
│       │   │   │   ├── tenant.schema.ts
│       │   │   │   └── tenant.test.ts
│       │   │   ├── user/
│       │   │   │   ├── user.controller.ts
│       │   │   │   ├── user.service.ts
│       │   │   │   ├── user.repository.ts
│       │   │   │   ├── user.schema.ts
│       │   │   │   └── user.test.ts
│       │   │   └── audit/
│       │   │       ├── audit.controller.ts
│       │   │       ├── audit.service.ts
│       │   │       ├── audit.repository.ts
│       │   │       ├── audit.schema.ts
│       │   │       └── audit.test.ts
│       │   ├── lib/
│       │   │   └── pinbank/          # Copiado de api-pinbank (crypto, token, client)
│       │   └── shared/
│       │       ├── errors.ts         # AppError, NotFoundError, etc.
│       │       └── pagination.ts     # Helpers de paginação
│       ├── prisma/
│       │   └── schema.prisma
│       ├── package.json
│       └── tsconfig.json
│
├── package.json                      # Workspace root (npm workspaces)
├── tsconfig.base.json
└── .env
```

---

## Task 1: Inicializar monorepo e dependências

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `.env`
- Create: `.gitignore`

**Step 1: Criar package.json root com npm workspaces**

```json
{
  "name": "mendes-erp",
  "private": true,
  "workspaces": ["apps/*"],
  "scripts": {
    "dev": "npm run dev --workspaces --if-present",
    "dev:api": "npm run dev -w apps/api",
    "dev:web": "npm run dev -w apps/web",
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present"
  }
}
```

**Step 2: Criar tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 3: Criar apps/api/package.json**

```json
{
  "name": "@mendes-erp/api",
  "version": "0.0.1",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "prisma generate",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^11.0.0",
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "@prisma/client": "^7.0.0",
    "@prisma/adapter-pg": "^7.0.0",
    "pg": "^8.13.0",
    "zod": "^4.0.0",
    "jose": "^6.0.0",
    "bcryptjs": "^3.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "tsx": "^4.0.0",
    "vitest": "^4.0.0",
    "prisma": "^7.0.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.0.0",
    "@types/bcryptjs": "^3.0.0"
  }
}
```

**Step 4: Criar apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Criar apps/web/package.json (Next.js)**

```json
{
  "name": "@mendes-erp/web",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3001",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "postcss": "^8.0.0"
  }
}
```

**Step 6: Criar .env na raiz**

```env
# Database
DATABASE_URL=postgresql://user:password@host:5432/mendes_erp

# API
PORT=3000
JWT_SECRET=trocar-por-chave-segura-de-pelo-menos-32-caracteres
JWT_REFRESH_SECRET=trocar-por-outra-chave-segura-de-pelo-menos-32-caracteres
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# PinBank
PINBANK_BASE_URL=https://dev.pinbank.com.br/services

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3000
```

**Step 7: Criar .gitignore**

```
node_modules/
dist/
.next/
.env
*.log
```

**Step 8: Instalar dependências**

Run: `npm install`
Expected: Lock file created, workspaces installed

**Step 9: Commit**

```bash
git add -A
git commit -m "chore: initialize monorepo with api (Fastify) and web (Next.js) workspaces"
```

---

## Task 2: Schema do banco — Prisma (Tenant, User, AuditLog)

**Files:**
- Create: `apps/api/prisma/schema.prisma`

**Step 1: Criar schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// TENANTS (Empresas)
// ============================================

model Tenant {
  id                String   @id @default(uuid())
  razaoSocial       String
  nomeFantasia      String
  cnpj              String   @unique
  inscricaoEstadual String?
  endereco          String?
  telefone          String?
  email             String?
  logo              String?
  segmento          String?
  ativo             Boolean  @default(true)

  // Credenciais PinBank (opcionais — nem toda empresa usa)
  pinbankUserName          String?
  pinbankKeyValue          String?
  pinbankRequestOrigin     String?
  pinbankCodigoCanal       Int?
  pinbankCodigoCliente     Int?
  pinbankCedenteContaNumero   String?
  pinbankCedenteContaNumeroDV String?
  pinbankCedenteContaCodigoBanco String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  users      UserTenant[]
  auditLogs  AuditLog[]

  @@map("tenants")
}

// ============================================
// USERS (Usuários)
// ============================================

enum UserRole {
  ADMIN       // Vê tudo, gerencia tudo
  GESTOR      // Vê só suas empresas atribuídas
}

model User {
  id           String   @id @default(uuid())
  nome         String
  email        String   @unique
  senhaHash    String
  role         UserRole @default(GESTOR)
  ativo        Boolean  @default(true)
  lastLoginAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  tenants    UserTenant[]
  auditLogs  AuditLog[]

  @@map("users")
}

// Tabela associativa: User <-> Tenant (N:N)
// Também define permissões por módulo para aquele user naquela empresa
model UserTenant {
  id       String @id @default(uuid())
  userId   String
  tenantId String

  // Permissões por módulo
  acessoFinanceiro  Boolean @default(false)
  acessoComercial   Boolean @default(false)
  acessoSAC         Boolean @default(false)
  acessoFiscal      Boolean @default(false)

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([userId, tenantId])
  @@map("user_tenants")
}

// ============================================
// AUDIT LOG
// ============================================

model AuditLog {
  id         String   @id @default(uuid())
  tenantId   String?
  userId     String?
  acao       String              // "criar", "editar", "excluir", "login", "logout", etc.
  entidade   String              // "tenant", "user", "boleto", etc.
  entidadeId String?             // ID do registro afetado
  dadosAntes Json?               // Snapshot antes da alteração
  dadosDepois Json?              // Snapshot depois da alteração
  ip         String?
  userAgent  String?
  createdAt  DateTime @default(now())

  tenant Tenant? @relation(fields: [tenantId], references: [id])
  user   User?   @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([userId])
  @@index([acao])
  @@index([entidade])
  @@index([createdAt])
  @@map("audit_logs")
}
```

**Step 2: Gerar Prisma client e aplicar no banco**

Run: `cd apps/api && npx prisma db push`
Expected: Schema synced, tables created

Run: `npx prisma generate`
Expected: Client generated at `src/generated/prisma/`

**Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "feat: add Prisma schema with Tenant, User, UserTenant and AuditLog models"
```

---

## Task 3: Configuração base do backend — Prisma client, env, errors

**Files:**
- Create: `apps/api/src/config/env.ts`
- Create: `apps/api/src/config/prisma.ts`
- Create: `apps/api/src/shared/errors.ts`
- Create: `apps/api/src/shared/pagination.ts`

**Step 1: Criar env.ts**

```typescript
import "dotenv/config";

export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: Number(process.env.PORT) || 3000,
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "15m",
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  PINBANK_BASE_URL: process.env.PINBANK_BASE_URL || "",
};
```

**Step 2: Criar prisma.ts**

```typescript
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "./env.js";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
```

**Step 3: Criar errors.ts**

```typescript
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string) {
    super(`${entity} não encontrado(a)`, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Não autorizado") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acesso negado") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}
```

**Step 4: Criar pagination.ts**

```typescript
import { z } from "zod/v4";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export function paginate(input: PaginationInput) {
  return {
    skip: (input.page - 1) * input.limit,
    take: input.limit,
  };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  input: PaginationInput,
) {
  return {
    data,
    meta: {
      total,
      page: input.page,
      limit: input.limit,
      totalPages: Math.ceil(total / input.limit),
    },
  };
}
```

**Step 5: Commit**

```bash
git add apps/api/src/config/ apps/api/src/shared/
git commit -m "feat: add env config, Prisma client, error classes and pagination utils"
```

---

## Task 4: App Fastify + Error Handler + Health Check

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Test: `apps/api/src/app.test.ts`

**Step 1: Escrever o teste de smoke**

```typescript
// apps/api/src/app.test.ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";

describe("App", () => {
  it("GET /health deve retornar 200", async () => {
    const app = buildApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
```

**Step 2: Rodar o teste para verificar que falha**

Run: `cd apps/api && npx vitest run src/app.test.ts`
Expected: FAIL — `buildApp` not found

**Step 3: Implementar app.ts**

```typescript
// apps/api/src/app.ts
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod/v4";
import { AppError } from "./shared/errors.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  // Health check
  app.get("/health", async () => ({ status: "ok" }));

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Erro de validação",
        details: error.issues,
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: "Erro interno do servidor",
    });
  });

  return app;
}
```

**Step 4: Implementar server.ts**

```typescript
// apps/api/src/server.ts
import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp();

app.listen({ port: env.PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
```

**Step 5: Rodar o teste para verificar que passa**

Run: `cd apps/api && npx vitest run src/app.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/server.ts apps/api/src/app.test.ts
git commit -m "feat: add Fastify app with health check, error handler and smoke test"
```

---

## Task 5: Módulo Auth — JWT, login, refresh, middleware

**Files:**
- Create: `apps/api/src/modules/auth/auth.schema.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.middleware.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Test: `apps/api/src/modules/auth/auth.test.ts`

**Step 1: Escrever os testes**

```typescript
// apps/api/src/modules/auth/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

describe("Auth", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed: criar usuário de teste
    await prisma.user.create({
      data: {
        email: "test@mendes.com",
        nome: "Test User",
        senhaHash: await bcrypt.hash("Senha123!", 10),
        role: "ADMIN",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: "test@mendes.com" } });
    await app.close();
  });

  it("POST /auth/login com credenciais válidas retorna tokens", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@mendes.com", senha: "Senha123!" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.user.email).toBe("test@mendes.com");
  });

  it("POST /auth/login com senha errada retorna 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@mendes.com", senha: "errada" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /auth/refresh com token válido retorna novo access token", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@mendes.com", senha: "Senha123!" },
    });
    const { refreshToken } = loginRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeDefined();
  });

  it("GET /auth/me com token válido retorna usuário", async () => {
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "test@mendes.com", senha: "Senha123!" },
    });
    const { accessToken } = loginRes.json();

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe("test@mendes.com");
  });

  it("GET /auth/me sem token retorna 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
    });
    expect(res.statusCode).toBe(401);
  });
});
```

**Step 2: Rodar testes para verificar que falham**

Run: `cd apps/api && npx vitest run src/modules/auth/auth.test.ts`
Expected: FAIL — módulos não existem

**Step 3: Criar auth.schema.ts**

```typescript
// apps/api/src/modules/auth/auth.schema.ts
import { z } from "zod/v4";

export const loginSchema = z.object({
  email: z.email(),
  senha: z.string().min(6),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
```

**Step 4: Criar auth.service.ts**

```typescript
// apps/api/src/modules/auth/auth.service.ts
import * as jose from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../shared/errors.js";
import type { LoginInput } from "./auth.schema.js";

const accessSecret = new TextEncoder().encode(env.JWT_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

async function generateTokens(user: { id: string; email: string; role: string }) {
  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };

  const accessToken = await new jose.SignJWT(payload as unknown as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(accessSecret);

  const refreshToken = await new jose.SignJWT({ sub: user.id } as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(env.JWT_REFRESH_EXPIRES_IN)
    .sign(refreshSecret);

  return { accessToken, refreshToken };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.ativo) {
    throw new UnauthorizedError("E-mail ou senha inválidos");
  }

  const senhaValida = await bcrypt.compare(input.senha, user.senhaHash);
  if (!senhaValida) {
    throw new UnauthorizedError("E-mail ou senha inválidos");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await generateTokens(user);

  return {
    ...tokens,
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
    },
  };
}

export async function refresh(refreshToken: string) {
  try {
    const { payload } = await jose.jwtVerify(refreshToken, refreshSecret);
    const userId = payload.sub as string;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.ativo) {
      throw new UnauthorizedError("Token inválido");
    }

    const tokens = await generateTokens(user);
    return tokens;
  } catch {
    throw new UnauthorizedError("Refresh token inválido ou expirado");
  }
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, accessSecret);
    return payload as unknown as JwtPayload;
  } catch {
    throw new UnauthorizedError("Token inválido ou expirado");
  }
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tenants: {
        include: { tenant: true },
      },
    },
  });

  if (!user || !user.ativo) {
    throw new UnauthorizedError("Usuário não encontrado");
  }

  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    tenants: user.tenants.map((ut) => ({
      id: ut.tenant.id,
      nomeFantasia: ut.tenant.nomeFantasia,
      cnpj: ut.tenant.cnpj,
      permissoes: {
        financeiro: ut.acessoFinanceiro,
        comercial: ut.acessoComercial,
        sac: ut.acessoSAC,
        fiscal: ut.acessoFiscal,
      },
    })),
  };
}
```

**Step 5: Criar auth.middleware.ts**

```typescript
// apps/api/src/modules/auth/auth.middleware.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken, type JwtPayload } from "./auth.service.js";
import { UnauthorizedError } from "../../shared/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: JwtPayload;
  }
}

export async function authGuard(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token não fornecido");
  }

  const token = header.slice(7);
  request.currentUser = await verifyAccessToken(token);
}

export async function adminGuard(request: FastifyRequest, reply: FastifyReply) {
  await authGuard(request, reply);
  if (request.currentUser.role !== "ADMIN") {
    throw new UnauthorizedError("Acesso restrito a administradores");
  }
}
```

**Step 6: Criar auth.controller.ts**

```typescript
// apps/api/src/modules/auth/auth.controller.ts
import type { FastifyInstance } from "fastify";
import { loginSchema, refreshSchema } from "./auth.schema.js";
import * as authService from "./auth.service.js";
import { authGuard } from "./auth.middleware.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await authService.login(input);
    return result;
  });

  app.post("/auth/refresh", async (request, reply) => {
    const input = refreshSchema.parse(request.body);
    const result = await authService.refresh(input.refreshToken);
    return result;
  });

  app.get(
    "/auth/me",
    { preHandler: authGuard },
    async (request, reply) => {
      const result = await authService.getMe(request.currentUser.sub);
      return result;
    },
  );
}
```

**Step 7: Registrar rotas em app.ts**

Adicionar no `buildApp()` em `apps/api/src/app.ts`:

```typescript
import { authRoutes } from "./modules/auth/auth.controller.js";

// Dentro de buildApp(), antes do return:
app.register(authRoutes);
```

**Step 8: Rodar testes para verificar que passam**

Run: `cd apps/api && npx vitest run src/modules/auth/auth.test.ts`
Expected: PASS — todos os 5 testes

**Step 9: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat: add JWT auth module with login, refresh, me endpoints and middleware"
```

---

## Task 6: Módulo Tenant — CRUD completo

**Files:**
- Create: `apps/api/src/modules/tenant/tenant.schema.ts`
- Create: `apps/api/src/modules/tenant/tenant.repository.ts`
- Create: `apps/api/src/modules/tenant/tenant.service.ts`
- Create: `apps/api/src/modules/tenant/tenant.controller.ts`
- Test: `apps/api/src/modules/tenant/tenant.test.ts`

**Step 1: Escrever os testes**

```typescript
// apps/api/src/modules/tenant/tenant.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

describe("Tenant CRUD", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let tenantId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed admin user
    await prisma.user.create({
      data: {
        email: "admin-tenant-test@mendes.com",
        nome: "Admin",
        senhaHash: await bcrypt.hash("Senha123!", 10),
        role: "ADMIN",
      },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin-tenant-test@mendes.com", senha: "Senha123!" },
    });
    accessToken = loginRes.json().accessToken;
  });

  afterAll(async () => {
    if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await prisma.user.deleteMany({ where: { email: "admin-tenant-test@mendes.com" } });
    await app.close();
  });

  it("POST /tenants deve criar empresa", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tenants",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        razaoSocial: "Mendes Tech LTDA",
        nomeFantasia: "Mendes Tech",
        cnpj: "12345678000190",
      },
    });
    expect(res.statusCode).toBe(201);
    tenantId = res.json().id;
    expect(res.json().nomeFantasia).toBe("Mendes Tech");
  });

  it("GET /tenants deve listar empresas", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/tenants",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /tenants/:id deve retornar empresa", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().cnpj).toBe("12345678000190");
  });

  it("PUT /tenants/:id deve atualizar empresa", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { nomeFantasia: "Mendes Tech Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().nomeFantasia).toBe("Mendes Tech Updated");
  });

  it("DELETE /tenants/:id deve desativar empresa", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ativo).toBe(false);
  });

  it("POST /tenants com CNPJ duplicado retorna 400", async () => {
    // Reativar para testar duplicidade
    await prisma.tenant.update({ where: { id: tenantId }, data: { ativo: true } });
    const res = await app.inject({
      method: "POST",
      url: "/tenants",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        razaoSocial: "Outra Empresa",
        nomeFantasia: "Outra",
        cnpj: "12345678000190",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

**Step 2: Rodar testes para verificar que falham**

Run: `cd apps/api && npx vitest run src/modules/tenant/tenant.test.ts`
Expected: FAIL

**Step 3: Criar tenant.schema.ts**

```typescript
// apps/api/src/modules/tenant/tenant.schema.ts
import { z } from "zod/v4";

export const createTenantSchema = z.object({
  razaoSocial: z.string().min(1),
  nomeFantasia: z.string().min(1),
  cnpj: z.string().regex(/^\d{14}$/, "CNPJ deve ter 14 dígitos"),
  inscricaoEstadual: z.string().optional(),
  endereco: z.string().optional(),
  telefone: z.string().optional(),
  email: z.email().optional(),
  logo: z.string().optional(),
  segmento: z.string().optional(),
  pinbankUserName: z.string().optional(),
  pinbankKeyValue: z.string().optional(),
  pinbankRequestOrigin: z.string().optional(),
  pinbankCodigoCanal: z.number().int().optional(),
  pinbankCodigoCliente: z.number().int().optional(),
  pinbankCedenteContaNumero: z.string().optional(),
  pinbankCedenteContaNumeroDV: z.string().optional(),
  pinbankCedenteContaCodigoBanco: z.string().optional(),
});

export const updateTenantSchema = createTenantSchema.partial();

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
```

**Step 4: Criar tenant.repository.ts**

```typescript
// apps/api/src/modules/tenant/tenant.repository.ts
import { prisma } from "../../config/prisma.js";
import type { CreateTenantInput, UpdateTenantInput } from "./tenant.schema.js";

export async function create(data: CreateTenantInput) {
  return prisma.tenant.create({ data });
}

export async function findById(id: string) {
  return prisma.tenant.findUnique({ where: { id } });
}

export async function findByCnpj(cnpj: string) {
  return prisma.tenant.findUnique({ where: { cnpj } });
}

export async function findAll(skip: number, take: number) {
  const [data, total] = await Promise.all([
    prisma.tenant.findMany({
      where: { ativo: true },
      skip,
      take,
      orderBy: { nomeFantasia: "asc" },
    }),
    prisma.tenant.count({ where: { ativo: true } }),
  ]);
  return { data, total };
}

export async function update(id: string, data: UpdateTenantInput) {
  return prisma.tenant.update({ where: { id }, data });
}

export async function deactivate(id: string) {
  return prisma.tenant.update({
    where: { id },
    data: { ativo: false },
  });
}
```

**Step 5: Criar tenant.service.ts**

```typescript
// apps/api/src/modules/tenant/tenant.service.ts
import * as tenantRepo from "./tenant.repository.js";
import { createTenantSchema, updateTenantSchema } from "./tenant.schema.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { paginate, paginatedResponse } from "../../shared/pagination.js";

export async function create(input: unknown) {
  const data = createTenantSchema.parse(input);

  const exists = await tenantRepo.findByCnpj(data.cnpj);
  if (exists) {
    throw new AppError("Já existe uma empresa com este CNPJ");
  }

  return tenantRepo.create(data);
}

export async function findById(id: string) {
  const tenant = await tenantRepo.findById(id);
  if (!tenant) throw new NotFoundError("Empresa");
  return tenant;
}

export async function findAll(pagination: PaginationInput) {
  const { skip, take } = paginate(pagination);
  const { data, total } = await tenantRepo.findAll(skip, take);
  return paginatedResponse(data, total, pagination);
}

export async function update(id: string, input: unknown) {
  await findById(id); // throws 404 if not found
  const data = updateTenantSchema.parse(input);
  return tenantRepo.update(id, data);
}

export async function deactivate(id: string) {
  await findById(id);
  return tenantRepo.deactivate(id);
}
```

**Step 6: Criar tenant.controller.ts**

```typescript
// apps/api/src/modules/tenant/tenant.controller.ts
import type { FastifyInstance } from "fastify";
import * as tenantService from "./tenant.service.js";
import { adminGuard } from "../auth/auth.middleware.js";
import { paginationSchema } from "../../shared/pagination.js";

export async function tenantRoutes(app: FastifyInstance) {
  app.addHook("preHandler", adminGuard);

  app.post("/tenants", async (request, reply) => {
    const tenant = await tenantService.create(request.body);
    return reply.status(201).send(tenant);
  });

  app.get("/tenants", async (request, reply) => {
    const pagination = paginationSchema.parse(request.query);
    return tenantService.findAll(pagination);
  });

  app.get("/tenants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return tenantService.findById(id);
  });

  app.put("/tenants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return tenantService.update(id, request.body);
  });

  app.delete("/tenants/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return tenantService.deactivate(id);
  });
}
```

**Step 7: Registrar rotas no app.ts**

```typescript
import { tenantRoutes } from "./modules/tenant/tenant.controller.js";

// Dentro de buildApp():
app.register(tenantRoutes);
```

**Step 8: Rodar testes para verificar que passam**

Run: `cd apps/api && npx vitest run src/modules/tenant/tenant.test.ts`
Expected: PASS — todos os 6 testes

**Step 9: Commit**

```bash
git add apps/api/src/modules/tenant/
git commit -m "feat: add Tenant CRUD module with validation, pagination and admin guard"
```

---

## Task 7: Módulo User — CRUD + atribuição de empresa/permissões

**Files:**
- Create: `apps/api/src/modules/user/user.schema.ts`
- Create: `apps/api/src/modules/user/user.repository.ts`
- Create: `apps/api/src/modules/user/user.service.ts`
- Create: `apps/api/src/modules/user/user.controller.ts`
- Test: `apps/api/src/modules/user/user.test.ts`

**Step 1: Escrever os testes**

```typescript
// apps/api/src/modules/user/user.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";

describe("User CRUD", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  let tenantId: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    // Seed
    const admin = await prisma.user.create({
      data: {
        email: "admin-user-test@mendes.com",
        nome: "Admin",
        senhaHash: await bcrypt.hash("Senha123!", 10),
        role: "ADMIN",
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        razaoSocial: "Empresa Teste Users",
        nomeFantasia: "Teste Users",
        cnpj: "99999999000100",
      },
    });
    tenantId = tenant.id;

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin-user-test@mendes.com", senha: "Senha123!" },
    });
    accessToken = loginRes.json().accessToken;
  });

  afterAll(async () => {
    await prisma.userTenant.deleteMany({});
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.deleteMany({ where: { email: "admin-user-test@mendes.com" } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  });

  it("POST /users deve criar usuário", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/users",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        nome: "João Gestor",
        email: "joao@mendes.com",
        senha: "Senha123!",
        role: "GESTOR",
      },
    });
    expect(res.statusCode).toBe(201);
    userId = res.json().id;
    expect(res.json().email).toBe("joao@mendes.com");
  });

  it("POST /users/:id/tenants deve atribuir empresa ao usuário", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/users/${userId}/tenants`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        tenantId,
        acessoFinanceiro: true,
        acessoComercial: false,
        acessoSAC: true,
        acessoFiscal: false,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().acessoFinanceiro).toBe(true);
  });

  it("GET /users deve listar usuários", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/users",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE /users/:id/tenants/:tenantId deve remover acesso", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/users/${userId}/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

**Step 2: Rodar testes para verificar que falham**

Run: `cd apps/api && npx vitest run src/modules/user/user.test.ts`
Expected: FAIL

**Step 3: Criar user.schema.ts**

```typescript
// apps/api/src/modules/user/user.schema.ts
import { z } from "zod/v4";

export const createUserSchema = z.object({
  nome: z.string().min(1),
  email: z.email(),
  senha: z.string().min(6),
  role: z.enum(["ADMIN", "GESTOR"]).default("GESTOR"),
});

export const updateUserSchema = z.object({
  nome: z.string().min(1).optional(),
  email: z.email().optional(),
  senha: z.string().min(6).optional(),
  role: z.enum(["ADMIN", "GESTOR"]).optional(),
  ativo: z.boolean().optional(),
});

export const assignTenantSchema = z.object({
  tenantId: z.string().uuid(),
  acessoFinanceiro: z.boolean().default(false),
  acessoComercial: z.boolean().default(false),
  acessoSAC: z.boolean().default(false),
  acessoFiscal: z.boolean().default(false),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AssignTenantInput = z.infer<typeof assignTenantSchema>;
```

**Step 4: Criar user.repository.ts**

```typescript
// apps/api/src/modules/user/user.repository.ts
import { prisma } from "../../config/prisma.js";
import type { AssignTenantInput } from "./user.schema.js";

export async function create(data: {
  nome: string;
  email: string;
  senhaHash: string;
  role: "ADMIN" | "GESTOR";
}) {
  return prisma.user.create({
    data,
    select: { id: true, nome: true, email: true, role: true, ativo: true, createdAt: true },
  });
}

export async function findById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    include: { tenants: { include: { tenant: true } } },
  });
}

export async function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function findAll(skip: number, take: number) {
  const [data, total] = await Promise.all([
    prisma.user.findMany({
      skip,
      take,
      orderBy: { nome: "asc" },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        ativo: true,
        lastLoginAt: true,
        tenants: { include: { tenant: { select: { id: true, nomeFantasia: true } } } },
      },
    }),
    prisma.user.count(),
  ]);
  return { data, total };
}

export async function update(id: string, data: Record<string, unknown>) {
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, nome: true, email: true, role: true, ativo: true },
  });
}

export async function assignTenant(userId: string, input: AssignTenantInput) {
  return prisma.userTenant.create({
    data: {
      userId,
      tenantId: input.tenantId,
      acessoFinanceiro: input.acessoFinanceiro,
      acessoComercial: input.acessoComercial,
      acessoSAC: input.acessoSAC,
      acessoFiscal: input.acessoFiscal,
    },
  });
}

export async function removeTenant(userId: string, tenantId: string) {
  return prisma.userTenant.delete({
    where: { userId_tenantId: { userId, tenantId } },
  });
}
```

**Step 5: Criar user.service.ts**

```typescript
// apps/api/src/modules/user/user.service.ts
import bcrypt from "bcryptjs";
import * as userRepo from "./user.repository.js";
import { createUserSchema, updateUserSchema, assignTenantSchema } from "./user.schema.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import { paginate, paginatedResponse, type PaginationInput } from "../../shared/pagination.js";

export async function create(input: unknown) {
  const data = createUserSchema.parse(input);

  const exists = await userRepo.findByEmail(data.email);
  if (exists) throw new AppError("Já existe um usuário com este e-mail");

  const senhaHash = await bcrypt.hash(data.senha, 10);
  return userRepo.create({
    nome: data.nome,
    email: data.email,
    senhaHash,
    role: data.role,
  });
}

export async function findById(id: string) {
  const user = await userRepo.findById(id);
  if (!user) throw new NotFoundError("Usuário");
  const { senhaHash: _, ...safe } = user;
  return safe;
}

export async function findAll(pagination: PaginationInput) {
  const { skip, take } = paginate(pagination);
  const { data, total } = await userRepo.findAll(skip, take);
  return paginatedResponse(data, total, pagination);
}

export async function update(id: string, input: unknown) {
  const data = updateUserSchema.parse(input);
  await findById(id);

  const updateData: Record<string, unknown> = { ...data };
  if (data.senha) {
    updateData.senhaHash = await bcrypt.hash(data.senha, 10);
    delete updateData.senha;
  }

  return userRepo.update(id, updateData);
}

export async function assignTenant(userId: string, input: unknown) {
  const data = assignTenantSchema.parse(input);
  await findById(userId);
  return userRepo.assignTenant(userId, data);
}

export async function removeTenant(userId: string, tenantId: string) {
  return userRepo.removeTenant(userId, tenantId);
}
```

**Step 6: Criar user.controller.ts**

```typescript
// apps/api/src/modules/user/user.controller.ts
import type { FastifyInstance } from "fastify";
import * as userService from "./user.service.js";
import { adminGuard } from "../auth/auth.middleware.js";
import { paginationSchema } from "../../shared/pagination.js";

export async function userRoutes(app: FastifyInstance) {
  app.addHook("preHandler", adminGuard);

  app.post("/users", async (request, reply) => {
    const user = await userService.create(request.body);
    return reply.status(201).send(user);
  });

  app.get("/users", async (request, reply) => {
    const pagination = paginationSchema.parse(request.query);
    return userService.findAll(pagination);
  });

  app.get("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return userService.findById(id);
  });

  app.put("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return userService.update(id, request.body);
  });

  app.post("/users/:id/tenants", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await userService.assignTenant(id, request.body);
    return reply.status(201).send(result);
  });

  app.delete("/users/:id/tenants/:tenantId", async (request, reply) => {
    const { id, tenantId } = request.params as { id: string; tenantId: string };
    await userService.removeTenant(id, tenantId);
    return { ok: true };
  });
}
```

**Step 7: Registrar rotas no app.ts**

```typescript
import { userRoutes } from "./modules/user/user.controller.js";

// Dentro de buildApp():
app.register(userRoutes);
```

**Step 8: Rodar testes**

Run: `cd apps/api && npx vitest run src/modules/user/user.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add apps/api/src/modules/user/
git commit -m "feat: add User CRUD module with tenant assignment and permissions"
```

---

## Task 8: Módulo Audit — Log de auditoria

**Files:**
- Create: `apps/api/src/modules/audit/audit.schema.ts`
- Create: `apps/api/src/modules/audit/audit.repository.ts`
- Create: `apps/api/src/modules/audit/audit.service.ts`
- Create: `apps/api/src/modules/audit/audit.controller.ts`
- Test: `apps/api/src/modules/audit/audit.test.ts`

**Step 1: Escrever os testes**

```typescript
// apps/api/src/modules/audit/audit.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app.js";
import { prisma } from "../../config/prisma.js";
import bcrypt from "bcryptjs";
import * as auditService from "./audit.service.js";
import type { FastifyInstance } from "fastify";

describe("Audit Log", () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    await prisma.user.create({
      data: {
        id: "audit-test-user-id",
        email: "admin-audit-test@mendes.com",
        nome: "Admin Audit",
        senhaHash: await bcrypt.hash("Senha123!", 10),
        role: "ADMIN",
      },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "admin-audit-test@mendes.com", senha: "Senha123!" },
    });
    accessToken = loginRes.json().accessToken;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: "audit-test-user-id" } });
    await prisma.user.deleteMany({ where: { id: "audit-test-user-id" } });
    await app.close();
  });

  it("deve registrar um log de auditoria", async () => {
    await auditService.log({
      userId: "audit-test-user-id",
      acao: "criar",
      entidade: "tenant",
      entidadeId: "fake-id",
      dadosDepois: { nome: "Teste" },
      ip: "127.0.0.1",
    });

    const logs = await prisma.auditLog.findMany({
      where: { userId: "audit-test-user-id" },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].acao).toBe("criar");
  });

  it("GET /audit deve listar logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/audit",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /audit com filtro por acao deve filtrar", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/audit?acao=criar",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.every((l: any) => l.acao === "criar")).toBe(true);
  });
});
```

**Step 2: Rodar testes — FAIL esperado**

**Step 3: Criar audit.schema.ts**

```typescript
// apps/api/src/modules/audit/audit.schema.ts
import { z } from "zod/v4";

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  acao: z.string().optional(),
  entidade: z.string().optional(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  de: z.string().optional(),  // data início (ISO)
  ate: z.string().optional(), // data fim (ISO)
});

export type AuditQueryInput = z.infer<typeof auditQuerySchema>;
```

**Step 4: Criar audit.repository.ts**

```typescript
// apps/api/src/modules/audit/audit.repository.ts
import { prisma } from "../../config/prisma.js";
import type { Prisma } from "../../generated/prisma/client.js";

export async function create(data: Prisma.AuditLogCreateInput) {
  return prisma.auditLog.create({ data });
}

export async function findAll(
  where: Prisma.AuditLogWhereInput,
  skip: number,
  take: number,
) {
  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, nome: true, email: true } },
        tenant: { select: { id: true, nomeFantasia: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { data, total };
}
```

**Step 5: Criar audit.service.ts**

```typescript
// apps/api/src/modules/audit/audit.service.ts
import * as auditRepo from "./audit.repository.js";
import { auditQuerySchema, type AuditQueryInput } from "./audit.schema.js";
import { paginatedResponse } from "../../shared/pagination.js";
import type { Prisma } from "../../generated/prisma/client.js";

interface LogInput {
  tenantId?: string;
  userId?: string;
  acao: string;
  entidade: string;
  entidadeId?: string;
  dadosAntes?: unknown;
  dadosDepois?: unknown;
  ip?: string;
  userAgent?: string;
}

export async function log(input: LogInput) {
  return auditRepo.create({
    acao: input.acao,
    entidade: input.entidade,
    entidadeId: input.entidadeId,
    dadosAntes: input.dadosAntes as Prisma.InputJsonValue,
    dadosDepois: input.dadosDepois as Prisma.InputJsonValue,
    ip: input.ip,
    userAgent: input.userAgent,
    ...(input.tenantId && { tenant: { connect: { id: input.tenantId } } }),
    ...(input.userId && { user: { connect: { id: input.userId } } }),
  });
}

export async function findAll(query: unknown) {
  const input = auditQuerySchema.parse(query);
  const where: Prisma.AuditLogWhereInput = {};

  if (input.acao) where.acao = input.acao;
  if (input.entidade) where.entidade = input.entidade;
  if (input.userId) where.userId = input.userId;
  if (input.tenantId) where.tenantId = input.tenantId;
  if (input.de || input.ate) {
    where.createdAt = {};
    if (input.de) where.createdAt.gte = new Date(input.de);
    if (input.ate) where.createdAt.lte = new Date(input.ate);
  }

  const skip = (input.page - 1) * input.limit;
  const { data, total } = await auditRepo.findAll(where, skip, input.limit);
  return paginatedResponse(data, total, { page: input.page, limit: input.limit });
}
```

**Step 6: Criar audit.controller.ts**

```typescript
// apps/api/src/modules/audit/audit.controller.ts
import type { FastifyInstance } from "fastify";
import * as auditService from "./audit.service.js";
import { adminGuard } from "../auth/auth.middleware.js";

export async function auditRoutes(app: FastifyInstance) {
  app.addHook("preHandler", adminGuard);

  app.get("/audit", async (request, reply) => {
    return auditService.findAll(request.query);
  });
}
```

**Step 7: Registrar no app.ts**

```typescript
import { auditRoutes } from "./modules/audit/audit.controller.js";
app.register(auditRoutes);
```

**Step 8: Rodar testes**

Run: `cd apps/api && npx vitest run src/modules/audit/audit.test.ts`
Expected: PASS

**Step 9: Commit**

```bash
git add apps/api/src/modules/audit/
git commit -m "feat: add audit log module with immutable logging and query endpoint"
```

---

## Task 9: Integrar auditoria nos módulos Tenant e User

**Files:**
- Modify: `apps/api/src/modules/tenant/tenant.controller.ts`
- Modify: `apps/api/src/modules/user/user.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

**Step 1: Adicionar audit log no tenant controller**

Em cada endpoint de mutação do tenant controller, adicionar chamada a `auditService.log()` após a operação. Exemplo no POST:

```typescript
import * as auditService from "../audit/audit.service.js";

// No POST /tenants, após criar:
await auditService.log({
  userId: request.currentUser.sub,
  acao: "criar",
  entidade: "tenant",
  entidadeId: tenant.id,
  dadosDepois: tenant,
  ip: request.ip,
  userAgent: request.headers["user-agent"],
});
```

Repetir para PUT (com dadosAntes/dadosDepois) e DELETE.

**Step 2: Adicionar audit log no auth controller (login)**

```typescript
// No POST /auth/login, após login bem-sucedido:
await auditService.log({
  userId: result.user.id,
  acao: "login",
  entidade: "user",
  entidadeId: result.user.id,
  ip: request.ip,
  userAgent: request.headers["user-agent"],
});
```

**Step 3: Adicionar audit log no user controller**

Mesmo padrão para POST, PUT e assign/remove tenant.

**Step 4: Rodar todos os testes**

Run: `cd apps/api && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add apps/api/src/modules/
git commit -m "feat: integrate audit logging into tenant, user and auth modules"
```

---

## Task 10: Seed script — criar admin inicial

**Files:**
- Create: `apps/api/prisma/seed.ts`

**Step 1: Criar seed.ts**

```typescript
// apps/api/prisma/seed.ts
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import "dotenv/config";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = "admin@mendes.com";

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) {
    console.log("Admin já existe, pulando seed.");
    return;
  }

  const admin = await prisma.user.create({
    data: {
      nome: "Administrador",
      email,
      senhaHash: await bcrypt.hash("Admin123!", 10),
      role: "ADMIN",
    },
  });

  console.log(`Admin criado: ${admin.email}`);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
```

**Step 2: Adicionar script no package.json**

```json
"db:seed": "tsx prisma/seed.ts"
```

**Step 3: Executar seed**

Run: `cd apps/api && npm run db:seed`
Expected: "Admin criado: admin@mendes.com"

**Step 4: Commit**

```bash
git add apps/api/prisma/seed.ts apps/api/package.json
git commit -m "feat: add database seed script with initial admin user"
```

---

## Task 11: Frontend — Setup Next.js com TailwindCSS e Shadcn/UI

**Files:**
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/tailwind.config.ts`

**Step 1: Inicializar Next.js e instalar dependências**

Run: `cd apps/web && npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm`
Expected: Next.js project scaffolded

**Step 2: Instalar Shadcn/UI**

Run: `cd apps/web && npx shadcn@latest init`
Expected: Shadcn configured

**Step 3: Instalar componentes Shadcn necessários**

Run: `cd apps/web && npx shadcn@latest add button input label card table dialog dropdown-menu avatar badge separator toast sheet tabs`
Expected: Components installed in `src/components/ui/`

**Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat: initialize Next.js frontend with TailwindCSS and Shadcn/UI"
```

---

## Task 12: Frontend — API client, Auth context, AuthGuard

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/auth.tsx`
- Create: `apps/web/src/hooks/use-empresa.ts`

**Step 1: Criar API client**

```typescript
// apps/web/src/lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined"
    ? localStorage.getItem("accessToken")
    : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    // Tentar refresh
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        localStorage.setItem("accessToken", data.accessToken);
        localStorage.setItem("refreshToken", data.refreshToken);
        // Retry original request
        return request<T>(path, options);
      }
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `Erro ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),
};
```

**Step 2: Criar Auth context**

```typescript
// apps/web/src/lib/auth.tsx
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  nome: string;
  email: string;
  role: string;
  tenants: Array<{
    id: string;
    nomeFantasia: string;
    cnpj: string;
    permissoes: {
      financeiro: boolean;
      comercial: boolean;
      sac: boolean;
      fiscal: boolean;
    };
  }>;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      api.get<User>("/auth/me")
        .then(setUser)
        .catch(() => {
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, senha: string) => {
    const res = await api.post<{
      accessToken: string;
      refreshToken: string;
      user: User;
    }>("/auth/login", { email, senha });
    localStorage.setItem("accessToken", res.accessToken);
    localStorage.setItem("refreshToken", res.refreshToken);
    setUser(res.user as User);
    router.push("/");
  };

  const logout = () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

**Step 3: Criar hook use-empresa**

```typescript
// apps/web/src/hooks/use-empresa.ts
"use client";

import { useState, useEffect } from "react";

export function useEmpresa() {
  const [empresaId, setEmpresaId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("empresaSelecionada");
    if (saved) setEmpresaId(saved);
  }, []);

  const selectEmpresa = (id: string) => {
    localStorage.setItem("empresaSelecionada", id);
    setEmpresaId(id);
  };

  return { empresaId, selectEmpresa };
}
```

**Step 4: Commit**

```bash
git add apps/web/src/lib/ apps/web/src/hooks/
git commit -m "feat: add API client with JWT refresh, Auth context and empresa selector hook"
```

---

## Task 13: Frontend — Página de Login

**Files:**
- Create: `apps/web/src/app/(auth)/login/page.tsx`

**Step 1: Criar página de login**

```tsx
// apps/web/src/app/(auth)/login/page.tsx
"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, senha);
    } catch (err: any) {
      setError(err.message || "Erro ao fazer login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Mendes ERP</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Verificar no browser**

Run: `cd apps/web && npm run dev`
Navigate to: `http://localhost:3001/login`
Expected: Tela de login renderiza corretamente

**Step 3: Commit**

```bash
git add apps/web/src/app/\(auth\)/
git commit -m "feat: add login page with email/password form"
```

---

## Task 14: Frontend — Layout autenticado (Sidebar + Header + EmpresaSelector)

**Files:**
- Create: `apps/web/src/components/layout/sidebar.tsx`
- Create: `apps/web/src/components/layout/header.tsx`
- Create: `apps/web/src/components/layout/empresa-selector.tsx`
- Create: `apps/web/src/app/(dashboard)/layout.tsx`

**Step 1: Criar Sidebar**

```tsx
// apps/web/src/components/layout/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const menuItems = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "Empresas", href: "/empresas", icon: "Building2" },
  { label: "Usuários", href: "/usuarios", icon: "Users" },
  { label: "Auditoria", href: "/auditoria", icon: "ScrollText" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r bg-white h-screen fixed left-0 top-0 flex flex-col">
      <div className="p-6 border-b">
        <h1 className="text-xl font-bold">Mendes ERP</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-gray-100 text-gray-900"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

**Step 2: Criar Header com EmpresaSelector**

```tsx
// apps/web/src/components/layout/header.tsx
"use client";

import { useAuth } from "@/lib/auth";
import { EmpresaSelector } from "./empresa-selector";
import { Button } from "@/components/ui/button";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-6 fixed top-0 left-64 right-0 z-10">
      <EmpresaSelector />
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-600">{user?.nome}</span>
        <Button variant="outline" size="sm" onClick={logout}>
          Sair
        </Button>
      </div>
    </header>
  );
}
```

```tsx
// apps/web/src/components/layout/empresa-selector.tsx
"use client";

import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/hooks/use-empresa";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EmpresaSelector() {
  const { user } = useAuth();
  const { empresaId, selectEmpresa } = useEmpresa();

  if (!user || user.role === "ADMIN") {
    // Admin pode ver "Todas" ou selecionar uma
    return (
      <Select value={empresaId || "all"} onValueChange={(v) => selectEmpresa(v)}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Selecionar empresa" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as empresas</SelectItem>
          {user?.tenants?.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.nomeFantasia}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={empresaId || ""} onValueChange={selectEmpresa}>
      <SelectTrigger className="w-64">
        <SelectValue placeholder="Selecionar empresa" />
      </SelectTrigger>
      <SelectContent>
        {user.tenants.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.nomeFantasia}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

**Step 3: Criar layout autenticado**

```tsx
// apps/web/src/app/(dashboard)/layout.tsx
"use client";

import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Carregando...</p>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <Header />
      <main className="ml-64 mt-16 p-6">{children}</main>
    </div>
  );
}
```

**Step 4: Verificar no browser**

Expected: Sidebar com menu, header com seletor de empresa, área de conteúdo

**Step 5: Commit**

```bash
git add apps/web/src/components/layout/ apps/web/src/app/\(dashboard\)/
git commit -m "feat: add authenticated layout with sidebar, header and empresa selector"
```

---

## Task 15: Frontend — Dashboard consolidado

**Files:**
- Create: `apps/web/src/app/(dashboard)/page.tsx`

**Step 1: Criar página do dashboard**

```tsx
// apps/web/src/app/(dashboard)/page.tsx
"use client";

import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-gray-600">
        Bem-vindo, {user?.nome}. Selecione uma empresa ou veja a visão consolidada.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Empresas Ativas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{user?.tenants?.length || 0}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Boletos Emitidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">—</p>
            <p className="text-xs text-gray-400">Em breve</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Receita Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">—</p>
            <p className="text-xs text-gray-400">Em breve</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">
              Tickets Abertos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">—</p>
            <p className="text-xs text-gray-400">Em breve</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Verificar no browser**

Expected: Dashboard com 4 cards de métricas

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/page.tsx
git commit -m "feat: add dashboard page with metric cards placeholder"
```

---

## Task 16: Frontend — CRUD de Empresas

**Files:**
- Create: `apps/web/src/app/(dashboard)/empresas/page.tsx`
- Create: `apps/web/src/app/(dashboard)/empresas/nova/page.tsx`
- Create: `apps/web/src/app/(dashboard)/empresas/[id]/page.tsx`

Estas páginas implementam:
- Listagem de empresas com DataTable (paginação, busca)
- Formulário de criação com validação
- Página de edição com formulário pré-preenchido
- Botão de desativar com confirmação (Dialog)

Cada página consome a API via `api.get/post/put/delete` e usa componentes Shadcn.

**Step 1: Implementar as 3 páginas seguindo os padrões dos Tasks anteriores**

**Step 2: Verificar no browser**

**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/empresas/
git commit -m "feat: add empresas CRUD pages with data table, create and edit forms"
```

---

## Task 17: Frontend — CRUD de Usuários + Atribuição de empresas

**Files:**
- Create: `apps/web/src/app/(dashboard)/usuarios/page.tsx`
- Create: `apps/web/src/app/(dashboard)/usuarios/novo/page.tsx`
- Create: `apps/web/src/app/(dashboard)/usuarios/[id]/page.tsx`

Mesma estrutura da Task 16, adicionando:
- Formulário de atribuição de empresa com checkboxes de permissão
- Lista de empresas atribuídas ao usuário com botão remover

**Step 1: Implementar as 3 páginas**
**Step 2: Verificar no browser**
**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/usuarios/
git commit -m "feat: add usuarios CRUD pages with tenant assignment and permissions"
```

---

## Task 18: Frontend — Consulta de Logs de Auditoria

**Files:**
- Create: `apps/web/src/app/(dashboard)/auditoria/page.tsx`

Página com:
- Tabela de logs com colunas: data, usuário, ação, entidade, empresa
- Filtros: ação, entidade, usuário, empresa, período
- Paginação server-side
- Sem ações de editar/excluir (logs são imutáveis)

**Step 1: Implementar a página**
**Step 2: Verificar no browser**
**Step 3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/auditoria/
git commit -m "feat: add audit log query page with filters and pagination"
```

---

## Task 19: Testes end-to-end e validação final

**Step 1: Rodar todos os testes do backend**

Run: `cd apps/api && npx vitest run`
Expected: ALL PASS

**Step 2: Verificar o frontend no browser**

Checklist:
- [ ] Login funciona com admin@mendes.com / Admin123!
- [ ] Dashboard mostra cards de métricas
- [ ] Sidebar navega entre páginas
- [ ] CRUD de empresas: criar, listar, editar, desativar
- [ ] CRUD de usuários: criar, listar, editar, atribuir empresa
- [ ] Seletor de empresa funciona no header
- [ ] Logs de auditoria mostram ações realizadas
- [ ] Logout redireciona para login

**Step 3: Commit final**

```bash
git add -A
git commit -m "feat: complete Phase 1 - multi-tenancy, auth, users, audit and dashboard"
```

---

## Resumo das Tasks

| Task | Descrição | Commits |
|------|-----------|---------|
| 1 | Monorepo + dependências | 1 |
| 2 | Prisma schema (Tenant, User, AuditLog) | 1 |
| 3 | Config base (env, prisma, errors, pagination) | 1 |
| 4 | App Fastify + health check + teste | 1 |
| 5 | Auth module (JWT login, refresh, me, middleware) | 1 |
| 6 | Tenant CRUD module | 1 |
| 7 | User CRUD + atribuição empresa/permissões | 1 |
| 8 | Audit log module | 1 |
| 9 | Integrar auditoria nos módulos | 1 |
| 10 | Seed script (admin inicial) | 1 |
| 11 | Frontend setup (Next.js + Tailwind + Shadcn) | 1 |
| 12 | API client + Auth context + useEmpresa | 1 |
| 13 | Página de login | 1 |
| 14 | Layout autenticado (sidebar, header, empresa selector) | 1 |
| 15 | Dashboard consolidado | 1 |
| 16 | Frontend CRUD empresas | 1 |
| 17 | Frontend CRUD usuários | 1 |
| 18 | Frontend consulta auditoria | 1 |
| 19 | Testes E2E e validação | 1 |
| **Total** | **19 tasks, ~19 commits** | |
