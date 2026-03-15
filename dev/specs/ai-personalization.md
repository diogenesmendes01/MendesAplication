# Feature Spec: Personalização da IA — Resposta Automática

> **Autor:** Vex ⚡ | **Data:** 2026-03-15  
> **Status:** Draft — aguardando aprovação do Mendes

---

## 1. Contexto

O ERP já possui um sistema de agente IA funcional (`src/lib/ai/`) que:
- Suporta OpenAI, DeepSeek e Anthropic como providers
- Usa RAG com embeddings para buscar documentos
- Tem agent loop com tools (SEARCH_DOCUMENTS, RESPOND, ESCALATE, etc.)
- Funciona apenas para WhatsApp inbound (via BullMQ → ai-agent worker)
- **Não** funciona para Email
- Provider/modelo são definidos via variáveis de ambiente globais (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`)
- Não há tracking de uso/custo
- Não há limite de gasto
- Não há suporte a múltiplos providers por empresa
- Frontend de configuração é básico (persona, welcome message, keywords, max iterations)

### O que muda

Cada empresa poderá:
1. Configurar **seu próprio provider e API key** (não depende de env global)
2. Escolher modelo específico do provider selecionado
3. Definir limite de gasto diário
4. Ter respostas IA tanto por **WhatsApp** quanto por **Email** (configurações separadas)
5. Simular respostas antes de ativar
6. Ver consumo acumulado

---

## 2. Providers Suportados

| Provider | Base URL | Auth Header | Modelos (exemplos) |
|----------|---------|-------------|-------------------|
| **OpenAI** | `https://api.openai.com` | `Authorization: Bearer <key>` | gpt-4o, gpt-4o-mini, gpt-3.5-turbo |
| **Anthropic** | `https://api.anthropic.com` | `x-api-key: <key>` | claude-sonnet-4-20250514, claude-haiku-4-20250414, claude-opus-4-20250514 |
| **Grok (xAI)** | `https://api.x.ai` | `Authorization: Bearer <key>` | grok-2, grok-2-mini |
| **Qwen (Alibaba)** | `https://dashscope.aliyuncs.com/compatible-mode` | `Authorization: Bearer <key>` | qwen-max, qwen-plus, qwen-turbo |

> Grok e Qwen usam formato OpenAI-compatible (`/v1/chat/completions`), então entram no mesmo path do código existente.

---

## 3. Schema — Mudanças no Prisma

### 3.1 Alterar `AiConfig` (tabela existente)

```prisma
model AiConfig {
  id                 String   @id @default(cuid())
  companyId          String   @unique
  
  // --- Existentes ---
  enabled            Boolean  @default(false)
  persona            String   @db.Text
  welcomeMessage     String?  @db.Text
  escalationKeywords String[]
  maxIterations      Int      @default(5)
  
  // --- NOVOS: Provider ---
  provider           String   @default("openai")     // openai | anthropic | grok | qwen
  apiKey             String?  @db.Text               // encrypted — API key do cliente
  model              String?                          // modelo escolhido (ex: "gpt-4o")
  
  // --- NOVOS: Canais ---
  whatsappEnabled    Boolean  @default(true)          // IA ativa para WhatsApp
  emailEnabled       Boolean  @default(false)         // IA ativa para Email
  emailPersona       String?  @db.Text               // persona separada para email (se null, usa `persona`)
  emailSignature     String?  @db.Text               // assinatura do email IA
  
  // --- NOVOS: Limites ---
  dailySpendLimitBrl Decimal? @db.Decimal(10, 2)     // limite diário em R$ (null = sem limite)
  
  // --- NOVOS: Temperatura ---
  temperature        Float    @default(0.7)
  
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  company    Company          @relation(fields: [companyId], references: [id], onDelete: Cascade)
  usageLogs  AiUsageLog[]

  @@map("ai_config")
}
```

### 3.2 Nova tabela: `AiUsageLog` (tracking de consumo)

```prisma
model AiUsageLog {
  id            String   @id @default(cuid())
  aiConfigId    String
  companyId     String
  
  provider      String                               // openai | anthropic | grok | qwen
  model         String                               // modelo usado
  channel       String                               // WHATSAPP | EMAIL
  
  inputTokens   Int
  outputTokens  Int
  costUsd       Decimal  @db.Decimal(10, 6)          // custo estimado em USD
  costBrl       Decimal  @db.Decimal(10, 4)          // custo estimado em BRL
  
  ticketId      String?
  
  createdAt     DateTime @default(now())
  
  aiConfig      AiConfig @relation(fields: [aiConfigId], references: [id], onDelete: Cascade)
  
  @@index([companyId, createdAt])
  @@index([aiConfigId, createdAt])
  @@map("ai_usage_logs")
}
```

---

## 4. Backend — Mudanças

### 4.1 `src/lib/ai/provider.ts` — Multi-provider

**Atual:** usa `process.env.AI_PROVIDER` e `process.env.AI_API_KEY` globais.

**Novo:** receber config como parâmetro.

```typescript
interface ProviderConfig {
  provider: string;    // openai | anthropic | grok | qwen
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// Novos base URLs
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com",
  deepseek: "https://api.deepseek.com",
  grok: "https://api.x.ai",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode",
  anthropic: "https://api.anthropic.com",
};

export async function chatCompletion(
  messages: AiMessage[],
  tools?: AiToolDefinition[],
  config: ProviderConfig,   // <-- novo parâmetro obrigatório
): Promise<AiResponse & { usage?: { inputTokens: number; outputTokens: number } }> {
  // Grok e Qwen usam formato OpenAI-compatible
  if (["openai", "deepseek", "grok", "qwen"].includes(config.provider)) {
    return openaiCompatibleCompletion(config, messages, tools);
  }
  if (config.provider === "anthropic") {
    return anthropicCompletion(config, messages, tools);
  }
  throw new Error(`Provider não suportado: ${config.provider}`);
}
```

**Importante:** Retornar `usage` (inputTokens, outputTokens) de cada chamada para tracking.

### 4.2 `src/lib/ai/agent.ts` — Carregar config da empresa

```typescript
export async function runAgent(
  ticketId: string,
  companyId: string,
  incomingMessage: string,
  channel: "WHATSAPP" | "EMAIL"   // <-- novo parâmetro
): Promise<AgentResult> {
  const aiConfig = await prisma.aiConfig.findUnique({ where: { companyId } });
  
  if (!aiConfig?.enabled) return { responded: false, ... };
  
  // Checar se canal está habilitado
  if (channel === "WHATSAPP" && !aiConfig.whatsappEnabled) return { ... };
  if (channel === "EMAIL" && !aiConfig.emailEnabled) return { ... };
  
  // Checar limite diário
  if (aiConfig.dailySpendLimitBrl) {
    const todaySpend = await getTodaySpend(companyId);
    if (todaySpend >= aiConfig.dailySpendLimitBrl) {
      return { responded: false, error: "daily_spend_limit_reached" };
    }
  }
  
  // Descriptografar API key
  const apiKey = decrypt(aiConfig.apiKey);
  
  // Montar config do provider
  const providerConfig: ProviderConfig = {
    provider: aiConfig.provider,
    apiKey,
    model: aiConfig.model || undefined,
    temperature: aiConfig.temperature,
  };
  
  // Escolher persona correta
  const persona = (channel === "EMAIL" && aiConfig.emailPersona)
    ? aiConfig.emailPersona
    : aiConfig.persona;
  
  // System prompt diferente por canal
  const systemPrompt = channel === "EMAIL"
    ? buildEmailSystemPrompt(persona, clientName, historyContext, aiConfig.emailSignature)
    : buildWhatsAppSystemPrompt(persona, clientName, historyContext);
  
  // ... rest of agent loop, passando providerConfig para chatCompletion
}
```

### 4.3 `src/lib/ai/cost-tracker.ts` — Novo arquivo

```typescript
// Tabela de preços por modelo (USD por 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-haiku-4-20250414": { input: 0.80, output: 4.00 },
  "claude-opus-4-20250514": { input: 15.00, output: 75.00 },
  "grok-2": { input: 2.00, output: 10.00 },
  "grok-2-mini": { input: 0.30, output: 0.50 },
  "qwen-max": { input: 1.60, output: 6.40 },
  "qwen-plus": { input: 0.50, output: 1.50 },
  "qwen-turbo": { input: 0.15, output: 0.30 },
};

const BRL_USD_RATE = 5.80; // Atualizar periodicamente ou usar API

export async function logUsage(params: {
  aiConfigId: string;
  companyId: string;
  provider: string;
  model: string;
  channel: "WHATSAPP" | "EMAIL";
  inputTokens: number;
  outputTokens: number;
  ticketId?: string;
}) {
  const pricing = MODEL_PRICING[params.model] || { input: 1.0, output: 3.0 };
  const costUsd = (params.inputTokens * pricing.input + params.outputTokens * pricing.output) / 1_000_000;
  const costBrl = costUsd * BRL_USD_RATE;
  
  await prisma.aiUsageLog.create({ data: { ...params, costUsd, costBrl } });
}

export async function getTodaySpend(companyId: string): Promise<number> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const result = await prisma.aiUsageLog.aggregate({
    where: { companyId, createdAt: { gte: startOfDay } },
    _sum: { costBrl: true },
  });
  
  return Number(result._sum.costBrl || 0);
}
```

### 4.4 `src/lib/ai/model-suggester.ts` — Novo arquivo

Sugere modelo baseado no orçamento diário:

```typescript
export function suggestModel(provider: string, dailyBudgetBrl: number): string {
  // Estimativa: ~100 conversas/dia, ~2000 tokens/conversa (in+out)
  const estimatedDailyTokens = 200_000; // 200K tokens
  
  const suggestions: Record<string, Array<{ model: string; maxDailyBrl: number }>> = {
    openai: [
      { model: "gpt-4o", maxDailyBrl: 50 },
      { model: "gpt-4o-mini", maxDailyBrl: 5 },
    ],
    anthropic: [
      { model: "claude-opus-4-20250514", maxDailyBrl: 500 },
      { model: "claude-sonnet-4-20250514", maxDailyBrl: 50 },
      { model: "claude-haiku-4-20250414", maxDailyBrl: 10 },
    ],
    grok: [
      { model: "grok-2", maxDailyBrl: 50 },
      { model: "grok-2-mini", maxDailyBrl: 5 },
    ],
    qwen: [
      { model: "qwen-max", maxDailyBrl: 30 },
      { model: "qwen-plus", maxDailyBrl: 10 },
      { model: "qwen-turbo", maxDailyBrl: 3 },
    ],
  };
  
  const options = suggestions[provider] || [];
  // Retorna o modelo mais potente que cabe no orçamento
  for (const opt of options) {
    if (dailyBudgetBrl >= opt.maxDailyBrl) return opt.model;
  }
  return options[options.length - 1]?.model || "gpt-4o-mini";
}
```

### 4.5 Email Inbound → AI Agent

**Atual:** `email-inbound.ts` NÃO enfileira job de IA (só o WhatsApp faz isso).

**Novo:** Adicionar enfileiramento no final de `processEmail()`:

```typescript
// Após criar o ticketMessage (email-inbound.ts)
if (direction === "INBOUND" && textContent) {
  await aiAgentQueue.add("process-message", {
    ticketId,
    companyId,
    messageContent: textContent,
    channel: "EMAIL",  // <-- novo campo
  });
}
```

### 4.6 AI Agent Worker — Suportar Email

**Atual:** `ai-agent.ts` worker só trata WhatsApp.

**Novo:** Passar `channel` para `runAgent()` e adaptar a tool `RESPOND` para enviar por email quando `channel === "EMAIL"`.

Nova tool `RESPOND_EMAIL`:
```typescript
export const RESPOND_EMAIL: AiToolDefinition = {
  name: "RESPOND_EMAIL",
  description: "Envia resposta ao cliente por email. Use quando o canal for email.",
  parameters: {
    type: "object",
    properties: {
      subject: { type: "string", description: "Assunto do email" },
      message: { type: "string", description: "Corpo do email (pode usar HTML simples)" },
    },
    required: ["subject", "message"],
  },
};
```

O `tool-executor.ts` precisa de um novo case `RESPOND_EMAIL` que enfileira no `emailOutboundQueue`.

### 4.7 Encriptação da API Key

A API key do cliente **DEVE** ser armazenada encriptada. Usar o mesmo padrão de `src/lib/encryption.ts` que já existe para config de canais de email.

---

## 5. Frontend — Mudanças

### 5.1 Tela de Configuração (`/configuracoes/ai`)

Reorganizar em **tabs**:

#### Tab 1: Geral
- Toggle habilitado/desabilitado (existente)
- **Provider** — Select: OpenAI, Anthropic, Grok, Qwen
- **API Key** — Input password (com botão de "testar conexão")
- **Modelo** — Select dinâmico (carrega modelos do provider selecionado)
- **Temperatura** — Slider 0.0 → 1.0
- **Limite de gasto diário (R$)** — Input numérico
- **Sugestão de modelo** — Badge mostrando: "Com R$X/dia, recomendamos o modelo Y"

#### Tab 2: WhatsApp
- Toggle WhatsApp habilitado
- Persona (textarea) — existente, renomear para "Persona WhatsApp"
- Mensagem de boas-vindas (existente)
- Palavras-chave de escalação (existente)
- Max iterações (existente)

#### Tab 3: Email
- Toggle Email habilitado
- Persona Email (textarea) — se vazio, herda do WhatsApp
- Assinatura do email IA
- Palavras-chave de escalação email (pode ser diferente do WhatsApp)

#### Tab 4: Base de Conhecimento
- Link para `/configuracoes/knowledge-base` (já existe)
- Mostrar quantidade de documentos e chunks

#### Tab 5: Consumo
- Gráfico de uso diário (tokens e R$) — últimos 30 dias
- Breakdown por canal (WhatsApp vs Email)
- Breakdown por modelo
- Gasto acumulado hoje vs limite

#### Tab 6: Simulador (novo — destaque)
- Área de chat fake onde o cliente (admin) digita como se fosse um cliente
- Mostra a resposta que a IA daria com as configurações atuais
- Usa a mesma engine (`runAgent`) mas com flag `dryRun: true` (não salva no banco, não envia mensagem real)
- Toggle para simular WhatsApp ou Email
- Mostra tokens usados e custo estimado da simulação

### 5.2 Tela de Validação de API Key

Ao inserir a API key, botão "Testar Conexão" que:
1. Faz uma chamada mínima ao provider (ex: enviar "Hi" com max_tokens=5)
2. Se sucesso → badge verde "Conectado"
3. Se erro → mostra mensagem de erro
4. Para OpenAI: tenta chamar `/v1/models` para listar modelos disponíveis

---

## 6. API Routes — Novas/Modificadas

### 6.1 `GET /api/ai/models?provider=openai`
Retorna lista de modelos disponíveis para o provider.
- OpenAI: chama `/v1/models` com a API key da empresa
- Anthropic/Grok/Qwen: retorna lista hardcoded (não tem endpoint de listagem)

### 6.2 `POST /api/ai/test-connection`
Body: `{ provider, apiKey, model? }`
Testa a conexão fazendo uma chamada mínima.

### 6.3 `POST /api/ai/simulate`
Body: `{ message, channel: "WHATSAPP" | "EMAIL" }`
Roda o agente em modo dry-run e retorna a resposta + tokens + custo.

### 6.4 `GET /api/ai/usage?period=30d`
Retorna dados de consumo agregados para o frontend.

---

## 7. Segurança

- **API Key encriptada** no banco (AES-256-GCM, mesma chave de encryption dos canais)
- **API Key nunca retornada** ao frontend — só os últimos 4 caracteres mascarados
- **Rate limit** nas chamadas de simulação (máx 10/min por empresa)
- **Limite diário de gasto** é verificado ANTES de cada chamada ao LLM
- **Audit log** em toda alteração de config

---

## 8. Fluxo de Dados — Resumo

```
[WhatsApp msg] → whatsapp-inbound worker → aiAgentQueue (channel: WHATSAPP)
                                                ↓
[Email msg]    → email-inbound worker    → aiAgentQueue (channel: EMAIL)
                                                ↓
                                         ai-agent worker
                                                ↓
                                    Carrega AiConfig da empresa
                                    (provider, apiKey, model, persona)
                                                ↓
                                    Verifica limite diário → OK?
                                                ↓
                                    runAgent(channel) com ProviderConfig
                                                ↓
                               ┌─── WHATSAPP ───┐─── EMAIL ───────┐
                               │ RESPOND tool    │ RESPOND_EMAIL   │
                               │ → sendTextMsg   │ → emailOutbound │
                               │ (whatsapp-api)  │ (nodemailer)    │
                               └────────────────-┘─────────────────┘
                                                ↓
                                    logUsage() → ai_usage_logs
```

---

## 9. Stories (ordem de implementação)

| # | Story | Estimativa | Prioridade |
|---|-------|-----------|-----------|
| 1 | Migration Prisma: AiConfig novos campos + AiUsageLog | P |🔴 Alta |
| 2 | Backend: refatorar `provider.ts` para receber config como param (+ adicionar Grok e Qwen) | M | 🔴 Alta |
| 3 | Backend: `cost-tracker.ts` + `model-suggester.ts` | P | 🔴 Alta |
| 4 | Backend: adaptar `agent.ts` para multi-canal + provider config da empresa | M | 🔴 Alta |
| 5 | Backend: nova tool RESPOND_EMAIL + email outbound no agent | M | 🔴 Alta |
| 6 | Backend: enfileirar email inbound no ai-agent queue | P | 🔴 Alta |
| 7 | Backend: encriptação da API key (usar encryption.ts existente) | P | 🟡 Média |
| 8 | API: `/api/ai/test-connection` + `/api/ai/models` | M | 🟡 Média |
| 9 | API: `/api/ai/simulate` (dry-run) + `/api/ai/usage` | M | 🟡 Média |
| 10 | Frontend: refatorar `/configuracoes/ai` com tabs (Geral + WhatsApp + Email) | G | 🟡 Média |
| 11 | Frontend: tab Consumo (gráficos de uso) | M | 🟢 Baixa |
| 12 | Frontend: tab Simulador (chat fake + dry-run) | G | 🟢 Baixa |

**Legenda:** P = pequena (~2h), M = média (~4h), G = grande (~8h)

---

## 10. O que NÃO muda

- WhatsApp Service (`whatsapp-service/`) — zero mudanças, é apenas transporte
- Baileys provider — sem alteração
- Worker de WhatsApp outbound — sem alteração (a tool RESPOND já usa `sendTextMessage`)
- RAG/Embeddings — sem alteração (o embedding provider pode continuar sendo OpenAI mesmo que o chat use Anthropic)
- Knowledge Base — sem alteração

---

## 11. Riscos e Decisões Pendentes

1. **Cotação USD/BRL** — hardcodar 5.80 ou usar API? → Sugestão: começar hardcoded, depois adicionar API de câmbio
2. **Preços dos modelos mudam** — manter tabela manual ou scraper? → Sugestão: tabela manual, atualizar quando necessário
3. **Saldo da conta via API** — OpenAI tem, Anthropic não tem, outros parcialmente → Sugestão: usar tracking interno (mais confiável)
4. **Embedding provider separado** — e se o cliente usa Anthropic mas embeddings precisa de OpenAI? → Sugestão: manter `AI_EMBEDDING_*` como env separado do ERP (não do cliente)

---

*Spec gerada por Vex ⚡ — 15/03/2026*
