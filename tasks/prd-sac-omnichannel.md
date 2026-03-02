# PRD: SAC Omnichannel — MendesERP

## 1. Introducao / Overview

Evolucao do modulo SAC do MendesERP para um hub omnichannel com integracao bidirecional de Email (IMAP/SMTP) e WhatsApp (Evolution API). O sistema cria tickets automaticamente a partir de mensagens recebidas, permite respostas direto pelo ERP, captura mensagens enviadas fora do ERP (WhatsApp Web, Gmail celular), e integra com os modulos Financeiro e Clientes.

Funcionalidades principais:
- Integracao bidirecional Email + WhatsApp com criacao automatica de tickets
- Multiplos contatos por cliente (financeiro, diretor, etc.)
- Anexos em mensagens e tickets
- Historico imutavel com exportacao PDF para evidencias
- Fluxo de reembolso com integracao financeira (NFS-e, contas a pagar)
- SLA configuravel com alertas e horario comercial
- Dashboard com KPIs na lista de tickets

**Design doc:** `docs/plans/2026-03-02-sac-omnichannel-design.md`

### Problema

- Tickets criados manualmente um por um e complicado e demorado
- Sem integracao com canais de comunicacao (Email/WhatsApp)
- Sem registro formal de evidencias para reembolsos e cancelamentos
- Sem controle de SLA e tempo de resposta
- Cliente pode ter multiplos contatos mas o sistema so registra um email e um telefone

---

## 2. Goals

- Automatizar criacao de tickets a partir de mensagens de Email e WhatsApp
- Permitir resposta bidirecional por ambos os canais direto do ticket
- Capturar respostas feitas fora do ERP (WhatsApp Web, Gmail celular) para manter historico completo
- Gerar PDF de evidencias com historico completo para reembolsos e cancelamentos
- Integrar reembolso com Financeiro (criar conta a pagar, cancelar/emitir NFS-e)
- Controlar SLA por prioridade com alertas visuais e notificacoes
- Suportar ~100 tickets/empresa/dia com processamento assincrono

---

## 3. User Stories

### Modulo: Infraestrutura e Setup

#### US-048: Instalar e configurar Redis
**Descricao:** Como desenvolvedor, preciso do Redis instalado e configurado no ambiente de desenvolvimento para que o BullMQ funcione como sistema de filas.

**Criterios de Aceite:**
- [ ] Redis instalado no devcontainer (adicionar ao `devcontainer.json`)
- [ ] Redis rodando na porta padrao 6379
- [ ] Variavel `REDIS_URL` adicionada ao `.env.example`
- [ ] Teste de conexao com Redis funciona (`redis-cli ping` retorna `PONG`)
- [ ] Typecheck/lint passa

#### US-049: Configurar BullMQ e workers base
**Descricao:** Como desenvolvedor, preciso da infraestrutura de filas BullMQ configurada para processar mensagens de email e WhatsApp de forma assincrona.

**Criterios de Aceite:**
- [ ] Pacotes `bullmq` e `ioredis` instalados
- [ ] Arquivo `erp/src/lib/queue.ts` com conexao Redis e exportacao de filas nomeadas: `email-inbound`, `email-outbound`, `whatsapp-inbound`, `whatsapp-outbound`, `sla-check`
- [ ] Arquivo `erp/src/lib/workers/index.ts` com registro de workers
- [ ] Worker base funcional que processa job da fila e loga no console
- [ ] Script npm `workers` em `package.json` para rodar workers separadamente
- [ ] Typecheck/lint passa

#### US-050: Configurar Evolution API (Docker)
**Descricao:** Como desenvolvedor, preciso da Evolution API rodando localmente para desenvolver a integracao com WhatsApp.

**Criterios de Aceite:**
- [ ] Docker Compose com servico `evolution-api` adicionado ao projeto
- [ ] Evolution API acessivel em `http://localhost:8080`
- [ ] Variavel `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` adicionadas ao `.env.example`
- [ ] Documentacao basica no `.env.example` sobre como obter a API key
- [ ] Typecheck/lint passa

---

### Modulo: Modelo de Dados

#### US-051: Criar tabela AdditionalContact
**Descricao:** Como atendente, preciso registrar multiplos contatos por cliente (financeiro, diretor, compras) para identificar quem esta nos contactando por email ou WhatsApp.

**Criterios de Aceite:**
- [ ] Model `AdditionalContact` no schema.prisma com campos: id, clientId, name, role (opcional), email (opcional), whatsapp (opcional), createdAt
- [ ] Relacao `Client.additionalContacts` (1:N, cascade delete)
- [ ] Migration gerada e aplicada com sucesso
- [ ] Seed atualizado com 2-3 contatos adicionais de exemplo para clientes existentes
- [ ] Typecheck/lint passa

#### US-052: Criar tabela Channel
**Descricao:** Como admin, preciso cadastrar canais de comunicacao (contas de email IMAP/SMTP e numeros WhatsApp) por empresa para receber e enviar mensagens.

**Criterios de Aceite:**
- [ ] Enum `ChannelType` com valores `EMAIL` e `WHATSAPP`
- [ ] Model `Channel` no schema.prisma com campos: id, companyId, type, name, config (Json), isActive, lastSyncUid, lastSyncUidSent, lastSyncAt, createdAt, updatedAt
- [ ] Relacao `Company.channels` (1:N, cascade delete)
- [ ] Migration gerada e aplicada com sucesso
- [ ] Typecheck/lint passa

#### US-053: Criar tabelas de Anexo
**Descricao:** Como atendente, preciso enviar e receber anexos (PDFs, imagens, comprovantes) nas mensagens e tickets para documentar atendimentos.

