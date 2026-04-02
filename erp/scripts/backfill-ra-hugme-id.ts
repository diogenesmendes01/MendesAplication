/**
 * Backfill script: popula raHugmeId para tickets RA que ainda não têm o campo.
 *
 * Contexto: o campo raHugmeId foi adicionado na migration 20260401000000.
 * Tickets sincronizados antes dessa data têm raHugmeId = NULL.
 * A API do RA espera o ID interno HugMe (não o source_external_id),
 * então o outbound worker falha com erro 4040 nesses tickets.
 *
 * O que este script faz:
 *   1. Busca todos os tickets com raExternalId IS NOT NULL e raHugmeId IS NULL
 *   2. Para cada ticket, chama getTickets({ source_external_id }) para obter o HugMe ID
 *   3. Atualiza o ticket no banco com raHugmeId = raTicket.id.toString()
 *   4. Lida com erros gracefully (ticket deletado no RA → loga e continua)
 *   5. Rate limiting: 100ms entre chamadas por client
 *
 * Como executar:
 *   cd erp && npx ts-node -r tsconfig-paths/register --project tsconfig.scripts.json scripts/backfill-ra-hugme-id.ts
 *
 * (A flag --project tsconfig.json não funciona com moduleResolution: "bundler" + ts-node.
 *  Use tsconfig.scripts.json que faz override para module: "commonjs")
 */

import { PrismaClient } from "@prisma/client";
import { decryptConfig } from "../src/lib/encryption";
import { ReclameAquiClient, ReclameAquiError } from "../src/lib/reclameaqui/client";
import type { RaClientConfig } from "../src/lib/reclameaqui/types";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

const RATE_LIMIT_MS = 100; // 100ms entre chamadas por client

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Buscando tickets com raExternalId preenchido e raHugmeId vazio...");

  const tickets = await prisma.ticket.findMany({
    where: {
      raExternalId: { not: null },
      raHugmeId: null,
    },
    select: {
      id: true,
      raExternalId: true,
      channelId: true,
      channel: {
        select: {
          id: true,
          config: true,
          isActive: true,
          type: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const total = tickets.length;
  console.log(`📋 Encontrados ${total} tickets para backfill.\n`);

  if (total === 0) {
    console.log("✅ Nenhum ticket precisa de backfill. Encerrando.");
    return;
  }

  let updated = 0;
  let errors = 0;

  // Agrupar por channelId para reutilizar o mesmo client (e respeitar rate limit por client)
  const ticketsByChannel = new Map<
    string,
    (typeof tickets)[number][]
  >();

  for (const ticket of tickets) {
    if (!ticket.channel || ticket.channel.type !== "RECLAMEAQUI" || !ticket.channel.isActive) {
      console.warn(
        `⚠️  [${updated + errors + 1}/${total}] Ticket ${ticket.id} sem canal RA ativo — pulando`
      );
      errors++;
      continue;
    }

    const channelId = ticket.channel.id;
    if (!ticketsByChannel.has(channelId)) {
      ticketsByChannel.set(channelId, []);
    }
    ticketsByChannel.get(channelId)!.push(ticket);
  }

  // Processar por canal
  for (const [channelId, channelTickets] of Array.from(ticketsByChannel.entries())) {
    const firstTicket = channelTickets[0]!;
    const channelConfig = firstTicket.channel!;

    // Decriptar credenciais
    let client: ReclameAquiClient;
    try {
      const config = decryptConfig(
        channelConfig.config as Record<string, unknown>
      ) as unknown as RaClientConfig;

      if (!config.clientId || !config.clientSecret || !config.baseUrl) {
        console.error(`❌ Canal ${channelId} sem credenciais RA completas — pulando ${channelTickets.length} tickets`);
        errors += channelTickets.length;
        continue;
      }

      client = new ReclameAquiClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        baseUrl: config.baseUrl,
      });

      // Autenticar uma vez por canal
      await client.authenticate();
      console.log(`🔑 Canal ${channelId}: autenticado (${channelTickets.length} tickets)`);
    } catch (err) {
      console.error(`❌ Falha ao autenticar canal ${channelId}:`, err instanceof Error ? err.message : err);
      errors += channelTickets.length;
      continue;
    }

    // Processar cada ticket do canal
    for (const ticket of channelTickets) {
      const processed = updated + errors + 1;
      const label = `[${processed}/${total}] Ticket ${ticket.id} (raExternalId: ${ticket.raExternalId})`;

      try {
        const response = await client.getTickets({
          source_external_id: ticket.raExternalId!,
          page_size: 1,
        });

        const raTicket = response?.data?.[0];

        if (!raTicket) {
          console.warn(`⚠️  ${label} — não encontrado no RA (provavelmente deletado)`);
          errors++;
        } else {
          const raHugmeId = raTicket.id.toString();

          await prisma.ticket.update({
            where: { id: ticket.id },
            data: { raHugmeId },
          });

          console.log(`✅ ${label} → raHugmeId = ${raHugmeId}`);
          updated++;
        }
      } catch (err) {
        if (err instanceof ReclameAquiError) {
          console.error(`❌ ${label} — ReclameAquiError (code ${err.code}): ${err.message}`);
        } else {
          console.error(`❌ ${label} — Erro inesperado:`, err instanceof Error ? err.message : err);
        }
        errors++;
      }

      // Rate limiting: 100ms entre chamadas por client
      await sleep(RATE_LIMIT_MS);
    }
  }

  // ---------------------------------------------------------------------------
  // Sumário final
  // ---------------------------------------------------------------------------
  console.log("\n─────────────────────────────────────────");
  console.log(`📊 Backfill concluído:`);
  console.log(`   Total processado : ${total}`);
  console.log(`   ✅ Atualizados   : ${updated}`);
  console.log(`   ❌ Erros/pulados : ${errors}`);
  console.log("─────────────────────────────────────────\n");

  if (errors > 0) {
    console.warn(`⚠️  ${errors} tickets não foram atualizados. Verifique os logs acima.`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error("💥 Erro fatal no backfill:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
