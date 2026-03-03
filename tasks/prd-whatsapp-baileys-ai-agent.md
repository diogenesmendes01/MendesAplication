# PRD: WhatsApp Baileys + AI Agent no SAC

## Introduction

Substituir a Evolution API por um microserviço próprio baseado em Baileys para conexão WhatsApp, e adicionar um AI Agent com RAG (Retrieval-Augmented Generation) ao módulo SAC do ERP. A Evolution API apresenta instabilidade na geração de QR Code/Pairing Code, e o projeto JáRespondi v2 já possui uma implementação robusta de Baileys que será adaptada. O AI Agent permitirá atendimento automático via WhatsApp com base em uma knowledge base configurável.

## Goals

- Eliminar dependência da Evolution API, substituindo por microserviço próprio com Baileys
- Manter compatibilidade total com o fluxo SAC existente (tickets, timeline, SLA, filas BullMQ)
- Adicionar AI Agent configurável por empresa com suporte a múltiplos provedores LLM (DeepSeek, OpenAI, Anthropic)
- Implementar Knowledge Base com RAG para respostas contextualizadas
- Permitir controle granular do AI (toggle por ticket, escalação automática, palavras-chave de escalação)
- Garantir isolamento: se o serviço WhatsApp crashar, o ERP continua funcionando

## User Stories

### US-001: Scaffold do projeto WhatsApp Service
**Description:** Como desenvolvedor, preciso criar a estrutura base do microserviço WhatsApp para que possamos começar a implementar a lógica de conexão Baileys.

**Acceptance Criteria:**
- [ ] Criar `whatsapp-service/package.json` com dependências: Baileys v7, Express 5, Prisma, qrcode, cors, dotenv
- [ ] Criar `whatsapp-service/tsconfig.json` com target ES2022, strict mode
- [ ] Criar `whatsapp-service/.env.example` com variáveis DATABASE_URL, WHATSAPP_SERVICE_PORT, WHATSAPP_WEBHOOK_URL, WHATSAPP_WEBHOOK_SECRET, WHATSAPP_SERVICE_API_KEY
- [ ] `npm install` executa sem erros
- [ ] Typecheck passa

### US-002: Modelos Prisma para autenticação Baileys
**Description:** Como desenvolvedor, preciso armazenar sessões Baileys no banco de dados para que as conexões WhatsApp persistam entre restarts do serviço.

**Acceptance Criteria:**
- [ ] Adicionar modelo `BaileysAuthState` ao schema.prisma com campos: id, companyId, keyType, keyId, keyData (Json), timestamps
- [ ] Adicionar modelo `LidMapping` ao schema.prisma com campos: id, companyId, lid, phoneNumber, timestamps
- [ ] Constraint unique em `[companyId, keyType, keyId]` para BaileysAuthState
- [ ] Constraint unique em `[companyId, lid]` para LidMapping
- [ ] Relations com Company model com onDelete: Cascade
- [ ] `prisma db push` executa sem erros
- [ ] Typecheck passa

### US-003: Compartilhar Prisma client com WhatsApp Service
**Description:** Como desenvolvedor, preciso que o WhatsApp Service acesse o mesmo banco do ERP para compartilhar dados de sessão e empresas.

**Acceptance Criteria:**
- [ ] Copiar schema.prisma do ERP para `whatsapp-service/prisma/`
- [ ] `npx prisma generate` executa sem erros no whatsapp-service
- [ ] Criar `whatsapp-service/src/lib/prisma.ts` exportando instância do PrismaClient
- [ ] Typecheck passa

### US-004: Implementar useDatabaseAuthState com Prisma
**Description:** Como desenvolvedor, preciso de um gerenciador de estado de autenticação Baileys que use Prisma/PostgreSQL (adaptado do JáRespondi que usava Supabase).

**Acceptance Criteria:**
- [ ] Criar `whatsapp-service/src/providers/useDatabaseAuthState.ts`
- [ ] Carregar ou inicializar credenciais (`initAuthCreds` do Baileys)
- [ ] Cache em memória para reduzir queries
- [ ] Suporte a todos os tipos de chave: creds, pre-key, session, sender-key, etc.
- [ ] LID mappings armazenados em tabela dedicada `LidMapping`
- [ ] Serialização/deserialização com `BufferJSON.replacer/reviver`
- [ ] `saveCreds()` persiste credenciais no banco
- [ ] Typecheck passa

### US-005: Implementar BaileysProvider
**Description:** Como desenvolvedor, preciso de um provider que gerencie conexões WhatsApp via Baileys, incluindo QR Code, Pairing Code, envio/recebimento de mensagens e reconexão automática.