**Criterios de Aceite:**
- [ ] Model `Attachment` com campos: id, ticketMessageId (opcional), ticketId (opcional), fileName, fileSize, mimeType, storagePath, createdAt
- [ ] Relacoes: `TicketMessage.attachments` e `Ticket.attachments` (1:N, cascade delete)
- [ ] Diretorio `erp/uploads/` criado e adicionado ao `.gitignore`
- [ ] Migration gerada e aplicada com sucesso
- [ ] Typecheck/lint passa

#### US-054: Criar tabela SlaConfig
**Descricao:** Como admin, preciso configurar regras de SLA por prioridade e por empresa para controlar tempos de resposta e resolucao.

**Criterios de Aceite:**
- [ ] Enums `SlaType` (TICKET, REFUND)
- [ ] Model `SlaConfig` com campos: id, companyId, type, priority (opcional), stage, deadlineMinutes, alertBeforeMinutes (default 30), createdAt, updatedAt
- [ ] Unique constraint `[companyId, type, priority, stage]`
- [ ] Relacao `Company.slaConfigs` (1:N, cascade delete)
- [ ] Seed com valores padrao para cada empresa: Alta (30min/4h), Media (2h/24h), Baixa (8h/48h) para tickets; Aprovacao (4h), Execucao (24h), Total (48h) para reembolso
- [ ] Migration gerada e aplicada com sucesso
- [ ] Typecheck/lint passa

#### US-055: Criar tabelas de Reembolso
**Descricao:** Como atendente, preciso solicitar reembolsos vinculados a tickets para devolver valores a clientes com registro formal de todo o processo.

**Criterios de Aceite:**
- [ ] Enums: `RefundStatus` (AWAITING_APPROVAL, APPROVED, REJECTED, PROCESSING, COMPLETED), `RefundPaymentMethod` (PIX, TED), `RefundAttachmentType` (PAYMENT_PROOF, REFUND_PROOF), `RefundInvoiceAction` (CANCEL_INVOICE, CREDIT_NOTE, NONE)
- [ ] Model `Refund` com todos os campos: id, ticketId, companyId, requestedById, approvedById, executedById, amount (Decimal), paymentMethod, bankName, bankAgency, bankAccount, pixKey, status, rejectionReason, requestedAt, approvedAt, executedAt, completedAt, slaDeadline, slaBreached, invoiceAction, invoiceCancelReason
- [ ] Model `RefundAttachment` com campos: id, refundId, type, fileName, fileSize, mimeType, storagePath, uploadedById, createdAt
- [ ] Relacoes: Refund -> Ticket, Company, User (requester/approver/executor), RefundAttachment[]
- [ ] Migration gerada e aplicada com sucesso
- [ ] Typecheck/lint passa

#### US-056: Atualizar tabelas existentes (Ticket, TicketMessage, AccountPayable, Invoice)
**Descricao:** Como desenvolvedor, preciso adicionar campos nas tabelas existentes para suportar canais, SLA, deduplicacao, notas internas e integracao com reembolso.

**Criterios de Aceite:**
- [ ] Enums adicionados: `MessageDirection` (INBOUND, OUTBOUND), `MessageOrigin` (SYSTEM, EXTERNAL), `PayableOrigin` (MANUAL, REFUND), `InvoiceType` (STANDARD, CREDIT_NOTE)
- [ ] `Ticket`: campos channelId, contactId, slaFirstReply, slaResolution, slaBreached (default false), tags (String[] default []), relacoes com Channel, AdditionalContact, Attachment[], Refund[]
- [ ] `TicketMessage`: campos channel (ChannelType), direction (MessageDirection), origin (MessageOrigin default SYSTEM), externalId, contactId, isInternal (default false), relacao com Attachment[], AdditionalContact. Unique constraint `[externalId, channel]`
- [ ] `AccountPayable`: campos origin (PayableOrigin default MANUAL), refundId, relacao com Refund
- [ ] `Invoice`: campos type (InvoiceType default STANDARD), cancelledAt, cancellationReason, refundId, originalInvoiceId, relacoes com Refund e self-relation "CreditNote". Adicionar status CANCELLED ao enum InvoiceStatus
- [ ] Migration gerada e aplicada com sucesso
- [ ] Seed continua funcionando sem erros
- [ ] Typecheck/lint passa

---

### Modulo: Contatos Adicionais (Clientes)

#### US-057: CRUD de contatos adicionais na pagina do cliente
**Descricao:** Como atendente, quero gerenciar contatos adicionais (nome, cargo, email, whatsapp) de um cliente para que o sistema identifique automaticamente quem esta nos contactando.

**Criterios de Aceite:**
- [ ] Secao "Contatos Adicionais" na pagina de detalhe do cliente (`/comercial/clientes/[id]`)
- [ ] Lista de contatos existentes com nome, cargo, email, whatsapp
- [ ] Botao "+ Adicionar contato" abre dialog com campos: nome (obrigatorio), cargo (opcional), email (opcional), whatsapp (opcional)
- [ ] Botoes editar e remover por contato (remover com confirmacao)
- [ ] Server actions: `createAdditionalContact`, `updateAdditionalContact`, `deleteAdditionalContact`
- [ ] Validacao: pelo menos email ou whatsapp deve ser preenchido
- [ ] Audit log nas operacoes
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Configuracao de Canais

#### US-058: Pagina de configuracao de canais de comunicacao
**Descricao:** Como admin, quero cadastrar e gerenciar canais de email (IMAP/SMTP) e WhatsApp (Evolution API) por empresa para receber e enviar mensagens automaticamente.

