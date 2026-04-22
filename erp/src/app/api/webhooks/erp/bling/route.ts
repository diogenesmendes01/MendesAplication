import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';

export async function POST(req: NextRequest) {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read body' }, { status: 500 });
  }

  const signature = req.headers.get('x-bling-signature-256');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  // Buscar todos os providers Bling ativos e tentar validar assinatura com cada um.
  // O campo companyId no payload do Bling é um hash opaco interno — NÃO é o nosso
  // companyId. Por isso testamos o HMAC com todos os providers ativos.
  const activeProviders = await prisma.erpProvider.findMany({
    where: { provider: 'bling', isActive: true },
  });

  let matchedProvider: (typeof activeProviders)[number] | null = null;

  for (const p of activeProviders) {
    try {
      const creds = JSON.parse(decrypt(p.credentials)) as { clientSecret?: string };
      if (creds.clientSecret && verifyBlingSignature(signature, body, creds.clientSecret)) {
        matchedProvider = p;
        break;
      }
    } catch {
      // Provider com credentials corrompidas — continua tentando os demais
    }
  }

  if (!matchedProvider) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: { event?: string; data?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Fire-and-forget — retorna 200 imediatamente para o Bling não retentar
  processEvent(matchedProvider.id, payload).catch(err =>
    console.error('[bling-webhook] processEvent error:', err)
  );

  return NextResponse.json({ ok: true });
}

function verifyBlingSignature(
  signature: string,
  payload: string,
  clientSecret: string
): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex')}`;

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

async function processEvent(
  providerId: string,
  payload: { event?: string; data?: unknown }
): Promise<void> {
  console.info(`[bling-webhook] event=${payload.event} provider=${providerId}`);
  // TODO: handler por tipo de evento (order.created, product.updated, etc.)
}
