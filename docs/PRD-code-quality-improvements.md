# PRD — Iniciativa de Qualidade de Código MendesAplication

**Autor:** Engenharia
**Data:** 2026-04-07
**Status:** Draft
**Documento base:** `.claude/plans/vast-petting-hejlsberg.md`

---

## 1. Resumo Executivo

Iniciativa técnica para endereçar 16 pontos de melhoria identificados em auditoria de código, com foco em reduzir riscos de produção (race conditions, falhas silenciosas, duplicação de cobranças) e aumentar manutenibilidade (type safety, cobertura de testes, logging estruturado).

## 2. Problema

A auditoria identificou padrões recorrentes que ameaçam estabilidade e evolução do produto:

- **Risco financeiro direto:** providers de pagamento (Vindi, Cobre Fácil, Lytex, Santander) têm race conditions de autenticação e falta de idempotency keys, podendo causar cobranças duplicadas.
- **Risco operacional:** 15+ `catch` silenciosos em workers tornam falhas em produção invisíveis/impossíveis de debugar.
- **Risco de segurança:** webhooks sem validação HMAC (Cobre Fácil) permitem spoofing.
- **Dívida técnica crescente:** 19 casts inseguros (`as unknown as`/`as any`), 23 arquivos com `eslint-disable` blanket, cobertura de testes ~18%.
- **Risco de memória:** processamento de anexos sem streaming pode carregar até 50 MB em RAM por job.

## 3. Objetivos

### Objetivos de Negócio
- Zero incidentes de cobrança duplicada atribuíveis a race condition ou retry.
- Reduzir MTTR de bugs em produção em 50% via logging estruturado.
- Aumentar confiança para shipping em áreas críticas (pagamento, NFSe, AI workflows).

### Objetivos Técnicos
- 0 ocorrências de `as any`/`as unknown as` sem validação runtime em módulos críticos.
- 0 `catch` silencioso em workers.
- 100% dos providers de pagamento com idempotency key e webhook signature.
- Cobertura de testes ≥ 40% nos módulos `payment/`, `workers/`, `ai/workflow*`.

### Não-Objetivos
- Reescrita de arquitetura.
- Migração de framework/biblioteca.
- Mudanças de UI/UX.
- Novas features.

## 4. Métricas de Sucesso

| Métrica | Baseline | Meta |
|---|---|---|
| Cobranças duplicadas/mês | (a medir) | 0 |
| `as any`/`as unknown as` em módulos críticos | 19 | 0 |
| Arquivos com `eslint-disable` blanket | 23 | ≤ 3 (com justificativa) |
| Catches silenciosos em workers | 15+ | 0 |
| Cobertura de testes (workers/payment/ai) | ~18% | ≥ 40% |
| Providers com webhook signature validado | 1/4 | 4/4 |
| BUG markers no código | 3 | 0 (migrados para issues) |

## 5. Escopo

### In Scope — Fase 1 (Alta Prioridade) 🔴

**F1.1 — Idempotência e Segurança de Providers de Pagamento**
- Adicionar idempotency-key em `src/lib/payment/providers/vindi.provider.ts:222`.
- Implementar validação HMAC em webhook `src/lib/payment/providers/cobrefacil.provider.ts:351`.
- Auditar `lytex.provider.ts:90` e Santander para mesma prática.
- **Critério de aceite:** retry de request timeout não cria duplicata; webhook spoofado é rejeitado com 401.

**F1.2 — Race Condition em Auth Tokens**
- Implementar pending-promise pattern (singleflight) em:
  - `src/lib/payment/providers/cobrefacil-auth.ts:46`
  - `src/lib/payment/providers/lytex-auth.ts:49`
  - `src/lib/payment/providers/santander-auth.ts`
- **Critério de aceite:** N requests concorrentes com token expirado → 1 única chamada a `/authenticate`. Teste de concorrência cobre o caso.

**F1.3 — Eliminar Catches Silenciosos**
- Auditar e corrigir todos os catches em:
  - `src/lib/workers/email-inbound.ts`
  - `src/lib/workers/reclameaqui-inbound.ts` (linhas 668, 840, 957)
  - `src/lib/workers/attachment-extraction.ts` (linhas 150, 202, 260, 289, 305, 327, 383, 591)
- **Critério de aceite:** cada catch loga via `logger.error` com contexto (job id, entity id, operação). Lint rule bloqueia catches sem log.

**F1.4 — Streaming de Anexos**
- Refatorar `src/lib/workers/attachment-extraction.ts` para processar anexos via stream.
- Remover `eslint-disable` blanket no topo do arquivo.
- **Critério de aceite:** pico de memória por job não escala linearmente com tamanho do anexo; teste com arquivo de 40 MB fica < 100 MB de RAM.

**F1.5 — Type Safety em Módulos Críticos**
- Introduzir schemas Zod para validar boundaries em:
  - `src/lib/ai/workflow-blocks.ts:162,197` (acesso dinâmico a Prisma models)
  - `src/lib/ai/workflow-engine.ts`, `workflow-types.ts` (stepData)
  - `src/lib/ai/audit-trail.ts`, `feedback-capture.ts`, `recovery.ts`, `suggestion-mode.ts`, `tool-executor.ts`
  - `src/lib/email-actions.ts`, `src/lib/nfse-actions.ts`
  - `src/lib/payment/providers/santander.provider.ts`
- **Critério de aceite:** 0 `as any`/`as unknown as` nesses arquivos; dados inválidos lançam erro tipado e logado.

### In Scope — Fase 2 (Média Prioridade) 🟡