**Criterios de Aceite:**
- [ ] Nova pagina `/configuracoes/canais` acessivel pelo menu de configuracoes
- [ ] Lista de canais cadastrados em cards (nome, tipo, endereco/numero, status, ultima sync)
- [ ] Botao "+ Novo Canal" abre dialog com: tipo (Email/WhatsApp), nome
- [ ] Para Email: campos de servidor IMAP (host, port, user, password, tls), servidor SMTP (host, port, user, password, tls)
- [ ] Para WhatsApp: campos instanceName, apiUrl (default EVOLUTION_API_URL), apiKey
- [ ] Botao "Testar conexao" que valida as credenciais (IMAP connect ou Evolution API status)
- [ ] Botoes editar, desativar/ativar por canal
- [ ] Para WhatsApp: botao "QR Code" que mostra QR para conectar sessao na Evolution API
- [ ] Credenciais salvas no campo `config` (Json) do Channel — senhas devem ser encriptadas
- [ ] Server actions: `createChannel`, `updateChannel`, `toggleChannel`, `testChannelConnection`, `getWhatsAppQRCode`
- [ ] Scoped por empresa (useCompany)
- [ ] Audit log nas operacoes
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Configuracao de SLA

#### US-059: Pagina de configuracao de SLA
**Descricao:** Como admin, quero configurar regras de SLA (tempos de resposta e resolucao) por prioridade e regras de SLA de reembolso para controlar a qualidade do atendimento.

**Criterios de Aceite:**
- [ ] Nova pagina `/configuracoes/sla` acessivel pelo menu de configuracoes
- [ ] Tabela editavel "SLA de Tickets" com linhas por prioridade (Alta/Media/Baixa) e colunas: 1a Resposta, Resolucao, Alerta Antes
- [ ] Tabela editavel "SLA de Reembolso" com linhas por etapa (Aprovacao/Execucao/Total) e colunas: Prazo, Alerta Antes
- [ ] Secao "Horario Comercial" com: toggle ativar/desativar, horario inicio/fim, checkboxes dos dias da semana
- [ ] Botao "Salvar alteracoes" persiste tudo de uma vez (upsert em batch)
- [ ] Se empresa nao tem config, mostra valores padrao pre-preenchidos
- [ ] Server actions: `getSlaConfigs`, `saveSlaConfigs`
- [ ] Scoped por empresa (useCompany)
- [ ] Audit log nas operacoes
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Upload de Anexos

#### US-060: Servico de upload e download de anexos
**Descricao:** Como desenvolvedor, preciso de um servico para upload e download de arquivos que sera usado por tickets, mensagens e reembolsos.

**Criterios de Aceite:**
- [ ] API route `POST /api/upload` que recebe FormData com arquivo, salva em `erp/uploads/{companyId}/{ano-mes}/` e retorna { fileName, fileSize, mimeType, storagePath }
- [ ] API route `GET /api/files/[...path]` que serve arquivos do diretorio uploads com validacao de acesso (usuario deve ter acesso a empresa)
- [ ] Limite de tamanho: 10MB por arquivo
- [ ] Tipos permitidos: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX, CSV, TXT
- [ ] Helper `erp/src/lib/file-upload.ts` com funcoes `uploadFile()`, `getFileUrl()`, `deleteFile()`
- [ ] Typecheck/lint passa

---

### Modulo: SAC — Redesign da Lista de Tickets

#### US-061: Dashboard de KPIs na lista de tickets
**Descricao:** Como atendente, quero ver um dashboard com metricas do SAC no topo da lista de tickets para ter visao rapida do estado dos atendimentos.

**Criterios de Aceite:**
- [ ] 8 cards de KPI no topo: Abertos, Em Andamento, Aguardando Cliente, Resolvidos Hoje, SLA Estourado, SLA Em Risco, Reembolsos Pendentes, Tempo Medio Resposta (7 dias)
- [ ] 2 graficos de barras horizontais: Tickets por Canal (Email/WhatsApp/Manual), Tickets por Prioridade (Alta/Media/Baixa)
- [ ] Dados carregados via server action `getTicketDashboard(companyId)`
- [ ] Cards com cores: vermelho para SLA estourado, amarelo para SLA em risco
- [ ] Scoped por empresa (useCompany)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-062: Abas e busca na lista de tickets (substituir filtros)
**Descricao:** Como atendente, quero navegar entre tickets por abas (Todos, SLA Critico, Reembolsos, Meus Tickets) em vez de filtros dropdown para acesso mais rapido.

**Criterios de Aceite:**
- [ ] Remover painel de filtros existente
- [ ] 4 abas: "Todos" (abertos + andamento + aguardando), "SLA Critico" (estourado + em risco), "Reembolsos" (com reembolso pendente), "Meus Tickets" (assigneeId = usuario logado)
- [ ] Abas "SLA Critico" e "Reembolsos" com badge de contagem
- [ ] Campo de busca por texto (cliente, assunto) disponivel em todas as abas
- [ ] Novas colunas na tabela: Canal (icone email/whatsapp), SLA (indicador visual), Tags (badges)
- [ ] Coluna SLA mostra: verde (ok), amarelo (em risco), vermelho (estourado) com tempo restante
- [ ] Server action `listTickets` atualizada para suportar parametro `tab` e `search`
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: SAC — Redesign do Detalhe do Ticket

#### US-063: Timeline com abas (Todos, Email, WhatsApp) no detalhe do ticket
**Descricao:** Como atendente, quero ver as mensagens do ticket separadas por canal (Todos, Email, WhatsApp) com cada aba tendo layout apropriado ao canal.