**Acceptance Criteria:**
- [ ] Criar `whatsapp-service/src/providers/baileys.provider.ts`
- [ ] Método `initiateQrCode(companyId)` — inicia conexão e gera QR code
- [ ] Método `initiatePairingCode(companyId, phoneNumber)` — conexão via código de pareamento
- [ ] Método `getQrCode(companyId)` — retorna QR code base64
- [ ] Método `getPairingCode(companyId)` — retorna código de pareamento
- [ ] Método `disconnect(companyId)` — desconecta sessão
- [ ] Método `getConnectionStatus(companyId)` — retorna { isConnected, isConnecting, lastError }
- [ ] Método `sendMessage(companyId, to, content)` — envia texto, retorna messageId
- [ ] Método `sendMediaMessage(companyId, to, mediaUrl, caption, mediaType)` — envia mídia
- [ ] Cooldown de 15s entre tentativas de conexão
- [ ] Reconexão com exponential backoff (5s → 60s)
- [ ] Disconnect 401 (device_removed): não reconectar automaticamente
- [ ] Disconnect restartRequired: recriar socket com mesmas credenciais
- [ ] Mídia recebida salva em diretório `uploads/`
- [ ] Webhook POST para ERP no formato compatível com `EvolutionWebhookPayload`
- [ ] Typecheck passa

### US-006: Rotas Express e servidor do WhatsApp Service
**Description:** Como desenvolvedor, preciso de endpoints HTTP para que o ERP possa controlar conexões e enviar mensagens via WhatsApp Service.

**Acceptance Criteria:**
- [ ] Middleware de autenticação por API key (`apikey` header)
- [ ] `POST /instance/connect` — inicia conexão QR code
- [ ] `POST /instance/connect-pairing` — inicia conexão pairing code
- [ ] `GET /instance/:companyId/qr` — retorna QR code base64
- [ ] `GET /instance/:companyId/pairing-code` — retorna código de pareamento
- [ ] `GET /instance/:companyId/status` — retorna status da conexão
- [ ] `POST /instance/:companyId/disconnect` — desconecta sessão
- [ ] `POST /message/send-text` — envia mensagem de texto
- [ ] `POST /message/send-media` — envia mídia
- [ ] `GET /health` — health check (sem autenticação)
- [ ] Servir arquivos estáticos de `uploads/`
- [ ] Graceful shutdown com `prisma.$disconnect()`
- [ ] Typecheck passa

### US-007: Adaptar ERP para usar WhatsApp Service
**Description:** Como desenvolvedor, preciso trocar as chamadas da Evolution API para o novo WhatsApp Service, mantendo o mesmo comportamento do SAC.

**Acceptance Criteria:**
- [ ] Criar `erp/src/lib/whatsapp-api.ts` com funções `sendTextMessage`, `sendMediaMessage`, `getInstanceStatus`
- [ ] Atualizar imports em `whatsapp-outbound.ts` de `evolution-api` para `whatsapp-api`
- [ ] Atualizar webhook route para validar `WHATSAPP_WEBHOOK_SECRET` ao invés de `EVOLUTION_API_KEY`
- [ ] Payload do webhook do BaileysProvider compatível com `EvolutionWebhookPayload` — `whatsapp-inbound.ts` sem alterações
- [ ] Remover variáveis EVOLUTION_API_URL e EVOLUTION_API_KEY do .env
- [ ] Adicionar WHATSAPP_SERVICE_URL, WHATSAPP_SERVICE_API_KEY, WHATSAPP_WEBHOOK_SECRET ao .env
- [ ] Typecheck passa

### US-008: Docker Compose para WhatsApp Service
**Description:** Como DevOps, preciso que o WhatsApp Service rode em container Docker junto ao restante da stack.

**Acceptance Criteria:**
- [ ] Criar `whatsapp-service/Dockerfile` (Node 20 slim, build TypeScript, prisma generate)
- [ ] Adicionar serviço `whatsapp-service` no `docker-compose.yml` (porta 3001, variáveis de ambiente)
- [ ] Volume persistente para `uploads/`
- [ ] Remover serviço Evolution API do docker-compose
- [ ] `docker-compose build whatsapp-service` executa sem erros

### US-009: Modelos Prisma para AI Agent e Knowledge Base
**Description:** Como desenvolvedor, preciso das tabelas de banco para configuração do AI, documentos da knowledge base e chunks com embeddings.

