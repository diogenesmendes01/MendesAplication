import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Params = { companyId: string; id: string };

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  await prisma.erpProvider.delete({
    where: { id: params.id, companyId: params.companyId },
  });
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const body = await req.json() as { isActive?: boolean; name?: string };

  const updated = await prisma.erpProvider.update({
    where: { id: params.id, companyId: params.companyId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
    select: { id: true, isActive: true, name: true },
  });

  return NextResponse.json({ data: updated });
}