**Criterios de Aceite:**
- [ ] 3 abas na area de timeline: "Todos", "Email", "WhatsApp"
- [ ] Aba "Todos": timeline cronologica unificada mostrando mensagens de todos os canais, notas internas (fundo amarelo, icone cadeado), eventos de reembolso (icone moeda), mudancas de status (icone engrenagem). NAO tem campo de resposta. Tem campo para nota interna e botao anexar arquivo ao ticket
- [ ] Aba "Email": somente mensagens com channel=EMAIL. Layout de thread com De/Para/Assunto. Campo de resposta com dropdown de contatos email do cliente, assunto pre-preenchido "Re: {assunto}", botao anexar e enviar
- [ ] Aba "WhatsApp": somente mensagens com channel=WHATSAPP. Layout estilo chat com baloes (esquerda = INBOUND, direita = OUTBOUND). Campo de resposta com seletor de numero WhatsApp do cliente, botao emoji, anexar e enviar
- [ ] Cada mensagem mostra: remetente (nome + cargo se AdditionalContact), data/hora, canal, indicador de origem (via ERP / via WhatsApp Web / via Gmail)
- [ ] Anexos mostrados inline com nome, tamanho e link para download
- [ ] Server actions: `listTicketMessages` atualizada para aceitar filtro por channel
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-064: Notas internas na timeline
**Descricao:** Como atendente, quero adicionar notas internas visiveis somente para a equipe na timeline do ticket para registrar informacoes sem enviar ao cliente.

**Criterios de Aceite:**
- [ ] Na aba "Todos": campo de texto + botao "Comentar" para adicionar nota interna
- [ ] Nota interna salva como TicketMessage com `isInternal=true`, `direction=OUTBOUND`
- [ ] Na timeline: nota interna renderizada com fundo amarelo claro, icone de cadeado, label "Nota interna"
- [ ] Notas internas NAO aparecem nas abas Email e WhatsApp
- [ ] Notas internas podem ter anexos
- [ ] Server action `createInternalNote(ticketId, companyId, content, attachmentIds?)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-065: Sidebar redesenhada do ticket
**Descricao:** Como atendente, quero ver informacoes completas na sidebar do ticket incluindo situacao financeira do cliente, SLA, tags, e acoes rapidas.

**Criterios de Aceite:**
- [ ] Secao "Informacoes": cliente (nome, CNPJ), contato que originou (nome, cargo), empresa, canal de origem, datas criacao/atualizacao
- [ ] Secao "Responsavel": dropdown para atribuir/reatribuir (ja existente, manter)
- [ ] Secao "SLA": cards para 1a Resposta e Resolucao. Cada um mostra: status (cumprido/em risco/estourado), tempo decorrido vs prazo, barra de progresso (verde < 70%, amarelo 70-90%, vermelho > 90%). Server action `getTicketSla(ticketId)`
- [ ] Secao "Tags": badges coloridos + input para adicionar nova tag + remover tag existente. Server actions: `addTag`, `removeTag`
- [ ] Secao "Situacao Financeira": badge (Adimplente verde / Em Atraso amarelo / Inadimplente vermelho), total pendente, total vencido, data ultimo pagamento, link "Ver financeiro". Server action `getClientFinancialSummary(clientId, companyId)`. Classificacao: sem vencidos = Adimplente, vencidos <= 30d = Em Atraso, vencidos > 30d = Inadimplente
- [ ] Secao "Reembolso": card com status e SLA do reembolso ativo (se existir)
- [ ] Secao "Acoes Rapidas": botoes "Solicitar Reembolso" e "Solicitar Cancelamento"
- [ ] Secao "Vinculos": proposta e boleto vinculados (se houver), clicaveis
- [ ] Botao "Exportar PDF" com checkboxes (notas internas, preview anexos)
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: SAC — Envio de Mensagens

#### US-066: Enviar resposta por email a partir do ticket
**Descricao:** Como atendente, quero responder ao cliente por email direto da aba Email do ticket para que a resposta seja enviada via SMTP e registrada no historico.

**Criterios de Aceite:**
- [ ] Na aba Email: formulario com dropdown "Para" (emails do cliente + contatos adicionais), "Assunto" (pre-preenchido "Re: {assunto}"), textarea de conteudo, botao anexar
- [ ] Ao enviar: mensagem enfileirada no BullMQ (fila `email-outbound`)
- [ ] Worker SMTP envia o email usando configuracao do Channel da empresa
- [ ] Mensagem salva como TicketMessage com channel=EMAIL, direction=OUTBOUND, origin=SYSTEM, externalId=Message-ID do email enviado
- [ ] Anexos enviados junto no email
- [ ] Toast de confirmacao ou erro
- [ ] Server action `sendEmailReply(ticketId, companyId, to, subject, content, attachmentIds?)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-067: Enviar mensagem WhatsApp a partir do ticket
**Descricao:** Como atendente, quero enviar mensagem WhatsApp ao cliente direto da aba WhatsApp do ticket para que a mensagem seja enviada via Evolution API e registrada no historico.

