# Design: WhatsApp Baileys Direto + AI Agent no SAC

**Data:** 2026-03-03
**Status:** Aprovado
**Origem:** Extração do projeto JáRespondi v2 + integração no ERP Mendes

---

## Contexto

O ERP já possui um módulo SAC completo com integração WhatsApp via Evolution API (webhook inbound, queue outbound, timeline multi-canal, SLA). Porém a Evolution API apresenta instabilidade na geração de QR Code/Pairing Code com Baileys.

O projeto JáRespondi v2 (github.com/diogenesmendes01/jarespondiv2) possui uma implementação robusta de Baileys com sessões no banco, reconexão automática e AI Agent com RAG.

**Decisão:** Substituir Evolution API por microserviço próprio com Baileys extraído do JáRespondi, e adicionar AI Agent com knowledge base ao SAC.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                    ERP (Next.js :3000)               │
│                                                      │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ SAC UI   │  │ AI Agent  │  │ Knowledge Base   │  │
│  │ Timeline │  │ (BullMQ)  │  │ (RAG/Embeddings) │  │
│  └────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│       │              │                  │            │
│  ┌────┴──────────────┴──────────────────┴─────────┐  │
│  │        API Routes + Server Actions              │  │
│  │  POST /api/webhooks/whatsapp  (inbound)         │  │
│  │  sendWhatsAppMessage()        (outbound)        │  │
│  └──────────────────┬─────────────────────────────┘  │
└─────────────────────┼────────────────────────────────┘
                      │ HTTP localhost (~1-5ms)
┌─────────────────────┼────────────────────────────────┐
│     WhatsApp Service (Express :3001)                  │
│                     │                                 │
│  ┌──────────────────┴──────────────────────────────┐  │
│  │  BaileysProvider (extraído do JáRespondi)       │  │
│  │  - Conexão WebSocket com WhatsApp               │  │
│  │  - QR Code / Pairing Code                       │  │
│  │  - Envio/recebimento de mensagens               │  │
│  │  - Download de mídia                            │  │
│  └──────────────────┬──────────────────────────────┘  │
│                     │                                 │
│  ┌──────────────────┴──────────────────────────────┐  │
│  │  Auth State (Prisma → PostgreSQL)               │  │
│  │  - Sessões Baileys no mesmo banco do ERP        │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘
                      │
                      ▼ WebSocket
              WhatsApp Servers
```

**Abordagem escolhida:** Microserviço separado (Abordagem 1)
- Isolamento: se Baileys crashar, ERP continua
- Mesmo padrão de webhook que já existe (mínima mudança no ERP)
- Latência localhost desprezível (~1-5ms vs ~1-3s da IA)

---

## Componente 1: WhatsApp Service (Microserviço)

### Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/instance/connect` | Cria sessão e gera QR Code |
| POST | `/instance/connect-pairing` | Conexão via pairing code |
| GET | `/instance/:id/qr` | Retorna QR code base64 |
| GET | `/instance/:id/pairing-code` | Retorna código de pareamento |
| POST | `/instance/:id/disconnect` | Desconecta sessão |
| GET | `/instance/:id/status` | Status da conexão |
| POST | `/message/send-text` | Envia mensagem de texto |
| POST | `/message/send-media` | Envia mídia |

### Fluxo de mensagem recebida

1. WhatsApp → Baileys (WebSocket)
2. BaileysProvider processa o evento
3. POST para `http://localhost:3000/api/webhooks/whatsapp` (ERP)
4. ERP cria/atualiza ticket normalmente

### Código extraído do JáRespondi

| Arquivo | Linhas | Adaptação |
|---------|--------|-----------|
| `baileys.provider.ts` | ~1900 | Supabase → Prisma |
| `baileys-webhook-adapter.ts` | ~380 | Formato webhook ajustado |
| `useDatabaseAuthState.ts` | ~380 | Supabase → Prisma |

### Configuração (.env)

```env
WHATSAPP_SERVICE_PORT=3001
WHATSAPP_WEBHOOK_URL=http://localhost:3000/api/webhooks/whatsapp
WHATSAPP_WEBHOOK_SECRET=sua-chave-secreta
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/erp_mendes
```

---

## Componente 2: AI Agent

### Fluxo

```
Mensagem WhatsApp chega (webhook)
  → Cria/vincula ticket (já existe)
  → AI está ativo nesse ticket?
    → SIM: Enfileira job "ai-process" (BullMQ)
      → Worker busca: histórico + dados cliente + knowledge base (RAG)
      → Chama LLM com contexto + ferramentas
      → LLM decide: responder ou escalar
        → Responder: envia mensagem via WhatsApp Service
        → Escalar: marca ticket como "aguardando atendente"
    → NÃO: Segue fluxo normal (atendente humano)
```

### Ferramentas do agente

| Tool | Descrição |
|------|-----------|
| `SEARCH_DOCUMENTS` | Busca na knowledge base (RAG) |
| `GET_CLIENT_INFO` | Dados do cliente, financeiro, tickets anteriores |
| `GET_HISTORY` | Histórico recente da conversa |
| `RESPOND` | Envia resposta ao cliente |
| `ESCALATE` | Escala para atendente humano |
| `CREATE_NOTE` | Cria nota interna no ticket |

