# SAC Omnichannel — Design Document

**Data:** 02/03/2026
**Branch:** ralph/erp-multi-empresa
**Status:** Aprovado

## 1. Visao Geral

Transformar o modulo SAC do MendesERP em um hub omnichannel com integracao bidirecional de Email (IMAP/SMTP) e WhatsApp (Evolution API), com:

- Criacao automatica de tickets a partir de mensagens recebidas
- Resposta bidirecional por ambos os canais (inclusive fora do ERP)
- Multiplos contatos por cliente (financeiro, diretor, etc.)
- Anexos em mensagens e tickets
- Historico imutavel com exportacao PDF para evidencias
- Fluxo de reembolso integrado com Financeiro (NFS-e, contas a pagar)
- SLA configuravel com alertas
- Dashboard com KPIs na lista de tickets

## 2. Abordagem Tecnica

**Opcao escolhida: Evolution API (WhatsApp) + IMAP/SMTP (Email)**

| Componente | Tecnologia |
|-----------|-----------|
| WhatsApp | Evolution API (self-hosted, webhook push) |
| Email receber | IMAP polling (2-3 min, Inbox + Sent) |
| Email enviar | SMTP |
| Fila | BullMQ + Redis |
| Storage anexos | File system local (ou S3 futuro) |

**Motivos:** Custo zero por mensagem, IMAP universal (Outlook, Gmail, qualquer provedor), Evolution API madura no ecossistema BR, controle total self-hosted.

## 3. Arquitetura

```
MendesERP (Next.js)
  ├── SAC UI (tickets, abas, anexos)
  ├── Config UI (canais, SLA, contatos)
  ├── API Routes /api/webhooks/whatsapp, /api/webhooks/email-inbound
  ├── Message Processing Service
  │   ├── Identifica cliente (email/telefone)
  │   ├── Cria ou agrupa em ticket existente
  │   ├── Processa anexos
  │   └── Verifica SLA
  ├── Prisma (DB)
  ├── File Storage (anexos)
  └── BullMQ + Redis (fila de mensagens)
        ├── Worker: IMAP polling (Inbox + Sent)
        ├── Worker: Envio SMTP
        ├── Worker: Envio WhatsApp
        └── Worker: SLA check (a cada 1 min)

Externos:
  ├── Evolution API (WhatsApp, self-hosted, webhook push)
  └── Email Servers (IMAP/SMTP - Outlook, Gmail, qualquer provedor)
```

### Fluxo de entrada (mensagem recebida)

1. **WhatsApp**: Evolution API recebe mensagem -> webhook para `/api/webhooks/whatsapp`
2. **Email**: Worker BullMQ faz polling IMAP a cada 2-3 min -> enfileira emails novos
3. **Processamento** (mesmo para ambos):
   - Busca contato em `Client.email`/`Client.telefone` e `AdditionalContact.email`/`AdditionalContact.whatsapp`
   - Se encontrou -> busca ticket aberto do cliente -> agrupa ou cria novo
   - Se nao encontrou -> cria ticket com status "pendente vinculacao"
4. **Anexos**: salvos em file storage, referencia no banco

### Fluxo de saida (resposta do atendente)

1. Atendente responde no ticket, escolhendo o canal (email ou WhatsApp)
2. Mensagem vai para fila BullMQ
3. Worker envia via SMTP (email) ou Evolution API (WhatsApp)
4. Registra confirmacao de envio no historico

### Sincronizacao bidirecional (respostas fora do ERP)

- **WhatsApp**: Evolution API faz webhook de TODAS as mensagens (inclusive enviadas pelo WhatsApp Web/celular) -> sistema detecta OUTBOUND e registra no ticket
- **Email**: IMAP polling monitora pasta Inbox E pasta Sent/Enviados -> se atendente responder pelo Gmail/Outlook do celular, o sistema captura e registra

### Deduplicacao (3 camadas)