**Criterios de Aceite:**
- [ ] Na aba WhatsApp: seletor de numero destino (telefone do cliente + contatos adicionais com whatsapp), textarea de conteudo, botao emoji, botao anexar
- [ ] Ao enviar: mensagem enfileirada no BullMQ (fila `whatsapp-outbound`)
- [ ] Worker envia via Evolution API (endpoint sendText ou sendMedia)
- [ ] Mensagem salva como TicketMessage com channel=WHATSAPP, direction=OUTBOUND, origin=SYSTEM, externalId=message.id retornado pela Evolution API
- [ ] Anexos enviados como midia (imagem/documento)
- [ ] Toast de confirmacao ou erro
- [ ] Server action `sendWhatsAppMessage(ticketId, companyId, to, content, attachmentIds?)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: SAC — Recepcao de Mensagens

#### US-068: Webhook para receber mensagens WhatsApp
**Descricao:** Como sistema, preciso receber webhooks da Evolution API para criar tickets ou adicionar mensagens automaticamente quando clientes enviam WhatsApp.

**Criterios de Aceite:**
- [ ] API route `POST /api/webhooks/whatsapp` que recebe payload da Evolution API
- [ ] Validacao do webhook (verificar API key no header)
- [ ] Ao receber mensagem: enfileira no BullMQ (fila `whatsapp-inbound`)
- [ ] Worker de processamento: identifica remetente buscando em Client.telefone e AdditionalContact.whatsapp
- [ ] Se cliente encontrado e tem ticket aberto: adiciona mensagem ao ticket mais recente
- [ ] Se cliente encontrado e sem ticket aberto: cria novo ticket com subject "WhatsApp - {nome do cliente}", priority MEDIUM
- [ ] Se cliente NAO encontrado: cria ticket com tag "Pendente Vinculacao" e sem clientId temporariamente
- [ ] Mensagem salva como TicketMessage com channel=WHATSAPP, direction=INBOUND (ou OUTBOUND se a mensagem for enviada pelo nosso numero), origin=EXTERNAL se OUTBOUND
- [ ] Anexos recebidos (imagens, PDFs, audios) salvos via servico de upload e vinculados como Attachment
- [ ] Deduplicacao: externalId = message.id do WhatsApp, unique constraint impede duplicacao
- [ ] Typecheck/lint passa

#### US-069: Worker IMAP para receber emails
**Descricao:** Como sistema, preciso monitorar caixas de email (IMAP) configuradas para criar tickets ou adicionar mensagens automaticamente quando clientes enviam emails.

**Criterios de Aceite:**
- [ ] Worker BullMQ que roda a cada 2-3 minutos para cada Channel ativo do tipo EMAIL
- [ ] Conecta via IMAP usando credenciais do Channel.config
- [ ] Busca emails novos na Inbox (UID > lastSyncUid) e na pasta Sent (UID > lastSyncUidSent)
- [ ] Para cada email da Inbox: enfileira no BullMQ (fila `email-inbound`)
- [ ] Worker de processamento: identifica remetente buscando em Client.email e AdditionalContact.email
- [ ] Se cliente encontrado e tem ticket aberto com mesmo assunto (subject thread): adiciona mensagem ao ticket
- [ ] Se cliente encontrado e sem ticket aberto correspondente: cria novo ticket com subject do email
- [ ] Se cliente NAO encontrado: cria ticket com tag "Pendente Vinculacao"
- [ ] Para emails da pasta Sent: salva como direction=OUTBOUND, origin=EXTERNAL (capturado do canal)
- [ ] Mensagem salva com externalId = Message-ID do header do email
- [ ] Anexos do email salvos via servico de upload e vinculados como Attachment
- [ ] Atualiza Channel.lastSyncUid e lastSyncUidSent apos processamento
- [ ] Atualiza Channel.lastSyncAt com timestamp
- [ ] Deduplicacao: unique constraint [externalId, channel] impede duplicacao
- [ ] Typecheck/lint passa

#### US-070: Vinculacao de contato desconhecido a cliente
**Descricao:** Como atendente, quando recebo uma mensagem de um contato nao cadastrado, quero vincular esse contato a um cliente existente (via CNPJ) ou criar um novo cliente.

**Criterios de Aceite:**
- [ ] Banner no topo do ticket quando o ticket tem tag "Pendente Vinculacao": "Contato nao identificado: {email ou telefone}. [Vincular a cliente] [Criar novo cliente]"
- [ ] Botao "Vincular a cliente": dialog com campo de busca por CNPJ ou nome. Ao selecionar cliente, cria AdditionalContact e atualiza ticket.clientId. Remove tag "Pendente Vinculacao"
- [ ] Botao "Criar novo cliente": abre dialog de criacao de cliente (reusa componente existente). Apos criar, vincula automaticamente
- [ ] Ao vincular: todas as mensagens do ticket sao associadas ao contato correto
- [ ] Server actions: `linkContactToClient(ticketId, clientId, contactData)`, `createClientAndLink(ticketId, clientData, contactData)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Reembolso

#### US-071: Solicitar reembolso a partir do ticket
**Descricao:** Como atendente, quero solicitar um reembolso a partir do ticket para iniciar o processo formal de devolucao de valores ao cliente.

