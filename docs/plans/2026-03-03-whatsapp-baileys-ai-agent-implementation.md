# WhatsApp Baileys + AI Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Evolution API with a Baileys-based WhatsApp microservice and add AI Agent with RAG to the SAC module.

**Architecture:** Microservice (Express :3001) handles WhatsApp via Baileys, communicates with ERP (Next.js :3000) via HTTP webhooks. AI Agent runs inside ERP as BullMQ worker. Knowledge Base uses embeddings stored in PostgreSQL.

**Tech Stack:** Baileys v7, Express 5, Prisma, BullMQ, PostgreSQL, Redis, configurable LLM (DeepSeek/OpenAI/Anthropic)

---

## Phase 1: WhatsApp Microservice

### Task 1: Scaffold WhatsApp Service project

**Files:**
- Create: `whatsapp-service/package.json`
- Create: `whatsapp-service/tsconfig.json`
- Create: `whatsapp-service/.env.example`

**Step 1: Create project directory and package.json**

```bash
mkdir -p whatsapp-service
```

```json
{
  "name": "whatsapp-service",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "^7.0.0-rc.9",
    "@prisma/client": "^6.19.2",
    "@hapi/boom": "^10.0.1",
    "express": "^5.1.0",
    "qrcode": "^1.5.3",
    "cors": "^2.8.5",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/cors": "^2.8.17",
    "@types/qrcode": "^1.5.5",
    "prisma": "^6.19.2",
    "tsx": "^4.21.0",
    "typescript": "^5"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .env.example**

```env
# Database (same as ERP)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/erp_mendes?schema=public"

# Server
WHATSAPP_SERVICE_PORT=3001

# Webhook (ERP endpoint)
WHATSAPP_WEBHOOK_URL="http://localhost:3000/api/webhooks/whatsapp"
WHATSAPP_WEBHOOK_SECRET="whatsapp-webhook-secret-change-in-production"

# API Key (for ERP to authenticate requests to this service)
WHATSAPP_SERVICE_API_KEY="whatsapp-service-key-change-in-production"
```

**Step 4: Install dependencies**

```bash
cd whatsapp-service && npm install
```

**Step 5: Commit**

```bash
git add whatsapp-service/package.json whatsapp-service/tsconfig.json whatsapp-service/.env.example
git commit -m "feat: scaffold whatsapp-service microservice"
```

---

### Task 2: Prisma schema — add Baileys auth tables

**Files:**
- Modify: `erp/prisma/schema.prisma`

**Step 1: Add BaileysAuthState and LidMapping models**

Add to the end of `erp/prisma/schema.prisma`:

```prisma
// ===== WhatsApp Baileys Auth =====

model BaileysAuthState {
  id        String   @id @default(cuid())
  companyId String
  keyType   String
  keyId     String
  keyData   Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, keyType, keyId])
  @@index([companyId])
  @@map("baileys_auth_state")
}

model LidMapping {
  id          String   @id @default(cuid())
  companyId   String
  lid         String
  phoneNumber String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company     Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, lid])
  @@index([companyId])
  @@map("lid_mappings")
}
```

Also add relations to the `Company` model:

```prisma
// Inside model Company, add:
baileysAuthStates BaileysAuthState[]
lidMappings       LidMapping[]
```

**Step 2: Push schema to database**

```bash
cd erp && npx prisma db push
```

**Step 3: Commit**

```bash
git add erp/prisma/schema.prisma
git commit -m "feat: add BaileysAuthState and LidMapping models"
```

---

### Task 3: Symlink Prisma client to WhatsApp Service

**Files:**
- Create: `whatsapp-service/prisma/schema.prisma` (symlink or copy)
- Create: `whatsapp-service/src/lib/prisma.ts`

**Step 1: Reference the same Prisma schema**

The WhatsApp Service shares the same database. Create a symlink or copy of the schema:

```bash
cd whatsapp-service && mkdir -p prisma
cp ../erp/prisma/schema.prisma prisma/schema.prisma
```

Then generate the Prisma client:

```bash
cd whatsapp-service && npx prisma generate
```

**Step 2: Create Prisma client file**

Create `whatsapp-service/src/lib/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

**Step 3: Commit**

```bash
git add whatsapp-service/prisma/ whatsapp-service/src/lib/prisma.ts
git commit -m "feat: setup Prisma client for whatsapp-service"
```

---

### Task 4: Implement useDatabaseAuthState with Prisma

**Files:**
- Create: `whatsapp-service/src/providers/useDatabaseAuthState.ts`

**Step 1: Write the Prisma-based auth state manager**

Adapted from JáRespondi's Supabase version at `/tmp/jarespondiv2/apps/api/src/providers/useDatabaseAuthState.ts`. Key changes: Supabase → Prisma.

