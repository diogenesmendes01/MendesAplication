import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encrypt } from '@/lib/encryption';
import { isErpProviderType } from '@/lib/erp/registry';

type Params = { companyId: string };

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const providers = await prisma.erpProvider.findMany({
    where: { companyId: params.companyId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, provider: true, baseUrl: true,
      storeId: true, sandbox: true, isActive: true,
      lastSyncAt: true, syncStatus: true, createdAt: true,
    },
  });
  return NextResponse.json({ data: providers });
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const body = await req.json() as {
    name: string;
    provider: string;
    credentials: Record<string, string>;
    storeId?: string;
    sandbox?: boolean;
  };

  if (!isErpProviderType(body.provider)) {
    return NextResponse.json({ error: `Provider inválido: ${body.provider}` }, { status: 400 });
  }

  const provider = await prisma.erpProvider.create({
    data: {
      companyId: params.companyId,
      name: body.name,
      provider: body.provider,
      credentials: encrypt(JSON.stringify(body.credentials)),
      storeId: body.storeId,
      sandbox: body.sandbox ?? false,
    },
  });

  return NextResponse.json({ data: { id: provider.id } }, { status: 201 });
}