**Criterios de Aceite:**
- [ ] Botao "Solicitar Reembolso" na sidebar do ticket abre dialog
- [ ] Dialog com campos: valor (obrigatorio, Decimal), boleto vinculado (dropdown dos boletos do cliente, opcional), comprovante de pagamento (upload obrigatorio, tipo PAYMENT_PROOF), justificativa (textarea obrigatoria)
- [ ] Ao salvar: cria Refund com status AWAITING_APPROVAL, calcula slaDeadline baseado em SlaConfig
- [ ] Tag "Reembolso" adicionada automaticamente ao ticket
- [ ] Evento registrado na timeline do ticket: "Reembolso #REF-{id} - Solicitado | Por: {nome} | R$ {valor}"
- [ ] Server action `requestRefund(ticketId, companyId, amount, justification, paymentProofId, boletoId?)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-072: Aprovar ou rejeitar reembolso
**Descricao:** Como gestor/admin, quero aprovar ou rejeitar solicitacoes de reembolso para controlar as devolucoes de valores.

**Criterios de Aceite:**
- [ ] Card de reembolso pendente na sidebar do ticket mostra: solicitante, data, valor, boleto, justificativa, link para comprovante, botoes "Aprovar" e "Rejeitar"
- [ ] Ao rejeitar: dialog pede motivo (obrigatorio). Status -> REJECTED. Evento na timeline
- [ ] Ao aprovar: status -> APPROVED. Evento na timeline. SLA de execucao inicia
- [ ] Somente usuarios com role ADMIN ou MANAGER podem aprovar/rejeitar
- [ ] Server actions: `approveRefund(refundId, companyId)`, `rejectRefund(refundId, companyId, reason)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-073: Executar reembolso com integracao financeira
**Descricao:** Como financeiro, quero executar o reembolso registrando metodo de pagamento, dados bancarios, acao sobre NFS-e e comprovante para concluir o processo com integracao automatica no financeiro.