```typescript
import {
  AuthenticationCreds,
  AuthenticationState,
  initAuthCreds,
  BufferJSON,
  proto,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys'
import { prisma } from '../lib/prisma'

export async function useDatabaseAuthState(companyId: string): Promise<{
  state: AuthenticationState
  saveCreds: () => Promise<void>
}> {
  const memoryCache = new Map<string, any>()

  const readKey = async (keyId: string): Promise<any> => {
    const cacheKey = `${companyId}:${keyId}`
    if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)

    const row = await prisma.baileysAuthState.findFirst({
      where: { companyId, keyType: 'creds', keyId },
    })
    if (row) {
      memoryCache.set(cacheKey, row.keyData)
      return row.keyData
    }
    return null
  }

  const writeKey = async (keyId: string, value: any): Promise<void> => {
    const cacheKey = `${companyId}:${keyId}`
    memoryCache.set(cacheKey, value)

    await prisma.baileysAuthState.upsert({
      where: {
        companyId_keyType_keyId: { companyId, keyType: 'creds', keyId },
      },
      update: { keyData: value },
      create: { companyId, keyType: 'creds', keyId, keyData: value },
    })
  }

  const removeKey = async (keyId: string): Promise<void> => {
    memoryCache.delete(`${companyId}:${keyId}`)
    await prisma.baileysAuthState.deleteMany({
      where: { companyId, keyType: 'creds', keyId },
    })
  }

  // Load or initialize credentials
  const credsData = await readKey('main')
  let creds: AuthenticationCreds = credsData
    ? JSON.parse(JSON.stringify(credsData), BufferJSON.reviver)
    : initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, any> = {}
          for (const id of ids) {
            const cacheKey = `${companyId}:${type}:${id}`
            let value = memoryCache.get(cacheKey)
            if (!value) {
              // LID mappings stored in dedicated table
              if (type === 'lid-mapping') {
                const mapping = await prisma.lidMapping.findFirst({
                  where: { companyId, lid: id },
                })
                value = mapping ? { phoneNumber: mapping.phoneNumber } : null
              } else {
                const row = await prisma.baileysAuthState.findFirst({
                  where: { companyId, keyType: type, keyId: id },
                })
                value = row?.keyData ?? null
              }
              if (value) memoryCache.set(cacheKey, value)
            }
            if (value) {
              result[id] = JSON.parse(JSON.stringify(value), BufferJSON.reviver)
            }
          }
          return result
        },
        set: async (data: Record<string, Record<string, any | null>>) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              const cacheKey = `${companyId}:${type}:${id}`
              if (value === null || value === undefined) {
                memoryCache.delete(cacheKey)
                if (type === 'lid-mapping') {
                  await prisma.lidMapping.deleteMany({
                    where: { companyId, lid: id },
                  })
                } else {
                  await prisma.baileysAuthState.deleteMany({
                    where: { companyId, keyType: type, keyId: id },
                  })
                }
              } else {
                const serialized = JSON.parse(
                  JSON.stringify(value, BufferJSON.replacer)
                )
                memoryCache.set(cacheKey, serialized)
                if (type === 'lid-mapping') {
                  await prisma.lidMapping.upsert({
                    where: {
                      companyId_lid: { companyId, lid: id },
                    },
                    update: { phoneNumber: serialized.phoneNumber ?? serialized },
                    create: {
                      companyId,
                      lid: id,
                      phoneNumber: serialized.phoneNumber ?? serialized,
                    },
                  })
                } else {
                  await prisma.baileysAuthState.upsert({
                    where: {
                      companyId_keyType_keyId: { companyId, keyType: type, keyId: id },
                    },
                    update: { keyData: serialized },
                    create: { companyId, keyType: type, keyId: id, keyData: serialized },
                  })
                }
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      const serialized = JSON.parse(JSON.stringify(creds, BufferJSON.replacer))
      await writeKey('main', serialized)
    },
  }
}
```

**Step 2: Commit**

```bash
git add whatsapp-service/src/providers/useDatabaseAuthState.ts
git commit -m "feat: implement Prisma-based Baileys auth state"
```

---

### Task 5: Implement BaileysProvider

**Files:**
- Create: `whatsapp-service/src/providers/baileys.provider.ts`

**Step 1: Write the provider**

Adapted from JáRespondi (`/tmp/jarespondiv2/apps/api/src/providers/baileys.provider.ts`). Key changes:
- Supabase → Prisma
- Winston logger → console
- Media saved to local filesystem (not Supabase Storage)
- Webhook URL from env

This is the largest file (~800 lines simplified from ~1900). Core methods to implement:

```typescript
import makeWASocket, {
  DisconnectReason,
  WAMessage,
  WAMessageKey,
  Browsers,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import * as qrcode from 'qrcode'
import * as fs from 'fs'
import * as path from 'path'
import { useDatabaseAuthState } from './useDatabaseAuthState'

export interface BaileysSession {
  companyId: string
  socket: any
  qrCode?: string
  pairingCode?: string
  pairingMethod: 'qr' | 'code'
  isConnected: boolean
  isConnecting: boolean
  lastError?: string
}

export interface IncomingMessage {
  messageId: string
  from: string
  to: string
  content?: string
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'STICKER' | 'REACTION'
  mediaUrl?: string
  mediaMimeType?: string
  caption?: string
  timestamp: number
  isGroup: boolean
}

export class BaileysProvider {
  private sessions = new Map<string, BaileysSession>()
  private lastInitAttemptAt = new Map<string, number>()
  private reconnectBackoffMs = new Map<string, number>()
  private webhookUrl: string
  private webhookSecret: string

  constructor() {
    this.webhookUrl = process.env.WHATSAPP_WEBHOOK_URL || 'http://localhost:3000/api/webhooks/whatsapp'
    this.webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET || 'dev-secret'
  }

  // -- Connection Methods --
  async initiateQrCode(companyId: string, bypassCooldown = false): Promise<void>
  async initiatePairingCode(companyId: string, phoneNumber: string, bypassCooldown = false): Promise<void>
  async getQrCode(companyId: string): Promise<string>
  async getPairingCode(companyId: string): Promise<string>
  async disconnect(companyId: string): Promise<void>
  getConnectionStatus(companyId: string): { isConnected: boolean; isConnecting: boolean; lastError?: string }

  // -- Message Methods --
  async sendMessage(companyId: string, to: string, content: string): Promise<string>
  async sendMediaMessage(companyId: string, to: string, mediaUrl: string, caption?: string, mediaType?: string): Promise<string>

  // -- Private --
  private setupSocketHandlers(socket: any, companyId: string, saveCreds: () => Promise<void>): void
  private async handleMessage(msg: WAMessage, companyId: string): Promise<void>
  private async sendWebhook(event: string, data: any): Promise<void>
  private normalizeJid(to: string): string
  private async downloadAndSaveMedia(msg: WAMessage, companyId: string, mediaType: string, mimeType?: string): Promise<string | undefined>
}

export const baileysProvider = new BaileysProvider()
```