| Camada | Mecanismo | Protege contra |
|--------|-----------|---------------|
| UID tracking | `lastSyncUid` no Channel | Reprocessar emails antigos |
| Unique constraint | `@@unique([externalId, channel])` | Duplicacao no banco |
| Upsert no worker | `upsert` em vez de `create` | Race conditions entre workers |

## 4. Modelo de Dados

### Novas tabelas

```prisma
// Contatos adicionais do cliente (tabela Client NAO muda)
model AdditionalContact {
  id          String   @id @default(cuid())
  clientId    String
  name        String
  role        String?           // "Financeiro", "Diretor", "Compras"
  email       String?
  whatsapp    String?
  createdAt   DateTime @default(now())

  client      Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
}

// Canal de comunicacao configurado por empresa
model Channel {
  id              String      @id @default(cuid())
  companyId       String
  type            ChannelType // EMAIL ou WHATSAPP
  name            String      // "Suporte Outlook", "WhatsApp Comercial"
  config          Json        // credenciais IMAP/SMTP ou Evolution API
  isActive        Boolean     @default(true)
  lastSyncUid     Int?        // ultimo UID de email processado (Inbox)
  lastSyncUidSent Int?        // ultimo UID processado (Sent)
  lastSyncAt      DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  company         Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
}

// Configuracao de SLA por empresa
model SlaConfig {
  id                   String          @id @default(cuid())
  companyId            String
  type                 SlaType         // TICKET ou REFUND
  priority             TicketPriority? // so para TICKET
  stage                String          // "first_response", "resolution", "approval", "execution"
  deadlineMinutes      Int
  alertBeforeMinutes   Int             @default(30)
  createdAt            DateTime        @default(now())
  updatedAt            DateTime        @updatedAt

  company              Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)

  @@unique([companyId, type, priority, stage])
}

// Anexos de mensagens/tickets
model Attachment {
  id              String          @id @default(cuid())
  ticketMessageId String?
  ticketId        String?
  fileName        String
  fileSize        Int
  mimeType        String
  storagePath     String
  createdAt       DateTime        @default(now())

  message         TicketMessage?  @relation(fields: [ticketMessageId], references: [id], onDelete: Cascade)
  ticket          Ticket?         @relation(fields: [ticketId], references: [id], onDelete: Cascade)
}

// Reembolso
model Refund {
  id                  String              @id @default(cuid())
  ticketId            String
  companyId           String
  requestedById       String
  approvedById        String?
  executedById        String?
  amount              Decimal
  paymentMethod       RefundPaymentMethod?
  bankName            String?
  bankAgency          String?
  bankAccount         String?
  pixKey              String?
  status              RefundStatus        @default(AWAITING_APPROVAL)
  rejectionReason     String?
  requestedAt         DateTime            @default(now())
  approvedAt          DateTime?
  executedAt          DateTime?
  completedAt         DateTime?
  slaDeadline         DateTime?
  slaBreached         Boolean             @default(false)
  invoiceAction       RefundInvoiceAction?
  invoiceCancelReason String?

  ticket              Ticket              @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  company             Company             @relation(fields: [companyId], references: [id], onDelete: Cascade)
  requestedBy         User                @relation("RefundRequester", fields: [requestedById], references: [id])
  approvedBy          User?               @relation("RefundApprover", fields: [approvedById], references: [id])
  executedBy          User?               @relation("RefundExecutor", fields: [executedById], references: [id])
  attachments         RefundAttachment[]
  accountPayable      AccountPayable?
  creditNote          Invoice?
}

// Anexos do reembolso
model RefundAttachment {
  id              String                 @id @default(cuid())
  refundId        String
  type            RefundAttachmentType   // PAYMENT_PROOF ou REFUND_PROOF
  fileName        String
  fileSize        Int
  mimeType        String
  storagePath     String
  uploadedById    String
  createdAt       DateTime               @default(now())

  refund          Refund                 @relation(fields: [refundId], references: [id], onDelete: Cascade)
  uploadedBy      User                   @relation(fields: [uploadedById], references: [id])
}
```

### Alteracoes em tabelas existentes