**Criterios de Aceite:**
- [ ] Card de reembolso aprovado na sidebar mostra botao "Executar Reembolso"
- [ ] Dialog com campos: metodo (PIX/TED), chave PIX (se PIX) ou banco/agencia/conta (se TED), acao NFS-e (Cancelar NFS-e / Emitir nota de credito / Nenhuma), motivo cancelamento/credito (se aplicavel), comprovante do reembolso (upload obrigatorio, tipo REFUND_PROOF)
- [ ] Ao concluir: status -> COMPLETED. Cria AccountPayable com origin=REFUND, supplier=nome do cliente, description="Reembolso #REF-{id} ref. Ticket #{ticketId}", value=amount, marca como PAID com paidAt=agora
- [ ] Se acao NFS-e = Cancelar: atualiza Invoice vinculada com status CANCELLED, cancelledAt, cancellationReason, refundId
- [ ] Se acao NFS-e = Nota de credito: cria nova Invoice com type=CREDIT_NOTE, originalInvoiceId, refundId, valor negativo
- [ ] Se houver AccountReceivable pendente vinculado ao boleto: cancela (status CANCELLED)
- [ ] Evento na timeline: "Reembolso #REF-{id} - Concluido | Por: {nome} | {metodo} | NFS-e: {acao}"
- [ ] Server action `executeRefund(refundId, companyId, paymentMethod, bankData, invoiceAction, invoiceCancelReason?, refundProofId)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-074: Solicitar cancelamento de proposta/boleto
**Descricao:** Como atendente, quero solicitar o cancelamento de propostas e boletos a partir do ticket quando o cliente pede para parar de receber cobranças.

**Criterios de Aceite:**
- [ ] Botao "Solicitar Cancelamento" na sidebar do ticket abre dialog
- [ ] Dialog com opcoes: cancelar proposta vinculada, cancelar boletos pendentes, ou ambos. Justificativa (textarea obrigatoria)
- [ ] Ao solicitar: cria registro pendente de aprovacao (mesmo modelo do reembolso ou registro simples)
- [ ] Gestor/Admin aprova: Proposal status -> CANCELLED (adicionar ao enum se nao existir), AccountReceivable pendentes -> CANCELLED
- [ ] Evento registrado na timeline como prova
- [ ] Server action `requestCancellation(ticketId, companyId, cancelProposal, cancelReceivables, justification)`
- [ ] Audit log
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: SLA — Verificacao e Alertas

#### US-075: Calculo e atribuicao de SLA ao criar/atualizar ticket
**Descricao:** Como sistema, preciso calcular e atribuir deadlines de SLA automaticamente ao criar tickets e registrar quando SLA e cumprido.

**Criterios de Aceite:**
- [ ] Ao criar ticket: busca SlaConfig da empresa para a prioridade do ticket. Calcula slaFirstReply e slaResolution baseado em deadlineMinutes. Se horario comercial ativo, calcula considerando apenas horas uteis
- [ ] Ao registrar primeira resposta (primeiro TicketMessage OUTBOUND): marca slaFirstReply como cumprido (campo ou calculo)
- [ ] Ao resolver ticket (status RESOLVED): marca slaResolution como cumprido
- [ ] Helper `erp/src/lib/sla.ts` com funcoes: `calculateSlaDeadline(startTime, minutes, businessHours?)`, `isSlaBreached(deadline)`, `getSlaStatus(deadline)` retorna 'ok' | 'at_risk' | 'breached'
- [ ] Typecheck/lint passa

#### US-076: Worker de verificacao de SLA
**Descricao:** Como sistema, preciso verificar periodicamente os deadlines de SLA e marcar tickets/reembolsos em risco ou estourados para alertar a equipe.

**Criterios de Aceite:**
- [ ] Worker BullMQ na fila `sla-check` executando a cada 1 minuto
- [ ] Busca tickets abertos com slaFirstReply ou slaResolution proximo do deadline
- [ ] Se tempo restante <= alertBeforeMinutes: ticket marcado como "em risco" (campo calculado ou flag)
- [ ] Se deadline passou: slaBreached = true
- [ ] Mesma verificacao para Refund.slaDeadline
- [ ] Registra log de SLA breach
- [ ] Typecheck/lint passa

#### US-077: Alertas visuais de SLA na interface
**Descricao:** Como atendente, quero ver alertas visuais claros quando tickets estao com SLA em risco ou estourado para priorizar meu atendimento.

**Criterios de Aceite:**
- [ ] Badge vermelho no item "SAC > Tickets" do menu lateral com contagem de tickets SLA critico
- [ ] Banner no topo da lista de tickets: "X tickets com SLA estourado | Y tickets em risco" com link para aba SLA Critico
- [ ] Sidebar do ticket: SLA card com barra de progresso (verde < 70%, amarelo 70-90%, vermelho > 90%), tempo restante, prazo
- [ ] Server action `getSlaAlertCounts(companyId)` retorna { breached: number, atRisk: number }
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Exportacao PDF

#### US-078: Exportar ticket completo como PDF
**Descricao:** Como atendente, quero exportar o ticket completo como PDF para usar como documento de evidencia em processos de reembolso, cancelamento ou disputas.

**Criterios de Aceite:**
- [ ] Botao "Exportar PDF" na sidebar do ticket com checkboxes: "Incluir notas internas", "Incluir preview de anexos"
- [ ] PDF gerado com biblioteca (ex: @react-pdf/renderer ou puppeteer) contendo:
  - Cabecalho: nome da empresa, "Relatorio de Atendimento SAC", ID ticket, data geracao
  - Informacoes: assunto, cliente (nome + CNPJ), prioridade, status, responsavel, canal origem, datas criacao/resolucao, tempo total
  - SLA: tempos cumpridos vs prazos com indicadores
  - Vinculos: proposta e boleto (se houver)
  - Historico completo: mensagens numeradas em ordem cronologica com data/hora, canal, direcao, remetente/destinatario, origem, conteudo, anexos com preview (se opcao marcada), notas internas (se opcao marcada) com marcacao "Nota Interna", mudancas de status, eventos de reembolso
  - Reembolso (se houver): dados completos, NFS-e, comprovantes
  - Lista de anexos: indice com nome, tamanho, mensagem de origem
  - Rodape: timestamp geracao, declaracao de fidelidade, paginacao
- [ ] Download automatico do PDF ao gerar
- [ ] Server action `generateTicketPDF(ticketId, companyId, options: { includeInternalNotes, includeAttachmentPreviews })`
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Integracao Financeira na Sidebar

#### US-079: Situacao financeira do cliente na sidebar do ticket
**Descricao:** Como atendente, quero ver a situacao financeira do cliente direto na sidebar do ticket para ter contexto ao atender.

**Criterios de Aceite:**
- [ ] Secao "Situacao Financeira" na sidebar do ticket
- [ ] Badge de classificacao: "Adimplente" (verde, sem vencidos), "Em Atraso" (amarelo, vencidos <= 30d), "Inadimplente" (vermelho, vencidos > 30d)
- [ ] Valores: total pendente (soma AccountReceivable PENDING), total vencido (soma AccountReceivable OVERDUE), data e valor do ultimo pagamento (AccountReceivable PAID mais recente)
- [ ] Link "Ver financeiro" direciona para `/financeiro/receber` filtrado pelo cliente
- [ ] Server action `getClientFinancialSummary(clientId, companyId)` retorna { status, pendingTotal, overdueTotal, lastPayment: { date, amount } | null }
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

#### US-080: Badge SAC nas contas a pagar geradas por reembolso
**Descricao:** Como financeiro, quero identificar facilmente contas a pagar geradas por reembolsos do SAC e acessar o ticket relacionado.

**Criterios de Aceite:**
- [ ] Na lista de contas a pagar (`/financeiro/pagar`): coluna "Origem" mostra "Manual" ou badge "SAC" clicavel
- [ ] Clicar no badge "SAC" navega para o ticket vinculado (`/sac/tickets/{id}`)
- [ ] Server action `listPayables` atualizada para incluir campo origin e refundId nos resultados
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

### Modulo: Timeline do Cliente (Atualizacao)

#### US-081: Expandir timeline do cliente com WhatsApp e contatos
**Descricao:** Como atendente, quero ver mensagens de WhatsApp e identificar qual contato interagiu na timeline do cliente para ter visao completa do relacionamento.

**Criterios de Aceite:**
- [ ] Timeline na pagina do cliente (`/comercial/clientes/[id]`) expandida com nova aba "WhatsApp"
- [ ] Cada item da timeline mostra qual contato interagiu (nome + cargo se AdditionalContact)
- [ ] Tickets com tag "Reembolso" mostram badge na timeline
- [ ] Server action `getClientTimeline` atualizada para incluir mensagens WhatsApp e nome do contato
- [ ] Typecheck/lint passa
- [ ] Verificar no browser

---

## 4. Functional Requirements

- FR-1: Redis deve estar disponivel no ambiente de desenvolvimento via devcontainer
- FR-2: BullMQ deve gerenciar 5 filas: email-inbound, email-outbound, whatsapp-inbound, whatsapp-outbound, sla-check
- FR-3: Evolution API deve rodar via Docker Compose e ser acessivel em localhost:8080
- FR-4: Tabela Client NAO deve ser alterada. Contatos extras vao na tabela AdditionalContact
- FR-5: Canais de comunicacao sao configurados por empresa (Company -> Channel[])
- FR-6: Credenciais de canais (IMAP/SMTP/Evolution API) devem ser encriptadas no campo Json
- FR-7: Upload de arquivos limitado a 10MB, tipos: PDF, PNG, JPG, JPEG, GIF, DOC, DOCX, XLS, XLSX, CSV, TXT
- FR-8: Mensagens recebidas devem ser identificadas automaticamente buscando em Client.email/telefone e AdditionalContact.email/whatsapp
- FR-9: Se cliente identificado com ticket aberto, mensagem e agrupada no ticket existente. Senao, cria novo ticket
- FR-10: Se remetente nao identificado, ticket criado com tag "Pendente Vinculacao"
- FR-11: Mensagens enviadas fora do ERP (WhatsApp Web, Gmail celular) devem ser capturadas e registradas com origin=EXTERNAL
- FR-12: Deduplicacao em 3 camadas: UID tracking, unique constraint [externalId, channel], upsert
- FR-13: IMAP polling monitora Inbox E pasta Sent/Enviados
- FR-14: Notas internas visíveis somente para equipe (isInternal=true), NAO aparecem nas abas Email/WhatsApp
- FR-15: SLA calculado considerando horario comercial quando configurado
- FR-16: Worker SLA roda a cada 1 minuto verificando deadlines
- FR-17: Reembolso segue workflow: AWAITING_APPROVAL -> APPROVED -> PROCESSING -> COMPLETED (ou REJECTED)
- FR-18: Reembolso aprovado cria AccountPayable com origin=REFUND
- FR-19: Reembolso pode cancelar NFS-e existente ou emitir nota de credito (Invoice tipo CREDIT_NOTE)
- FR-20: PDF exportado deve conter historico completo, numerado, cronologico, com todos os anexos, notas e eventos
- FR-21: Situacao financeira do cliente (adimplente/atraso/inadimplente) visivel na sidebar do ticket
- FR-22: Contas a pagar geradas por reembolso mostram badge "SAC" clicavel na lista financeira

---

## 5. Non-Goals (Out of Scope)

- Chatbot ou respostas automaticas por IA
- Integracao com outros canais alem de Email e WhatsApp (Telegram, SMS, etc.)
- App mobile nativo para atendentes
- Integracao com plataformas de telefonia (VoIP, call center)
- Dashboard em tempo real com WebSocket (polling e suficiente)
- Notificacoes push ou por email para atendentes (somente alertas na UI)
- Relatorios avancados de performance de atendimento (pode ser fase futura)
- Templates de resposta rapida
- Regras de auto-atribuicao de tickets
- Merge de tickets duplicados
- Base de conhecimento / FAQ

---

## 6. Design Considerations

- Reusar componentes Shadcn/UI existentes: Dialog, Select, Table, Button, Card, Badge, Tabs
- Cards de KPI no mesmo estilo do dashboard principal (`/dashboard`)
- Graficos de barras usando biblioteca ja disponivel no projeto (se houver) ou Recharts
- Layout do ticket detail: grid 2/3 + 1/3 (ja existente, expandir)
- Timeline: icones Lucide React, cores consistentes com badges existentes (red=alta, yellow=media, blue=baixa)
- Aba WhatsApp: estilo chat com baloes, inspirado no WhatsApp Web
- Aba Email: estilo thread, inspirado no Gmail
- Notas internas: fundo `bg-yellow-50`, borda `border-yellow-200`, icone `Lock` do Lucide
- SLA barra de progresso: verde (`bg-green-500`), amarelo (`bg-yellow-500`), vermelho (`bg-red-500`)
- PDF: layout profissional com cabecalho da empresa, secoes claras, fonte legivel

---

## 7. Technical Considerations

- **Redis**: Adicionar ao devcontainer como feature ou servico Docker
- **BullMQ**: Workers rodam em processo separado (script npm dedicado) para nao bloquear o Next.js
- **Evolution API**: Docker Compose separado ou adicionado ao devcontainer
- **IMAP**: Usar biblioteca `imapflow` (moderna, Promise-based) para conexao IMAP
- **SMTP**: Usar `nodemailer` (ja pode estar no projeto) para envio
- **File Storage**: Diretorio local `erp/uploads/` por enquanto. Estrutura `{companyId}/{ano-mes}/{filename}` para organizacao
- **PDF**: Usar `@react-pdf/renderer` (React-based, funciona no servidor) ou `puppeteer` para gerar PDFs
- **Prisma**: Todas as novas tabelas e campos adicionados em uma unica migration ou em migrations sequenciais
- **Unique constraint**: `@@unique([externalId, channel])` no TicketMessage para deduplicacao. O externalId pode ser null (mensagens manuais), o constraint so se aplica quando ambos nao-null
- **Volume**: ~100 tickets/empresa/dia. Com 10 empresas = 1000 tickets/dia. BullMQ + Redis lida facilmente
- **Seguranca**: Credenciais de canais (senhas IMAP, API keys) devem ser encriptadas antes de salvar no Json. Usar `crypto.createCipheriv` com chave do .env

---

## 8. Success Metrics

- Tickets criados automaticamente a partir de Email/WhatsApp sem intervencao manual
- Tempo medio de criacao de ticket reduzido de minutos (manual) para segundos (automatico)
- 100% das mensagens (inclusive fora do ERP) capturadas no historico do ticket
- Zero mensagens duplicadas gracas a deduplicacao em 3 camadas
- PDF exportado aceito como documento de evidencia (historico completo, cronologico, imutavel)
- Reembolso refletido automaticamente no Financeiro (conta a pagar, NFS-e, DRE)
- SLA monitorado com alertas visiveis para tickets em risco

---

## 9. Open Questions

- Qual biblioteca de PDF usar? `@react-pdf/renderer` (mais leve) vs `puppeteer` (mais flexivel mas pesado)?
- Evolution API: qual versao usar? v1 ou v2? Precisa definir imagem Docker exata
- Encriptacao de credenciais: usar chave simetrica (AES) com segredo no .env, ou solucao mais robusta?
- IMAP: qual intervalo ideal de polling? 2 min pode ser muito para volume alto, 5 min pode ser aceitavel
- Horario comercial do SLA: feriados devem ser considerados? Se sim, precisa de tabela de feriados
- Reembolso: valor maximo sem aprovacao? Ou todo reembolso precisa de aprovacao independente do valor?