Key implementation details to carry over from JáRespondi:
- Socket config: `{ browser: Browsers.ubuntu('Chrome'), connectTimeoutMs: 30_000, markOnlineOnConnect: false, syncFullHistory: false }`
- Cooldown: 15s between connection attempts
- Reconnection: exponential backoff (5s → 60s)
- Disconnect reason 401 (device_removed): never auto-reconnect
- Disconnect reason restartRequired: recreate socket with same creds
- Media: download via `downloadMediaMessage()`, save to `uploads/` directory, POST URL to webhook

Webhook payload format (sent to ERP):
```typescript
// event: "messages.upsert"
{
  event: "messages.upsert",
  instance: companyId,
  data: {
    key: { remoteJid, fromMe, id },
    pushName,
    message: { conversation?, imageMessage?, documentMessage?, audioMessage?, videoMessage? },
    messageTimestamp,
    media: { url?, mimetype?, fileName? }
  }
}
```

This matches the existing `EvolutionWebhookPayload` interface in `erp/src/lib/workers/whatsapp-inbound.ts` so the ERP side needs minimal changes.

**Step 2: Commit**

```bash
git add whatsapp-service/src/providers/baileys.provider.ts
git commit -m "feat: implement BaileysProvider with QR/pairing/messaging"
```

---

### Task 6: Implement Express routes and server

**Files:**
- Create: `whatsapp-service/src/routes/instance.routes.ts`
- Create: `whatsapp-service/src/routes/message.routes.ts`
- Create: `whatsapp-service/src/middleware/auth.ts`
- Create: `whatsapp-service/src/index.ts`

**Step 1: Create auth middleware**

```typescript
// whatsapp-service/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express'

export function validateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['apikey'] as string
  const expected = process.env.WHATSAPP_SERVICE_API_KEY
  if (!expected || apiKey !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
```

**Step 2: Create instance routes**

```typescript
// whatsapp-service/src/routes/instance.routes.ts
import { Router } from 'express'
import { baileysProvider } from '../providers/baileys.provider'

const router = Router()

// POST /instance/connect — QR code method
router.post('/connect', async (req, res) => {
  const { companyId, phoneNumber } = req.body
  await baileysProvider.initiateQrCode(companyId)
  res.json({ status: 'CONNECTING', companyId })
})

// POST /instance/connect-pairing — Pairing code method
router.post('/connect-pairing', async (req, res) => {
  const { companyId, phoneNumber } = req.body
  await baileysProvider.initiatePairingCode(companyId, phoneNumber)
  res.json({ status: 'CONNECTING', companyId })
})

// GET /instance/:companyId/qr
router.get('/:companyId/qr', async (req, res) => {
  const qr = await baileysProvider.getQrCode(req.params.companyId)
  res.json({ qrCode: qr })
})

// GET /instance/:companyId/pairing-code
router.get('/:companyId/pairing-code', async (req, res) => {
  const code = await baileysProvider.getPairingCode(req.params.companyId)
  res.json({ pairingCode: code })
})

// GET /instance/:companyId/status
router.get('/:companyId/status', async (req, res) => {
  const status = baileysProvider.getConnectionStatus(req.params.companyId)
  res.json(status)
})

// POST /instance/:companyId/disconnect
router.post('/:companyId/disconnect', async (req, res) => {
  await baileysProvider.disconnect(req.params.companyId)
  res.json({ status: 'DISCONNECTED' })
})

export default router
```

**Step 3: Create message routes**

```typescript
// whatsapp-service/src/routes/message.routes.ts
import { Router } from 'express'
import { baileysProvider } from '../providers/baileys.provider'

const router = Router()

// POST /message/send-text
router.post('/send-text', async (req, res) => {
  const { companyId, to, content } = req.body
  const messageId = await baileysProvider.sendMessage(companyId, to, content)
  res.json({ messageId, status: 'sent' })
})

// POST /message/send-media
router.post('/send-media', async (req, res) => {
  const { companyId, to, mediaUrl, caption, mediaType } = req.body
  const messageId = await baileysProvider.sendMediaMessage(companyId, to, mediaUrl, caption, mediaType)
  res.json({ messageId, status: 'sent' })
})

export default router
```

**Step 4: Create main server**

