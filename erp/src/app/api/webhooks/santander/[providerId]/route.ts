import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getGateway } from "@/lib/payment/factory";
import type { WebhookEvent } from "@/lib/payment/types";
import { processBoletoWebhookEvent } from "@/lib/payment/webhook-handler";

// ---------------------------------------------------------------------------
// POST /api/webhooks/santander/[providerId]
//
// Santander-specific webhook receiver. Validates that providerId is a real,
// active Santander provider before processing. Delegates boleto/receivable
// update logic to the shared webhook-handler helper.
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;

  console.log(`[santander-webhook] Received webhook for providerId: ${providerId}`);

  // 1. Read raw body — return 500 on failure to force Santander retry
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[santander-webhook] Failed to read request body:", err);
    return NextResponse.json({ error: "body_read_failed" }, { status: 500 });
  }

  // 2. Extract headers as plain object
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // 3. Validate providerId exists and is an active Santander provider
  const provider = await prisma.paymentProvider.findFirst({
    where: {
      id: providerId,
      provider: "santander",
      isActive: true,
    },
  });

  if (!provider) {
    console.warn(
      `[santander-webhook] No active Santander provider found for id: ${providerId}`,
    );
    // Return 200 to avoid infinite retries from Santander
    return NextResponse.json(
      { received: true, error: "provider_not_found" },
      { status: 200 },
    );
  }

  // 4. Instantiate gateway and validate webhook
  let gateway: ReturnType<typeof getGateway>;
  try {
    const decryptedCredentials = JSON.parse(
      decrypt(provider.credentials),
    ) as Record<string, unknown>;

    const metadata = provider.metadata as Record<string, unknown> | null;

    gateway = getGateway(
      "santander",
      decryptedCredentials,
      metadata,
      provider.webhookSecret ? decrypt(provider.webhookSecret) : undefined,
      { sandbox: provider.sandbox, companyId: provider.companyId },
    );
  } catch (err) {
    console.error(
      `[santander-webhook] Error instantiating provider ${providerId}:`,
      err,
    );
    return NextResponse.json(
      { received: true, error: "provider_init_failed" },
      { status: 200 },
    );
  }

  // 5. Validate the webhook request
  if (!gateway.validateWebhook(headers, rawBody)) {
    console.warn(
      `[santander-webhook] Validation failed for provider ${providerId}`,
    );
    return NextResponse.json(
      { error: "invalid_webhook" },
      { status: 400 },
    );
  }

  // 6. Parse the webhook event
  let event: WebhookEvent | null;
  try {
    event = gateway.parseWebhookEvent(rawBody);
  } catch (err) {
    console.error("[santander-webhook] Failed to parse webhook event:", err);
    return NextResponse.json(
      { received: true, error: "parse_error" },
      { status: 200 },
    );
  }

  // If provider returned null (unknown event type), acknowledge and skip
  if (!event) {
    return NextResponse.json(
      { received: true, skipped: "unknown_event_type" },
      { status: 200 },
    );
  }

  console.log(
    `[santander-webhook] Event parsed: type=${event.type}, gatewayId=${event.gatewayId}`,
  );

  // 7. Process boleto + receivable update via shared handler
  const result = await processBoletoWebhookEvent(
    event,
    provider.id,
    provider.companyId,
    "santander-webhook",
  );

  if (!result.processed) {
    console.log(
      `[santander-webhook] Event not processed: ${result.reason}` +
        (result.boletoId ? ` (boleto: ${result.boletoId})` : ""),
    );
    return NextResponse.json(
      { received: true, skipped: result.reason },
      { status: 200 },
    );
  }

  console.log(
    `[santander-webhook] Boleto ${result.boletoId} updated: ${result.previousStatus} → ${result.newStatus}` +
      (result.accountReceivableId ? ` | AR ${result.accountReceivableId} → PAID` : ""),
  );

  // 8. Return 200 OK to Santander to confirm receipt
  return NextResponse.json({ received: true }, { status: 200 });
}