```prisma
// Client — adicionar relacao (tabela NAO muda)
model Client {
  // ... campos existentes mantidos ...
  additionalContacts  AdditionalContact[]
}

// Ticket — novos campos
model Ticket {
  // ... campos existentes ...
  channelId           String?
  contactId           String?           // AdditionalContact que originou
  slaFirstReply       DateTime?
  slaResolution       DateTime?
  slaBreached         Boolean           @default(false)
  tags                String[]          @default([])

  channel             Channel?          @relation(fields: [channelId], references: [id])
  contact             AdditionalContact? @relation(fields: [contactId], references: [id])
  attachments         Attachment[]
  refunds             Refund[]
}

// TicketMessage — novos campos
model TicketMessage {
  // ... campos existentes ...
  channel             ChannelType?
  direction           MessageDirection  // INBOUND ou OUTBOUND
  origin              MessageOrigin     @default(SYSTEM)
  externalId          String?
  contactId           String?
  isInternal          Boolean           @default(false)

  attachments         Attachment[]
  contact             AdditionalContact? @relation(fields: [contactId], references: [id])

  @@unique([externalId, channel])
}

// AccountPayable — novos campos
model AccountPayable {
  // ... campos existentes ...
  origin              PayableOrigin     @default(MANUAL)
  refundId            String?

  refund              Refund?           @relation(fields: [refundId], references: [id])
}

// Invoice — novos campos
model Invoice {
  // ... campos existentes ...
  type                InvoiceType       @default(STANDARD)
  cancelledAt         DateTime?
  cancellationReason  String?
  refundId            String?
  originalInvoiceId   String?

  refund              Refund?           @relation(fields: [refundId], references: [id])
  originalInvoice     Invoice?          @relation("CreditNote", fields: [originalInvoiceId], references: [id])
  creditNotes         Invoice[]         @relation("CreditNote")
}
```

### Novos enums

```prisma
enum ChannelType {
  EMAIL
  WHATSAPP
}

enum MessageDirection {
  INBOUND
  OUTBOUND
}

enum MessageOrigin {
  SYSTEM       // enviada pelo ERP
  EXTERNAL     // capturada do canal (WhatsApp Web, Gmail celular, etc.)
}

enum SlaType {
  TICKET
  REFUND
}

enum RefundStatus {
  AWAITING_APPROVAL
  APPROVED
  REJECTED
  PROCESSING
  COMPLETED
}

enum RefundPaymentMethod {
  PIX
  TED
}

enum RefundAttachmentType {
  PAYMENT_PROOF
  REFUND_PROOF
}

enum RefundInvoiceAction {
  CANCEL_INVOICE
  CREDIT_NOTE
  NONE
}

enum PayableOrigin {
  MANUAL
  REFUND
}

enum InvoiceType {
  STANDARD
  CREDIT_NOTE
}
```

## 5. Interface do Usuario

### 5.1 Lista de Tickets (`/sac/tickets`)

**Dashboard (topo da pagina):**

KPIs (8 cards):
- Abertos (tickets OPEN)
- Em Andamento (IN_PROGRESS)
- Aguardando Cliente (WAITING_CLIENT)
- Resolvidos Hoje (resolvidos nas ultimas 24h)
- SLA Estourado (slaBreached = true)
- SLA Em Risco (deadline proximo)
- Reembolsos Pendentes (aguardando aprovacao/execucao)
- Tempo Medio Resposta (media 1a resposta, ultimos 7 dias)

Graficos:
- Tickets por canal (barras: Email, WhatsApp, Manual)
- Tickets por prioridade (barras: Alta, Media, Baixa)

**Abas (substituem filtros):**
- Todos: tickets abertos/andamento/aguardando
- SLA Critico: tickets com SLA estourado ou em risco (badge contagem)
- Reembolsos: tickets com reembolso pendente (badge contagem)
- Meus Tickets: tickets atribuidos ao usuario logado

**Busca por texto** disponivel em qualquer aba.

**Tabela:**
- Colunas: Cliente (nome + contato), Assunto, Canal (icone), Prioridade, SLA (indicador visual), Tags