```typescript
// whatsapp-service/src/index.ts
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { validateApiKey } from './middleware/auth'
import instanceRoutes from './routes/instance.routes'
import messageRoutes from './routes/message.routes'
import { prisma } from './lib/prisma'

const app = express()
const PORT = process.env.WHATSAPP_SERVICE_PORT || 3001

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(validateApiKey)

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))
app.use('/instance', instanceRoutes)
app.use('/message', messageRoutes)

// Serve uploaded media files
app.use('/uploads', express.static('uploads'))

app.listen(PORT, () => {
  console.log(`WhatsApp Service running on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
```

**Step 5: Commit**

```bash
git add whatsapp-service/src/
git commit -m "feat: implement Express server with instance and message routes"
```

---

### Task 7: Adapt ERP to use WhatsApp Service instead of Evolution API

**Files:**
- Modify: `erp/src/lib/evolution-api.ts` → rename to `erp/src/lib/whatsapp-api.ts`
- Modify: `erp/src/lib/workers/whatsapp-outbound.ts`
- Modify: `erp/src/app/api/webhooks/whatsapp/route.ts`
- Modify: `erp/.env`

**Step 1: Replace evolution-api.ts with whatsapp-api.ts**

Create `erp/src/lib/whatsapp-api.ts` (replaces `evolution-api.ts`):

```typescript
const WHATSAPP_SERVICE_URL = process.env.WHATSAPP_SERVICE_URL || 'http://localhost:3001'
const WHATSAPP_SERVICE_API_KEY = process.env.WHATSAPP_SERVICE_API_KEY || ''

async function whatsappFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${WHATSAPP_SERVICE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: WHATSAPP_SERVICE_API_KEY,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`WhatsApp Service error: ${res.status}`)
  return res.json()
}

export async function sendTextMessage(
  companyId: string,
  to: string,
  text: string
): Promise<string | null> {
  const data = await whatsappFetch('/message/send-text', {
    method: 'POST',
    body: JSON.stringify({ companyId, to, content: text }),
  })
  return data.messageId ?? null
}

export async function sendMediaMessage(
  companyId: string,
  to: string,
  mediaUrl: string,
  fileName: string,
  caption?: string
): Promise<string | null> {
  const data = await whatsappFetch('/message/send-media', {
    method: 'POST',
    body: JSON.stringify({ companyId, to, mediaUrl, fileName, caption, mediaType: 'document' }),
  })
  return data.messageId ?? null
}

export async function getInstanceStatus(
  companyId: string
): Promise<{ connected: boolean; state: string }> {
  const data = await whatsappFetch(`/instance/${companyId}/status`)
  return { connected: data.isConnected, state: data.isConnected ? 'open' : 'close' }
}
```

**Step 2: Update whatsapp-outbound.ts**

Change imports from `evolution-api` to `whatsapp-api`. Replace `instanceName` with `companyId`:

- Replace: `import { sendTextMessage, sendMediaMessage } from '../evolution-api'`
- With: `import { sendTextMessage, sendMediaMessage } from '../whatsapp-api'`
- Replace: `sendTextMessage(instanceName, to, content)` → `sendTextMessage(companyId, to, content)`
- Replace: `sendMediaMessage(instanceName, ...)` → `sendMediaMessage(companyId, ...)`
- Remove channel config decryption (no longer need instanceName)

**Step 3: Update webhook route**

Change `erp/src/app/api/webhooks/whatsapp/route.ts` to validate `WHATSAPP_WEBHOOK_SECRET` instead of `EVOLUTION_API_KEY`:

```typescript
const WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET

// Replace apikey validation:
const secret = request.headers.get("x-api-secret") ??
               request.headers.get("apikey") ??
               new URL(request.url).searchParams.get("apikey")

if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
```

The webhook payload format from BaileysProvider matches the Evolution API format (`messages.upsert` event with same `data.key`, `data.message` structure), so `whatsapp-inbound.ts` worker needs no changes.

**Step 4: Update .env**

Remove:
```
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
```

Add:
```
WHATSAPP_SERVICE_URL=http://localhost:3001
WHATSAPP_SERVICE_API_KEY=whatsapp-service-key-change-in-production
WHATSAPP_WEBHOOK_SECRET=whatsapp-webhook-secret-change-in-production
```

**Step 5: Commit**

```bash
git add erp/src/lib/whatsapp-api.ts erp/src/lib/workers/whatsapp-outbound.ts erp/src/app/api/webhooks/whatsapp/route.ts erp/.env erp/.env.example
git rm erp/src/lib/evolution-api.ts
git commit -m "feat: replace Evolution API with WhatsApp Service"
```

---

### Task 8: Update Docker Compose

**Files:**
- Modify: `docker-compose.yml`
- Create: `whatsapp-service/Dockerfile`

**Step 1: Create Dockerfile for WhatsApp Service**

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

**Step 2: Update docker-compose.yml**

Replace evolution-api service with:

```yaml
services:
  whatsapp-service:
    build: ./whatsapp-service
    container_name: whatsapp-service
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/erp_mendes?schema=public
      - WHATSAPP_SERVICE_PORT=3001
      - WHATSAPP_WEBHOOK_URL=http://host.docker.internal:3000/api/webhooks/whatsapp
      - WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET:-whatsapp-webhook-secret}
      - WHATSAPP_SERVICE_API_KEY=${WHATSAPP_SERVICE_API_KEY:-whatsapp-service-key}
    volumes:
      - whatsapp_uploads:/app/uploads
    restart: unless-stopped

volumes:
  whatsapp_uploads:
```

**Step 3: Commit**

```bash
git add docker-compose.yml whatsapp-service/Dockerfile
git commit -m "feat: add whatsapp-service to Docker Compose, remove Evolution API"
```

---

## Phase 2: AI Agent

### Task 9: Prisma schema — add AI models

**Files:**
- Modify: `erp/prisma/schema.prisma`

**Step 1: Add AiConfig, Document, DocumentChunk models and Ticket/TicketMessage fields**

Add to schema.prisma:

```prisma
// ===== AI Agent Config =====

model AiConfig {
  id                  String   @id @default(cuid())
  companyId           String   @unique
  enabled             Boolean  @default(false)
  persona             String   @db.Text
  welcomeMessage      String?  @db.Text
  escalationKeywords  String[]
  maxIterations       Int      @default(5)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  company             Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@map("ai_config")
}

// ===== Knowledge Base =====

model Document {
  id        String         @id @default(cuid())
  companyId String
  name      String
  mimeType  String
  fileSize  Int
  status    DocumentStatus @default(PROCESSING)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  company   Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  chunks    DocumentChunk[]

  @@index([companyId])
  @@map("documents")
}

model DocumentChunk {
  id         String   @id @default(cuid())
  documentId String
  content    String   @db.Text
  embedding  Float[]
  chunkIndex Int
  createdAt  DateTime @default(now())

  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@map("document_chunks")
}

enum DocumentStatus {
  PROCESSING
  READY
  ERROR
}
```

Add to Ticket model:
```prisma
aiEnabled       Boolean  @default(true)
```

Add to TicketMessage model:
```prisma
isAiGenerated   Boolean  @default(false)
```

Add relations to Company model:
```prisma
aiConfig        AiConfig?
documents       Document[]
```

**Step 2: Push schema**

```bash
cd erp && npx prisma db push
```

**Step 3: Commit**

```bash
git add erp/prisma/schema.prisma
git commit -m "feat: add AiConfig, Document, DocumentChunk models + AI fields on Ticket"
```

---

### Task 10: Implement AI provider abstraction

**Files:**
- Create: `erp/src/lib/ai/provider.ts`
- Create: `erp/src/lib/ai/tools.ts`

**Step 1: Create configurable LLM provider**

```typescript
// erp/src/lib/ai/provider.ts

export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: any[]
}

export interface AiToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

export interface AiResponse {
  content: string | null
  toolCalls: Array<{ id: string; name: string; arguments: string }>
  finishReason: string
}

const AI_PROVIDER = process.env.AI_PROVIDER || 'openai'
const AI_API_KEY = process.env.AI_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini'

function getBaseUrl(): string {
  switch (AI_PROVIDER) {
    case 'deepseek': return 'https://api.deepseek.com/v1'
    case 'anthropic': return 'https://api.anthropic.com/v1'
    case 'openai':
    default: return 'https://api.openai.com/v1'
  }
}

export async function chatCompletion(
  messages: AiMessage[],
  tools?: AiToolDefinition[],
): Promise<AiResponse> {
  // For anthropic, use Messages API format
  // For openai/deepseek, use Chat Completions API (compatible)

  if (AI_PROVIDER === 'anthropic') {
    return callAnthropic(messages, tools)
  }
  return callOpenAICompatible(messages, tools)
}

async function callOpenAICompatible(messages: AiMessage[], tools?: AiToolDefinition[]): Promise<AiResponse> {
  const body: any = { model: AI_MODEL, messages }
  if (tools?.length) body.tools = tools

  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  const choice = data.choices?.[0]

  return {
    content: choice?.message?.content ?? null,
    toolCalls: (choice?.message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    })),
    finishReason: choice?.finish_reason ?? 'stop',
  }
}

async function callAnthropic(messages: AiMessage[], tools?: AiToolDefinition[]): Promise<AiResponse> {
  const systemMsg = messages.find(m => m.role === 'system')
  const nonSystemMsgs = messages.filter(m => m.role !== 'system')

  const body: any = {
    model: AI_MODEL,
    max_tokens: 1024,
    system: systemMsg?.content ?? '',
    messages: nonSystemMsgs.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
  }
  if (tools?.length) {
    body.tools = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': AI_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()

  const textBlock = data.content?.find((b: any) => b.type === 'text')
  const toolBlocks = data.content?.filter((b: any) => b.type === 'tool_use') ?? []

  return {
    content: textBlock?.text ?? null,
    toolCalls: toolBlocks.map((b: any) => ({
      id: b.id,
      name: b.name,
      arguments: JSON.stringify(b.input),
    })),
    finishReason: data.stop_reason ?? 'end_turn',
  }
}
```

**Step 2: Create tool definitions**

```typescript
// erp/src/lib/ai/tools.ts

import { AiToolDefinition } from './provider'

export const AI_TOOLS: AiToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'SEARCH_DOCUMENTS',
      description: 'Search the company knowledge base for relevant information to answer the customer question',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'GET_CLIENT_INFO',
      description: 'Get client information including financial status and previous tickets',
      parameters: {
        type: 'object',
        properties: { clientId: { type: 'string' } },
        required: ['clientId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'GET_HISTORY',
      description: 'Get recent conversation history for this ticket',
      parameters: {
        type: 'object',
        properties: { ticketId: { type: 'string' }, limit: { type: 'number' } },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'RESPOND',
      description: 'Send a response message to the customer via WhatsApp',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'The message to send' } },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ESCALATE',
      description: 'Escalate to a human agent. Use when you cannot help or the customer requests a human.',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'CREATE_NOTE',
      description: 'Create an internal note on the ticket visible only to staff',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: ['note'],
      },
    },
  },
]
```

**Step 3: Commit**

```bash
git add erp/src/lib/ai/
git commit -m "feat: implement configurable AI provider and tool definitions"
```

---

### Task 11: Implement AI Agent worker

**Files:**
- Create: `erp/src/lib/ai/agent.ts`
- Create: `erp/src/lib/ai/tool-executor.ts`
- Create: `erp/src/lib/workers/ai-agent.ts`
- Modify: `erp/src/lib/queue.ts` — add ai-agent queue
- Modify: `erp/src/lib/workers/index.ts` — register ai-agent worker
- Modify: `erp/src/lib/workers/whatsapp-inbound.ts` — enqueue ai-agent job after creating message

**Step 1: Create tool executor**

```typescript
// erp/src/lib/ai/tool-executor.ts
import { prisma } from '../prisma'
import { searchDocuments } from './embeddings'
import { whatsappOutboundQueue } from '../queue'