**Acceptance Criteria:**
- [ ] Adicionar modelo `AiConfig` com campos: id, companyId (unique), enabled, persona (Text), welcomeMessage, escalationKeywords (String[]), maxIterations
- [ ] Adicionar modelo `Document` com campos: id, companyId, name, mimeType, fileSize, status (enum PROCESSING/READY/ERROR)
- [ ] Adicionar modelo `DocumentChunk` com campos: id, documentId, content (Text), embedding (Float[]), chunkIndex
- [ ] Adicionar campo `aiEnabled` (Boolean, default true) ao modelo Ticket
- [ ] Adicionar campo `isAiGenerated` (Boolean, default false) ao modelo TicketMessage
- [ ] Relations com Company (onDelete: Cascade) e Document → DocumentChunk (onDelete: Cascade)
- [ ] `prisma db push` executa sem erros
- [ ] Typecheck passa

### US-010: Abstração de provedor LLM
**Description:** Como desenvolvedor, preciso de uma abstração para chamar diferentes provedores de LLM (OpenAI, DeepSeek, Anthropic) sem alterar o código do agente.

**Acceptance Criteria:**
- [ ] Criar `erp/src/lib/ai/provider.ts` com interfaces AiMessage, AiToolDefinition, AiResponse
- [ ] Função `chatCompletion(messages, tools)` que roteia para o provedor configurado via `AI_PROVIDER` env
- [ ] Suporte a OpenAI/DeepSeek via Chat Completions API (formato compatível)
- [ ] Suporte a Anthropic via Messages API (conversão de formato)
- [ ] Suporte a tool calling em todos os provedores
- [ ] Criar `erp/src/lib/ai/tools.ts` com definições das ferramentas: SEARCH_DOCUMENTS, GET_CLIENT_INFO, GET_HISTORY, RESPOND, ESCALATE, CREATE_NOTE
- [ ] Typecheck passa

### US-011: Worker do AI Agent com BullMQ
**Description:** Como atendente, quero que mensagens WhatsApp recebidas sejam processadas automaticamente pelo AI Agent quando habilitado, para que o cliente receba respostas imediatas.

**Acceptance Criteria:**
- [ ] Criar `erp/src/lib/ai/agent.ts` com loop de agent (max iterations configurável, timeout)
- [ ] Criar `erp/src/lib/ai/tool-executor.ts` com execução das ferramentas (SEARCH_DOCUMENTS, GET_CLIENT_INFO, GET_HISTORY, RESPOND, ESCALATE, CREATE_NOTE)
- [ ] Criar `erp/src/lib/workers/ai-agent.ts` — worker BullMQ que processa jobs `ai-agent`
- [ ] Worker verifica se AI está habilitado (AiConfig.enabled + Ticket.aiEnabled) antes de processar
- [ ] Worker verifica escalation keywords antes de chamar LLM
- [ ] Ferramenta RESPOND envia mensagem via WhatsApp e cria TicketMessage com `isAiGenerated: true`
- [ ] Ferramenta ESCALATE desabilita AI no ticket e marca como "aguardando atendente"
- [ ] Adicionar fila `ai-agent` em `queue.ts` e registrar worker em `workers/index.ts`
- [ ] Hook em `whatsapp-inbound.ts`: após criar mensagem INBOUND, enfileirar job `ai-agent`
- [ ] Typecheck passa

### US-012: Embeddings e busca vetorial para RAG
**Description:** Como desenvolvedor, preciso gerar embeddings de documentos e fazer busca por similaridade para que o AI Agent encontre informações relevantes na knowledge base.

**Acceptance Criteria:**
- [ ] Criar `erp/src/lib/ai/embeddings.ts`
- [ ] Função `generateEmbedding(text)` — chama API de embeddings (configurável via AI_EMBEDDING_PROVIDER)
- [ ] Função `chunkText(text, maxTokens)` — divide texto em chunks de ~500 tokens
- [ ] Função `cosineSimilarity(a, b)` — calcula similaridade entre dois vetores
- [ ] Função `searchDocuments(query, companyId)` — busca chunks mais similares (threshold configurável)
- [ ] Retorna top N resultados acima do threshold de similaridade
- [ ] Typecheck passa

### US-013: Worker de processamento de documentos
**Description:** Como administrador, quero que documentos enviados à knowledge base sejam processados automaticamente (extração de texto, chunking, embedding).