### 5.2 Detalhe do Ticket (`/sac/tickets/[id]`)

**Layout:** Area principal (2/3) + Sidebar (1/3)

**Area principal:**
1. Cabecalho: assunto, ID, prioridade, status
2. Descricao
3. Acoes de status (transicoes validas)
4. Timeline com 3 abas

**Aba "Todos":**
- Timeline cronologica unificada: mensagens email, WhatsApp, notas internas, eventos de reembolso, mudancas de status
- NAO permite responder, apenas:
  - Anexar arquivo ao ticket
  - Adicionar nota interna (visivel so para equipe, fundo amarelo, icone cadeado)

**Aba "Email":**
- Somente mensagens de email
- Layout de thread: De, Para, Assunto
- Campo de resposta com formato email: destinatario (dropdown contatos), assunto pre-preenchido
- Botao anexar + enviar

**Aba "WhatsApp":**
- Somente mensagens WhatsApp
- Layout estilo chat com baloes (esquerda = cliente, direita = atendente)
- Campo de resposta com: seletor de numero destino, botao emoji, anexar, enviar

**Sidebar:**
- Informacoes: cliente (nome, CNPJ), contato (nome, cargo, email, whatsapp), empresa, canal de origem, datas
- Responsavel: dropdown para atribuir
- SLA: 1a resposta e resolucao com barra de progresso (verde/amarelo/vermelho)
- Tags: badges + adicionar tag
- Situacao Financeira: adimplente/atraso/inadimplente, valores pendentes/vencidos, ultimo pagamento
- Reembolso: card com status e SLA (se existir)
- Acoes rapidas: Solicitar Reembolso, Solicitar Cancelamento
- Vinculos: proposta, boleto
- Exportar PDF: com opcoes (incluir notas internas, incluir preview anexos)

### 5.3 Configuracoes — Canais (`/configuracoes/canais`)

Cards por canal configurado:
- Email: nome, endereco, provedor, status sync, botoes editar/testar/desativar
- WhatsApp: nome, numero, status conexao Evolution API, botoes editar/QR code/desativar
- Botao "+ Novo Canal"

### 5.4 Configuracoes — SLA (`/configuracoes/sla`)

**SLA de Tickets** (tabela editavel):
- Por prioridade (Alta/Media/Baixa): 1a resposta, resolucao, alerta antes

**SLA de Reembolso** (tabela editavel):
- Por etapa (Aprovacao/Execucao/Total): prazo, alerta antes

**Horario comercial:**
- Toggle: considerar apenas horario comercial
- Horario inicio/fim
- Dias da semana (checkboxes)
- SLA pausa fora do horario comercial

## 6. Fluxo de Reembolso

### Workflow

1. **Solicitacao**: Atendente cria no ticket. Obrigatorio: comprovante de pagamento do boleto, valor, justificativa. Tag "Reembolso" adicionada. SLA inicia.
2. **Aprovacao**: Gestor/Admin revisa. Aprova ou rejeita (com motivo).
3. **Execucao**: Financeiro realiza. Obrigatorio: metodo (PIX/TED), dados bancarios, acao sobre NFS-e (cancelar ou nota de credito), comprovante do reembolso.
4. **Conclusao**: Status COMPLETED, SLA encerra. AccountPayable marcado como PAID.

### Integracao com Financeiro

Ao executar reembolso:
1. Cria `AccountPayable` (origin: REFUND, vinculado ao refundId)
2. NFS-e: cancelar Invoice existente OU emitir Invoice tipo CREDIT_NOTE
3. Cancela `AccountReceivable` pendente (se houver)
4. Ao anexar comprovante: marca AccountPayable como PAID

**Impacto automatico:**
- DRE: reembolso aparece como despesa na categoria "Reembolsos"
- Fluxo de Caixa: reembolso pendente = saida projetada, pago = saida realizada
- Conciliacao: lancamento bancario pode ser conciliado com o AccountPayable

### Fluxo de Cancelamento (boleto/proposta)