export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  context: { ticketId: string; companyId: string; clientId: string; recipientPhone: string }
): Promise<string> {
  switch (toolName) {
    case 'SEARCH_DOCUMENTS':
      return await handleSearchDocuments(args.query, context.companyId)
    case 'GET_CLIENT_INFO':
      return await handleGetClientInfo(context.clientId)
    case 'GET_HISTORY':
      return await handleGetHistory(context.ticketId, args.limit ?? 10)
    case 'RESPOND':
      return await handleRespond(args.message, context)
    case 'ESCALATE':
      return await handleEscalate(args.reason, context)
    case 'CREATE_NOTE':
      return await handleCreateNote(args.note, context)
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}

// Each handler implements the tool logic using prisma and existing ERP services
```

**Step 2: Create agent loop**

```typescript
// erp/src/lib/ai/agent.ts
import { chatCompletion, AiMessage } from './provider'
import { AI_TOOLS } from './tools'
import { executeTool } from './tool-executor'

const MAX_ITERATIONS = parseInt(process.env.AI_MAX_ITERATIONS || '5')
const TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT || '30000')

export async function runAgent(
  systemPrompt: string,
  userMessage: string,
  context: { ticketId: string; companyId: string; clientId: string; recipientPhone: string }
): Promise<{ responded: boolean; escalated: boolean }> {
  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await chatCompletion(messages, AI_TOOLS)

    if (response.toolCalls.length === 0) {
      // No tool calls, agent is done
      return { responded: false, escalated: false }
    }

    for (const toolCall of response.toolCalls) {
      const args = JSON.parse(toolCall.arguments)
      const result = await executeTool(toolCall.name, args, context)

      messages.push({
        role: 'assistant',
        content: null as any,
        tool_calls: [{ id: toolCall.id, type: 'function', function: { name: toolCall.name, arguments: toolCall.arguments } }],
      })
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      })

      if (toolCall.name === 'RESPOND') return { responded: true, escalated: false }
      if (toolCall.name === 'ESCALATE') return { responded: false, escalated: true }
    }
  }

  return { responded: false, escalated: false }
}
```

**Step 3: Create AI agent worker**

```typescript
// erp/src/lib/workers/ai-agent.ts
import { Job } from 'bullmq'
import { prisma } from '../prisma'
import { runAgent } from '../ai/agent'

export async function processAiAgent(job: Job) {
  const { ticketId, messageId, companyId } = job.data

  // 1. Check if AI is enabled for this company and ticket
  const [aiConfig, ticket] = await Promise.all([
    prisma.aiConfig.findUnique({ where: { companyId } }),
    prisma.ticket.findUnique({ where: { id: ticketId }, include: { client: true } }),
  ])

  if (!aiConfig?.enabled || !ticket?.aiEnabled) return

  // 2. Get the incoming message
  const message = await prisma.ticketMessage.findUnique({ where: { id: messageId } })
  if (!message?.content) return

  // 3. Check escalation keywords
  const lowerContent = message.content.toLowerCase()
  const shouldEscalate = aiConfig.escalationKeywords.some(kw => lowerContent.includes(kw.toLowerCase()))
  if (shouldEscalate) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { aiEnabled: false } })
    return
  }

  // 4. Run agent
  const recipientPhone = ticket.client.telefone ?? ''
  const result = await runAgent(aiConfig.persona, message.content, {
    ticketId,
    companyId,
    clientId: ticket.clientId,
    recipientPhone,
  })

  // 5. If escalated, disable AI on ticket
  if (result.escalated) {
    await prisma.ticket.update({ where: { id: ticketId }, data: { aiEnabled: false } })
  }
}
```

**Step 4: Add queue and register worker**

In `erp/src/lib/queue.ts`, add:
```typescript
AI_AGENT: 'ai-agent',
// and
export const aiAgentQueue = new Queue(QUEUE_NAMES.AI_AGENT, { connection })
```

In `erp/src/lib/workers/index.ts`, add:
```typescript
import { processAiAgent } from './ai-agent'
const aiAgentWorker = createWorker(QUEUE_NAMES.AI_AGENT, processAiAgent)
```

**Step 5: Hook into whatsapp-inbound worker**

In `erp/src/lib/workers/whatsapp-inbound.ts`, after creating the TicketMessage (around line 455), add:

```typescript
// After creating the inbound message, enqueue AI processing
if (direction === 'INBOUND') {
  await aiAgentQueue.add('process-ai', {
    ticketId: ticket.id,
    messageId: ticketMessage.id,
    companyId: channel.companyId,
  })
}
```

**Step 6: Commit**

```bash
git add erp/src/lib/ai/ erp/src/lib/workers/ai-agent.ts erp/src/lib/queue.ts erp/src/lib/workers/index.ts erp/src/lib/workers/whatsapp-inbound.ts
git commit -m "feat: implement AI agent with tool execution and BullMQ worker"
```

---

## Phase 3: Knowledge Base (RAG)

### Task 12: Implement embeddings and vector search

**Files:**
- Create: `erp/src/lib/ai/embeddings.ts`

**Step 1: Create embedding generation and search**

```typescript
// erp/src/lib/ai/embeddings.ts