**Acceptance Criteria:**
- [ ] Criar `erp/src/lib/workers/document-processor.ts`
- [ ] Suporte a extração de texto de: TXT (direto), PDF (via pdf-parse)
- [ ] Dividir texto em chunks usando `chunkText()`
- [ ] Gerar embedding para cada chunk via `generateEmbedding()`
- [ ] Salvar chunks com embeddings no banco (DocumentChunk)
- [ ] Atualizar status do documento para READY ao concluir
- [ ] Atualizar status para ERROR em caso de falha
- [ ] Adicionar fila `document-processing` em `queue.ts` e registrar worker
- [ ] Typecheck passa

### US-014: API e UI da Knowledge Base
**Description:** Como administrador, quero uma interface para gerenciar documentos da knowledge base (upload, visualizar, deletar) para que o AI Agent tenha informações atualizadas.

**Acceptance Criteria:**
- [ ] Criar `erp/src/app/api/documents/route.ts` — GET (listar) e POST (upload + enfileirar processamento)
- [ ] Criar `erp/src/app/(app)/configuracoes/knowledge-base/page.tsx`
- [ ] Upload de arquivos (arrastar ou selecionar) para PDF, TXT
- [ ] Tabela de documentos: nome, status (badge PROCESSING/READY/ERROR), tamanho, data, botão deletar
- [ ] Deletar documento remove chunks junto (cascade)
- [ ] Adicionar link "Knowledge Base" na sidebar em Configurações
- [ ] Typecheck passa
- [ ] Verificar no browser usando dev-browser skill

### US-015: Toggle AI e badge na timeline do ticket
**Description:** Como atendente, quero ativar/desativar o AI Agent por ticket e ver quais mensagens foram geradas pelo AI, para manter controle sobre o atendimento.

**Acceptance Criteria:**
- [ ] Server action `toggleTicketAi(ticketId, companyId, enabled)` em `actions.ts`
- [ ] Switch toggle de AI no header da timeline do ticket
- [ ] Badge "AI" em mensagens com `isAiGenerated: true` (variant outline)
- [ ] Toggle revalida a página após mudança
- [ ] Typecheck passa
- [ ] Verificar no browser usando dev-browser skill

### US-016: Página de configuração do AI Agent
**Description:** Como administrador, quero configurar o AI Agent (persona, mensagem de boas-vindas, palavras de escalação) para personalizar o atendimento automático.

**Acceptance Criteria:**
- [ ] Criar `erp/src/app/(app)/configuracoes/ai/page.tsx`
- [ ] Server actions `getAiConfig(companyId)` e `updateAiConfig(companyId, data)`
- [ ] Toggle: AI habilitado/desabilitado
- [ ] Textarea: Persona (system prompt do LLM)
- [ ] Textarea: Mensagem de boas-vindas
- [ ] Input de tags: Palavras-chave de escalação
- [ ] Input numérico: Max iterações
- [ ] Salvar com feedback visual (toast/alert)
- [ ] Adicionar link "Agente IA" na sidebar em Configurações (ícone Bot)
- [ ] Typecheck passa
- [ ] Verificar no browser usando dev-browser skill

### US-017: Atualizar .env.example e dependências
**Description:** Como desenvolvedor, preciso que todas as novas variáveis de ambiente e dependências estejam documentadas para facilitar setup de novos ambientes.

**Acceptance Criteria:**
- [ ] Atualizar `erp/.env.example` com variáveis: WHATSAPP_SERVICE_URL, WHATSAPP_SERVICE_API_KEY, WHATSAPP_WEBHOOK_SECRET, AI_PROVIDER, AI_API_KEY, AI_MODEL, AI_MAX_ITERATIONS, AI_TIMEOUT, AI_EMBEDDING_PROVIDER, AI_EMBEDDING_KEY, AI_EMBEDDING_MODEL, RAG_CHUNK_SIZE, RAG_MAX_RESULTS, RAG_SIMILARITY_THRESHOLD
- [ ] Remover variáveis EVOLUTION_API_URL e EVOLUTION_API_KEY do .env.example
- [ ] Adicionar `pdf-parse` ao `erp/package.json` se necessário
- [ ] Typecheck passa

## Functional Requirements