### Controles

- Atendente pode desativar AI em qualquer ticket (toggle na timeline)
- AI desativa automaticamente ao escalar
- Atendente pode reativar AI a qualquer momento

### Configuração (.env) - Sem hardcode de provedor

```env
AI_PROVIDER=deepseek
AI_API_KEY=sk-...
AI_MODEL=deepseek-chat
AI_EMBEDDING_PROVIDER=openai
AI_EMBEDDING_KEY=sk-...
AI_EMBEDDING_MODEL=text-embedding-3-small
AI_MAX_ITERATIONS=5
AI_TIMEOUT=30000
```

Provedores suportados: `deepseek`, `openai`, `anthropic`

---

## Componente 3: Knowledge Base (RAG)

### Fluxo

```
Upload de documento (PDF, TXT, DOCX)
  → Extrai texto
  → Divide em chunks (~500 tokens cada)
  → Gera embeddings via API (text-embedding-3-small)
  → Salva no PostgreSQL (vetor + texto original)

Quando AI precisa responder:
  → Gera embedding da pergunta do cliente
  → Busca chunks mais similares (cosine similarity)
  → Injeta top 3-5 resultados no prompt do LLM
```

### UI

- Página em Configurações > Knowledge Base
- Upload de arquivos (arrastar ou selecionar)
- Lista de documentos com status (PROCESSING/READY/ERROR)
- Deletar documento (remove chunks junto)

### Configuração (.env)

```env
RAG_CHUNK_SIZE=500
RAG_MAX_RESULTS=5
RAG_SIMILARITY_THRESHOLD=0.7
```

---

## Modelos de dados (novas tabelas)

### WhatsApp Service

```prisma
model BaileysAuthState {
  id        String   @id @default(cuid())
  companyId String
  keyType   String   // 'creds', 'pre-key', 'session', etc
  keyId     String
  keyData   Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  company   Company  @relation(fields: [companyId], references: [id])

  @@unique([companyId, keyType, keyId])
  @@map("baileys_auth_state")
}

model LidMapping {
  id          String   @id @default(cuid())
  companyId   String
  lid         String
  phoneNumber String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  company     Company  @relation(fields: [companyId], references: [id])

  @@unique([companyId, lid])
  @@map("lid_mappings")
}
```

### AI Agent

```prisma
model AiConfig {
  id                  String   @id @default(cuid())
  companyId           String   @unique
  enabled             Boolean  @default(false)
  persona             String   @db.Text  // Prompt do sistema
  welcomeMessage      String?  @db.Text
  escalationKeywords  String[] // Palavras que escalam imediatamente
  maxIterations       Int      @default(5)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  company             Company  @relation(fields: [companyId], references: [id])

  @@map("ai_config")
}
```

### Knowledge Base

```prisma
model Document {
  id        String         @id @default(cuid())
  companyId String
  name      String
  mimeType  String
  fileSize  Int
  status    DocumentStatus @default(PROCESSING)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  company   Company         @relation(fields: [companyId], references: [id])
  chunks    DocumentChunk[]

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

  @@map("document_chunks")
}

enum DocumentStatus {
  PROCESSING
  READY
  ERROR
}
```

### Alterações em tabelas existentes

| Tabela | Campo novo | Propósito |
|--------|------------|-----------|
| `Ticket` | `aiEnabled` (Boolean, default true) | Toggle AI por ticket |
| `TicketMessage` | `isAiGenerated` (Boolean, default false) | Identificar mensagens do AI |

---

## O que muda no ERP existente

### Mudanças mínimas

- **Webhook handler:** Trocar formato Evolution API para formato do nosso WhatsApp Service
- **Outbound worker:** Trocar chamadas HTTP da Evolution API para nosso WhatsApp Service
- **Timeline UI:** Adicionar toggle AI por ticket, badge "AI" em mensagens geradas
- **Sidebar:** Link para Configurações > Knowledge Base

### O que NÃO muda

- Ticket, Client, AdditionalContact, Attachment, SLA — intactos
- Email integration — intacta
- Fluxo de filas BullMQ — mesma arquitetura
- Upload de arquivos — mesma rota

---

## Docker Compose

Novo serviço adicionado:

```yaml
whatsapp-service:
  build: ./whatsapp-service
  container_name: whatsapp-service
  ports:
    - "3001:3001"
  environment:
    - DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/erp_mendes
    - WHATSAPP_WEBHOOK_URL=http://host.docker.internal:3000/api/webhooks/whatsapp
    - WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET}
  restart: unless-stopped
```

Evolution API pode ser removida do docker-compose.

---

## Reaproveitamento

### Do JáRespondi v2
- BaileysProvider (~1900 linhas) → adaptado para Prisma
- WebhookAdapter (~380 linhas) → adaptado para nosso formato
- useDatabaseAuthState (~380 linhas) → reescrito para Prisma
- Lógica do AI Agent (loop, tools, personas) → simplificado

### Do ERP existente
- Todo o SAC (tickets, timeline, SLA, filas BullMQ)
- Webhook handler inbound/outbound (muda só URL destino)
- Upload de arquivos (rota já existe)