Atendente solicita cancelamento no ticket:
- Proposta vinculada -> status CANCELLED
- Boletos/AccountReceivable pendentes -> status CANCELLED
- Precisa aprovacao do gestor
- Registrado na timeline como prova

## 7. Exportacao PDF

Documento completo de evidencia contendo:

1. **Cabecalho**: logo/nome empresa, titulo, ID ticket, data geracao
2. **Informacoes**: assunto, cliente (nome + CNPJ), prioridade, status, responsavel, canal, datas, tempo total
3. **SLA**: tempos cumpridos vs prazos
4. **Vinculos**: proposta e boleto
5. **Historico completo**: todas as mensagens numeradas em ordem cronologica com:
   - Data/hora exata
   - Canal (Email/WhatsApp)
   - Direcao (recebida/enviada)
   - Remetente/destinatario
   - Origem (ERP/externo)
   - Conteudo completo
   - Anexos com preview inline
   - Notas internas marcadas
   - Mudancas de status
   - Eventos de reembolso
6. **Reembolso** (se houver): dados completos, NFS-e, comprovantes
7. **Lista de anexos**: indice com tamanho e mensagem de origem
8. **Rodape**: timestamp, declaracao de fidelidade, paginacao

**Opcoes de exportacao:**
- Incluir/omitir notas internas
- Incluir/omitir preview de anexos

## 8. Integracao SAC <-> Clientes

- Tabela `Client` NAO muda (email e telefone originais = contato principal)
- Nova tabela `AdditionalContact` para contatos extras (nome, cargo, email, whatsapp)
- Identificacao de mensagens: busca primeiro em Client, depois em AdditionalContact
- Contato desconhecido: banner no ticket para vincular via CNPJ ou criar novo cliente
- Timeline do cliente expandida com abas: Todos, Tickets, Boletos, Emails, WhatsApp

## 9. Integracao SAC <-> Financeiro

- Situacao financeira do cliente visivel na sidebar do ticket (adimplente/atraso/inadimplente)
- Classificacao: sem vencidos = verde, vencidos <= 30d = amarelo, vencidos > 30d = vermelho
- Reembolso cria AccountPayable automaticamente (origin: REFUND)
- Reembolso pode cancelar NFS-e ou emitir nota de credito
- Na lista de Contas a Pagar: badge "SAC" para itens gerados por reembolso, clicavel para o ticket
- Cancelamento de proposta/boleto altera status no Financeiro

## 10. SLA com Alertas

### Verificacao

Worker BullMQ roda a cada 1 minuto:
1. Busca tickets/reembolsos com deadline proximo
2. Se falta <= alertBeforeMinutes: marca "em risco", notifica responsavel
3. Se deadline passou: marca slaBreached = true, notifica responsavel + gestor

### Horario comercial

SLA pausa fora do horario configurado. Exemplo: SLA de 4h as 17:00 de sexta retoma na segunda 08:00.

### Alertas na UI

- Badge no menu lateral SAC com contagem de tickets criticos
- Banner no topo da lista de tickets
- Coluna SLA na tabela com indicador visual
- Barra de progresso na sidebar do ticket
- Notificacoes dentro do ERP

### Valores padrao

**Tickets:**
| Prioridade | 1a Resposta | Resolucao | Alerta |
|-----------|------------|----------|--------|
| Alta | 30 min | 4h | 15 min |
| Media | 2h | 24h | 30 min |
| Baixa | 8h | 48h | 1h |

**Reembolso:**
| Etapa | Prazo | Alerta |
|-------|-------|--------|
| Aprovacao | 4h | 1h |
| Execucao | 24h | 4h |
| Total | 48h | 8h |

## 11. Volume e Performance

- Estimativa: ~100 tickets/empresa/dia
- BullMQ + Redis para processamento assincrono
- IMAP polling a cada 2-3 min (delay aceitavel para email)
- WhatsApp via webhook (tempo real)
- Deduplicacao em 3 camadas (UID tracking, unique constraint, upsert)