- FR-1: O WhatsApp Service deve rodar como microserviço Express na porta 3001, comunicando com o ERP via HTTP webhooks
- FR-2: Sessões Baileys devem ser persistidas em PostgreSQL (mesma instância do ERP) para sobreviver a restarts
- FR-3: O sistema deve suportar conexão WhatsApp via QR Code e via Pairing Code
- FR-4: Mensagens recebidas via WhatsApp devem ser enviadas ao ERP via webhook no formato compatível com o `EvolutionWebhookPayload` existente
- FR-5: O ERP deve enviar mensagens WhatsApp chamando o WhatsApp Service via HTTP (substituindo chamadas à Evolution API)
- FR-6: O AI Agent deve processar mensagens inbound como worker BullMQ, verificando se AI está habilitado (company + ticket)
- FR-7: O AI Agent deve usar um loop agentic com ferramentas (SEARCH_DOCUMENTS, GET_CLIENT_INFO, GET_HISTORY, RESPOND, ESCALATE, CREATE_NOTE)
- FR-8: O AI Agent deve suportar múltiplos provedores LLM (DeepSeek, OpenAI, Anthropic) via variável de ambiente
- FR-9: A Knowledge Base deve processar documentos (PDF, TXT) em chunks com embeddings para busca por similaridade
- FR-10: Documentos devem ser processados assincronamente via worker BullMQ com status tracking (PROCESSING → READY/ERROR)
- FR-11: Atendentes devem poder ativar/desativar AI por ticket via toggle na timeline
- FR-12: Mensagens geradas pelo AI devem ser identificadas com badge "AI" na timeline
- FR-13: Administradores devem poder configurar persona, mensagem de boas-vindas, palavras de escalação e max iterações do AI
- FR-14: Palavras-chave de escalação devem desabilitar AI no ticket imediatamente, sem chamar o LLM
- FR-15: O microserviço WhatsApp deve ter autenticação por API key em todas as rotas (exceto health check)

## Non-Goals

- Não implementar notificações push/real-time de status de conexão WhatsApp
- Não implementar suporte a grupos WhatsApp (apenas conversas 1-1)
- Não implementar respostas com mídia pelo AI Agent (apenas texto)
- Não implementar analytics ou dashboard de uso do AI
- Não implementar rate limiting no WhatsApp Service (confiamos na rede interna localhost)
- Não implementar treinamento/fine-tuning de modelos — usar apenas APIs de terceiros
- Não implementar pgvector — usar busca por cosine similarity em memória (escala suficiente para MVP)
- Não migrar dados históricos de sessões da Evolution API

## Design Considerations

- Reutilizar componentes UI existentes do ERP: Button, Table, Badge, Switch, Textarea, Input, Card
- Toggle AI usar componente Switch do shadcn/ui
- Badge "AI" usar variant `outline` para diferenciar sem poluir visualmente
- Knowledge Base UI seguir padrão das demais páginas de Configurações
- Sidebar organizar novos links sob seção "Configurações": Agente IA, Knowledge Base

## Technical Considerations

- **Código-fonte base:** BaileysProvider (~1900 linhas), WebhookAdapter (~380 linhas) e useDatabaseAuthState (~380 linhas) do projeto JáRespondi v2, adaptados de Supabase para Prisma
- **Banco compartilhado:** WhatsApp Service usa o mesmo PostgreSQL do ERP via DATABASE_URL
- **Compatibilidade webhook:** Payload do BaileysProvider deve ser compatível com `EvolutionWebhookPayload` para minimizar mudanças no inbound worker
- **BullMQ:** Reutilizar infraestrutura de filas existente (Redis) para ai-agent e document-processing
- **Embeddings:** Usar `text-embedding-3-small` da OpenAI (pode ser configurado). Busca por cosine similarity em memória (aceitável para MVP com poucos milhares de chunks)
- **Reconexão Baileys:** Exponential backoff 5s→60s, não reconectar em 401 (device removed)
- **Media:** Arquivos de mídia salvos localmente em `uploads/` com volume Docker persistente
- **Graceful shutdown:** Ambos os serviços devem fechar conexões Prisma e sockets ao receber SIGTERM

## Success Metrics

- Conexão WhatsApp via QR Code/Pairing Code funciona de forma estável (sem os problemas da Evolution API)
- Mensagens WhatsApp inbound/outbound fluem sem regressão no SAC
- AI Agent responde mensagens em menos de 30 segundos
- Administrador consegue configurar AI e Knowledge Base sem intervenção técnica
- Atendente consegue controlar AI por ticket com 1 clique (toggle)

## Open Questions

- Avaliar migração futura para pgvector para busca vetorial mais eficiente em grandes volumes de documentos
- Definir política de retenção de chunks/embeddings ao atualizar documentos (reprocessar ou incremental?)
- Avaliar necessidade de suporte a DOCX na Knowledge Base (requer biblioteca adicional)
- Definir se AI deve enviar mensagem de boas-vindas automaticamente quando um novo ticket é criado