const EMBEDDING_PROVIDER = process.env.AI_EMBEDDING_PROVIDER || 'openai'
const EMBEDDING_KEY = process.env.AI_EMBEDDING_KEY || ''
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small'
const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '500')
const MAX_RESULTS = parseInt(process.env.RAG_MAX_RESULTS || '5')
const SIMILARITY_THRESHOLD = parseFloat(process.env.RAG_SIMILARITY_THRESHOLD || '0.7')

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${EMBEDDING_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  })
  const data = await res.json()
  return data.data[0].embedding
}

export function chunkText(text: string, maxTokens = CHUNK_SIZE): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []
  let current: string[] = []
  let count = 0

  for (const word of words) {
    current.push(word)
    count++
    if (count >= maxTokens) {
      chunks.push(current.join(' '))
      current = []
      count = 0
    }
  }
  if (current.length) chunks.push(current.join(' '))
  return chunks
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export async function searchDocuments(
  query: string,
  companyId: string,
): Promise<Array<{ content: string; similarity: number }>> {
  const { prisma } = await import('../prisma')
  const queryEmbedding = await generateEmbedding(query)

  const chunks = await prisma.documentChunk.findMany({
    where: { document: { companyId, status: 'READY' } },
    select: { content: true, embedding: true },
  })

  const results = chunks
    .map(chunk => ({
      content: chunk.content,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter(r => r.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, MAX_RESULTS)

  return results
}
```

**Step 2: Commit**

```bash
git add erp/src/lib/ai/embeddings.ts
git commit -m "feat: implement embedding generation and vector search for RAG"
```

---

### Task 13: Implement document processing worker

**Files:**
- Create: `erp/src/lib/workers/document-processor.ts`
- Modify: `erp/src/lib/queue.ts` — add document-processing queue
- Modify: `erp/src/lib/workers/index.ts` — register worker

**Step 1: Create document processor**

```typescript
// erp/src/lib/workers/document-processor.ts
import { Job } from 'bullmq'
import * as fs from 'fs'
import { prisma } from '../prisma'
import { generateEmbedding, chunkText } from '../ai/embeddings'

export async function processDocument(job: Job) {
  const { documentId } = job.data

  const doc = await prisma.document.findUnique({ where: { id: documentId } })
  if (!doc) return

  try {
    // 1. Read file content
    const filePath = `uploads/${doc.companyId}/${doc.name}`
    let text = ''

    if (doc.mimeType === 'text/plain') {
      text = fs.readFileSync(filePath, 'utf-8')
    } else if (doc.mimeType === 'application/pdf') {
      // PDF extraction - use pdf-parse or similar
      const pdfParse = require('pdf-parse')
      const buffer = fs.readFileSync(filePath)
      const data = await pdfParse(buffer)
      text = data.text
    } else {
      // For other types, try reading as text
      text = fs.readFileSync(filePath, 'utf-8')
    }

    // 2. Chunk text
    const chunks = chunkText(text)

    // 3. Generate embeddings and save chunks
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i])
      await prisma.documentChunk.create({
        data: {
          documentId,
          content: chunks[i],
          embedding,
          chunkIndex: i,
        },
      })
    }

    // 4. Mark as ready
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY' },
    })
  } catch (error) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'ERROR' },
    })
    throw error
  }
}
```

**Step 2: Register queue and worker** (same pattern as Task 11 Step 4)

Add `DOCUMENT_PROCESSING: 'document-processing'` to queue.ts and register worker in index.ts.

**Step 3: Commit**

```bash
git add erp/src/lib/workers/document-processor.ts erp/src/lib/queue.ts erp/src/lib/workers/index.ts
git commit -m "feat: implement document processing worker for RAG embeddings"
```

---

### Task 14: Knowledge Base API and UI

**Files:**
- Create: `erp/src/app/api/documents/route.ts` — upload/list documents
- Create: `erp/src/app/(app)/configuracoes/knowledge-base/page.tsx` — KB management UI
- Modify: `erp/src/components/sidebar.tsx` — add KB link

**Step 1: Create API route for document upload/list**

```typescript
// erp/src/app/api/documents/route.ts
// GET: list documents for company
// POST: upload document, save file, enqueue processing
```

**Step 2: Create Knowledge Base page**

Simple page with:
- File upload (drag & drop or click)
- Table of documents: name, status (PROCESSING/READY/ERROR), size, date, delete button
- Uses existing ERP UI components (Button, Table, Badge)

**Step 3: Add sidebar link**

Add under Configurações section:
```tsx
{ name: 'Knowledge Base', href: '/configuracoes/knowledge-base', icon: BookOpen }
```

**Step 4: Commit**

```bash
git add erp/src/app/api/documents/ erp/src/app/(app)/configuracoes/knowledge-base/ erp/src/components/sidebar.tsx
git commit -m "feat: add Knowledge Base management UI and document upload API"
```

---

## Phase 4: SAC UI Updates

### Task 15: AI toggle and badge in ticket timeline

**Files:**
- Modify: `erp/src/app/(app)/sac/tickets/[id]/ticket-timeline.tsx`
- Modify: `erp/src/app/(app)/sac/tickets/actions.ts`

**Step 1: Add toggle AI action**

In `actions.ts`, add:
```typescript
export async function toggleTicketAi(ticketId: string, companyId: string, enabled: boolean) {
  await prisma.ticket.update({ where: { id: ticketId }, data: { aiEnabled: enabled } })
  revalidatePath(`/sac/tickets/${ticketId}`)
}
```

**Step 2: Add AI toggle to timeline header**

In `ticket-timeline.tsx`, add a toggle switch next to the ticket info:
```tsx
<Switch checked={ticket.aiEnabled} onCheckedChange={(v) => toggleTicketAi(ticket.id, companyId, v)} />
<span>AI</span>
```

**Step 3: Add AI badge on AI-generated messages**

In the message rendering, check `message.isAiGenerated`:
```tsx
{message.isAiGenerated && <Badge variant="outline">AI</Badge>}
```

**Step 4: Commit**

```bash
git add erp/src/app/(app)/sac/tickets/
git commit -m "feat: add AI toggle and AI badge in ticket timeline"
```

---

### Task 16: AI Configuration page

**Files:**
- Create: `erp/src/app/(app)/configuracoes/ai/page.tsx`
- Create: `erp/src/app/(app)/configuracoes/ai/actions.ts`
- Modify: `erp/src/components/sidebar.tsx`

**Step 1: Create AI config actions**

```typescript
// actions.ts
export async function getAiConfig(companyId: string)
export async function updateAiConfig(companyId: string, data: { enabled, persona, welcomeMessage, escalationKeywords, maxIterations })
```

**Step 2: Create AI config page**

Form with:
- Toggle: AI enabled/disabled
- Textarea: Persona (system prompt)
- Textarea: Welcome message
- Tags input: Escalation keywords
- Number input: Max iterations

**Step 3: Add sidebar link**

```tsx
{ name: 'Agente IA', href: '/configuracoes/ai', icon: Bot }
```

**Step 4: Commit**

```bash
git add erp/src/app/(app)/configuracoes/ai/ erp/src/components/sidebar.tsx
git commit -m "feat: add AI agent configuration page"
```

---

### Task 17: Update .env.example and package.json

**Files:**
- Modify: `erp/.env.example`
- Modify: `erp/package.json` (add pdf-parse if needed)

**Step 1: Update .env.example with all new variables**

```env
# WhatsApp Service (replaces Evolution API)
WHATSAPP_SERVICE_URL="http://localhost:3001"
WHATSAPP_SERVICE_API_KEY="whatsapp-service-key-change-in-production"
WHATSAPP_WEBHOOK_SECRET="whatsapp-webhook-secret-change-in-production"