**F2.1 — Logging Estruturado Unificado**
- Substituir `console.*` em:
  - `src/hooks/use-event-stream.ts:31`
  - `src/app/global-error.tsx:13`
  - `src/instrumentation.ts:21`
  - `src/app/(app)/error.tsx`
  - `src/app/(app)/comercial/propostas/[id]/page.tsx:355,383`
- Estender `classifyError` em `src/lib/logger.ts:97-146` com classifiers de domínio (Vindi, NFSe).

**F2.2 — Remover `eslint-disable` Blankets**
- Arquivos-alvo: `attachment-extraction.ts`, `with-api-logging.ts:17`, testes de workflow.
- Substituir por disables pontuais com comentário justificando.

**F2.3 — Refatorar NFSe Providers**
- Extrair helper compartilhado para `rpsNumero` em:
  - `src/lib/nfse/campinas.provider.ts:73`
  - `src/lib/nfse/saopaulo.provider.ts:363`
  - `src/lib/nfse/taboao.provider.ts:280`

**F2.4 — Migrar BUG Markers para Issues**
- Criar issues GitHub para:
  - `src/lib/nfse-actions.ts:213` (BUG 9)
  - `src/app/(app)/comercial/propostas/[id]/page.tsx:542,714` (BUG 3/4/5)
- Remover comentários do código ao abrir issue.

**F2.5 — Aumentar Cobertura de Testes**
- Alvo prioritário: `workflow-engine.ts`, providers de pagamento.
- Meta: subir cobertura dos módulos críticos para ≥ 40%.

**F2.6 — Config Hardcoded**
- `src/lib/payment/providers/cobrefacil.provider.ts:186` — mover endereço placeholder para metadata por empresa.

### In Scope — Fase 3 (Baixa Prioridade) 🟢

**F3.1** — Remover `src/components/sidebar.old.tsx` após confirmar não-uso.
**F3.2** — Adicionar `readonly` em params de objeto onde aplicável (ex: `getCompanyBranding`).
**F3.3** — Revisar `SENSITIVE_KEYS` em `src/lib/logger.ts:160-177` — decisão explícita sobre email/telefone conforme política LGPD.
**F3.4** — Completar `.env.example` com `LOG_LEVEL`, `NFE_DEBUG`, feature flags de canais AI.

### Out of Scope
- Refatoração de componentes de UI.
- Mudanças no schema Prisma.
- Novos providers de pagamento ou NFSe.
- Migração de Next.js/React.

## 6. Requisitos Funcionais

**RF-01** — Providers de pagamento DEVEM enviar idempotency-key em operações de criação de cobrança.
**RF-02** — Webhooks de providers DEVEM validar assinatura antes de processar payload.
**RF-03** — Auth tokens DEVEM ser refreshados por singleflight (no máximo 1 request concorrente ao endpoint `/authenticate`).
**RF-04** — Todos os `catch` em workers DEVEM logar erro com contexto estruturado.
**RF-05** — Processamento de anexos DEVE usar streams para arquivos > 5 MB.
**RF-06** — Dados lidos de fontes não-tipadas (Prisma JSON, webhooks, external APIs) DEVEM ser validados com Zod.

## 7. Requisitos Não-Funcionais

- **Performance:** regressão < 5% em latência P95 de endpoints afetados.
- **Compatibilidade:** nenhuma breaking change em APIs públicas/webhooks.
- **Observabilidade:** todos os novos logs seguem schema do logger estruturado.
- **Segurança:** validação de webhook signature rejeita request inválido sem logar payload sensível.

## 8. Plano de Rollout

| Fase | Escopo | Dependências |
|---|---|---|
| Fase 1 | F1.1 → F1.5 (Alta) | Nenhuma |
| Fase 2 | F2.1 → F2.6 (Média) | Fase 1 parcial (F1.3 habilita F2.1) |
| Fase 3 | F3.1 → F3.4 (Baixa) | Nenhuma |

Cada fase deve ser mergeada em PRs independentes e pequenos por item. Fase 1 é bloqueante para deploys em janelas de risco de cobrança.

## 9. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Regressão em providers de pagamento ao introduzir idempotency-key | Alto | Testes de integração em sandbox de cada provider antes de merge |
| Mudança de shape de stepData quebra workflows existentes | Alto | Migração com fallback; Zod com `.safeParse` + logging antes de enforce |
| Logging verboso vaza PII | Médio | Revisar `SENSITIVE_KEYS` antes de F2.1 (adiantar F3.3) |
| Aumento de cobertura de testes trava por dependências externas | Médio | Usar MSW/nock para mockar HTTP; evitar mocks de Prisma |

## 10. Critérios de Aceitação Globais

- [ ] Todas as metas da tabela de métricas atingidas.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` passam sem warnings novos.
- [ ] Zero cobrança duplicada em staging durante teste de carga com retries forçados.
- [ ] Runbook de debug atualizado para novos logs estruturados.

## 11. Perguntas em Aberto

1. Qual é a baseline real de cobranças duplicadas/mês? (Precisa de métrica antes de declarar sucesso.)
2. Política oficial de LGPD sobre email/telefone em logs — precisa de confirmação jurídica.
3. Existe contrato/SLA com providers sobre retry-safe operations que permita validar idempotency-key server-side?
4. Santander provider tem sandbox disponível para testes de race condition?

## 12. Referências

- Documento de auditoria: `.claude/plans/vast-petting-hejlsberg.md`
- Logger estruturado: `src/lib/logger.ts`
- Histórico de incidentes de cobrança: (a anexar)
