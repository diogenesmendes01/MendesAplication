"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharingGroup {
  id: string;
  name: string;
  createdAt: string;
  companies: { id: string; nomeFantasia: string; cnpj: string }[];
}

export interface CompanyOption {
  id: string;
  nomeFantasia: string;
  cnpj: string;
  sharedClientGroupId: string | null;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

async function _listSharingGroups(): Promise<SharingGroup[]> {
  await requireAdmin();

  const groups = await prisma.sharedClientGroup.findMany({
    include: {
      companies: {
        select: { id: true, nomeFantasia: true, cnpj: true },
        orderBy: { nomeFantasia: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    createdAt: g.createdAt.toISOString(),
    companies: g.companies,
  }));
}

async function _listAvailableCompanies(): Promise<CompanyOption[]> {
  await requireAdmin();

  const companies = await prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      nomeFantasia: true,
      cnpj: true,
      sharedClientGroupId: true,
    },
    orderBy: { nomeFantasia: "asc" },
  });

  return companies;
}

async function _createSharingGroup(
  name: string,
  companyIds: string[]
): Promise<{ id: string }> {
  const session = await requireAdmin();

  if (!name?.trim()) {
    throw new Error("Nome do grupo é obrigatório");
  }
  if (companyIds.length < 2) {
    throw new Error("Selecione pelo menos 2 empresas para compartilhar");
  }

  // Verify none of the companies are already in another group
  const companiesInGroups = await prisma.company.findMany({
    where: {
      id: { in: companyIds },
      sharedClientGroupId: { not: null },
    },
    select: { nomeFantasia: true },
  });

  if (companiesInGroups.length > 0) {
    const names = companiesInGroups.map((c) => c.nomeFantasia).join(", ");
    throw new Error(
      `As seguintes empresas já pertencem a outro grupo: ${names}`
    );
  }

  const group = await prisma.sharedClientGroup.create({
    data: {
      name: name.trim(),
      companies: {
        connect: companyIds.map((id) => ({ id })),
      },
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "SharedClientGroup",
    entityId: group.id,
    dataAfter: {
      name: group.name,
      companyIds,
    } as unknown as Prisma.InputJsonValue,
  });

  return { id: group.id };
}

async function _updateSharingGroup(
  groupId: string,
  name: string,
  companyIds: string[]
): Promise<void> {
  const session = await requireAdmin();

  if (!name?.trim()) {
    throw new Error("Nome do grupo é obrigatório");
  }
  if (companyIds.length < 2) {
    throw new Error("Selecione pelo menos 2 empresas para compartilhar");
  }

  const existing = await prisma.sharedClientGroup.findUnique({
    where: { id: groupId },
    include: { companies: { select: { id: true } } },
  });
  if (!existing) {
    throw new Error("Grupo não encontrado");
  }

  // Check that companies not already in *another* group
  const companiesInOtherGroups = await prisma.company.findMany({
    where: {
      id: { in: companyIds },
      sharedClientGroupId: { not: null },
      NOT: { sharedClientGroupId: groupId },
    },
    select: { nomeFantasia: true },
  });

  if (companiesInOtherGroups.length > 0) {
    const names = companiesInOtherGroups.map((c) => c.nomeFantasia).join(", ");
    throw new Error(
      `As seguintes empresas já pertencem a outro grupo: ${names}`
    );
  }

  const oldCompanyIds = existing.companies.map((c) => c.id);

  // Disconnect old, connect new
  await prisma.$transaction([
    prisma.company.updateMany({
      where: { sharedClientGroupId: groupId },
      data: { sharedClientGroupId: null },
    }),
    prisma.sharedClientGroup.update({
      where: { id: groupId },
      data: {
        name: name.trim(),
        companies: {
          connect: companyIds.map((id) => ({ id })),
        },
      },
    }),
  ]);

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "SharedClientGroup",
    entityId: groupId,
    dataBefore: {
      name: existing.name,
      companyIds: oldCompanyIds,
    } as unknown as Prisma.InputJsonValue,
    dataAfter: {
      name: name.trim(),
      companyIds,
    } as unknown as Prisma.InputJsonValue,
  });
}

async function _deleteSharingGroup(groupId: string): Promise<void> {
  const session = await requireAdmin();

  const existing = await prisma.sharedClientGroup.findUnique({
    where: { id: groupId },
    include: { companies: { select: { id: true, nomeFantasia: true } } },
  });
  if (!existing) {
    throw new Error("Grupo não encontrado");
  }

  await prisma.$transaction([
    prisma.company.updateMany({
      where: { sharedClientGroupId: groupId },
      data: { sharedClientGroupId: null },
    }),
    prisma.sharedClientGroup.delete({ where: { id: groupId } }),
  ]);

  await logAuditEvent({
    userId: session.userId,
    action: "DELETE",
    entity: "SharedClientGroup",
    entityId: groupId,
    dataBefore: {
      name: existing.name,
      companyIds: existing.companies.map((c) => c.id),
    } as unknown as Prisma.InputJsonValue,
  });
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
const _wrapped_listSharingGroups = withLogging('compartilhamento.listSharingGroups', _listSharingGroups);
export async function listSharingGroups(...args: Parameters<typeof _listSharingGroups>) { return _wrapped_listSharingGroups(...args); }
const _wrapped_listAvailableCompanies = withLogging('compartilhamento.listAvailableCompanies', _listAvailableCompanies);
export async function listAvailableCompanies(...args: Parameters<typeof _listAvailableCompanies>) { return _wrapped_listAvailableCompanies(...args); }
const _wrapped_createSharingGroup = withLogging('compartilhamento.createSharingGroup', _createSharingGroup);
export async function createSharingGroup(...args: Parameters<typeof _createSharingGroup>) { return _wrapped_createSharingGroup(...args); }
const _wrapped_updateSharingGroup = withLogging('compartilhamento.updateSharingGroup', _updateSharingGroup);
export async function updateSharingGroup(...args: Parameters<typeof _updateSharingGroup>) { return _wrapped_updateSharingGroup(...args); }
const _wrapped_deleteSharingGroup = withLogging('compartilhamento.deleteSharingGroup', _deleteSharingGroup);
export async function deleteSharingGroup(...args: Parameters<typeof _deleteSharingGroup>) { return _wrapped_deleteSharingGroup(...args); }