# AI Agent (configurable provider)
AI_PROVIDER="deepseek"
AI_API_KEY="sk-..."
AI_MODEL="deepseek-chat"
AI_MAX_ITERATIONS=5
AI_TIMEOUT=30000

# AI Embeddings (for RAG)
AI_EMBEDDING_PROVIDER="openai"
AI_EMBEDDING_KEY="sk-..."
AI_EMBEDDING_MODEL="text-embedding-3-small"
RAG_CHUNK_SIZE=500
RAG_MAX_RESULTS=5
RAG_SIMILARITY_THRESHOLD=0.7
```

**Step 2: Add pdf-parse dependency**

```bash
cd erp && npm install pdf-parse
```

**Step 3: Commit**

```bash
git add erp/.env.example erp/package.json erp/package-lock.json
git commit -m "chore: update env example and add pdf-parse dependency"
```

---

### Task 18: Integration test — end to end

**Step 1: Start services**

```bash
# Terminal 1: PostgreSQL + Redis (Docker)
docker run -d --name erp-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=erp_mendes -p 5432:5432 postgres:16
docker start redis

# Terminal 2: WhatsApp Service
cd whatsapp-service && npm run dev

# Terminal 3: ERP
cd erp && npm run dev

# Terminal 4: Workers
cd erp && npm run workers
```

**Step 2: Test WhatsApp connection**

1. Open http://localhost:3000/configuracoes/canais
2. Create WhatsApp channel pointing to localhost:3001
3. Connect via QR code or pairing code
4. Verify QR code appears and connection succeeds

**Step 3: Test message flow**

1. Send a WhatsApp message to the connected number
2. Verify ticket is created in SAC
3. Verify AI agent responds (if enabled)
4. Reply from timeline and verify message is delivered

**Step 4: Test Knowledge Base**

1. Upload a document in Configurações > Knowledge Base
2. Wait for status to change to READY
3. Send a WhatsApp message related to the document content
4. Verify AI agent uses document info in response

**Step 5: Commit final**

```bash
git add -A
git commit -m "feat: complete WhatsApp Baileys + AI Agent integration"
```
