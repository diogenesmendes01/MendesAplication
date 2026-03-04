"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { isValidCpf, stripCpf, formatCpf } from "@/lib/cpf";
import { isValidCnpj, stripCnpj, formatCnpj } from "@/lib/cnpj";
import { Prisma } from "@prisma/client";
import { getSharedCompanyIds } from "@/lib/shared-clients";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientInput {
  name: string;
  razaoSocial?: string;
  cpfCnpj: string;
  email?: string;
  telefone?: string;
  endereco?: string;
  type: "PF" | "PJ";
}

export interface ListClientsParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ClientRow {
  id: string;
  name: string;
  razaoSocial: string | null;
  cpfCnpj: string;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
  type: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCpfCnpj(value: string, type: "PF" | "PJ"): string {
  if (type === "PF") {
    return formatCpf(stripCpf(value));
  }
  return formatCnpj(stripCnpj(value));
}

function validateClientInput(input: ClientInput) {
  if (!input.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }
  if (!input.cpfCnpj?.trim()) {
    throw new Error("CPF/CNPJ é obrigatório");
  }
  if (input.type === "PF") {
    if (!isValidCpf(input.cpfCnpj)) {
      throw new Error("CPF inválido");
    }
  } else {
    if (!isValidCnpj(input.cpfCnpj)) {
      throw new Error("CNPJ inválido");
    }
  }
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listClients(
  params: ListClientsParams
): Promise<PaginatedResult<ClientRow>> {
  await requireCompanyAccess(params.companyId);

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  // Include clients from shared companies
  const sharedIds = await getSharedCompanyIds(params.companyId);

  const where: Prisma.ClientWhereInput = {
    companyId: { in: sharedIds },
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" } },
            { cpfCnpj: { contains: params.search, mode: "insensitive" } },
            { email: { contains: params.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        razaoSocial: true,
        cpfCnpj: true,
        email: true,
        telefone: true,
        endereco: true,
        type: true,
        createdAt: true,
      },
    }),
    prisma.client.count({ where }),
  ]);

  return {
    data: data.map((c) => ({
      id: c.id,
      name: c.name,
      razaoSocial: c.razaoSocial,
      cpfCnpj: c.cpfCnpj,
      email: c.email,
      telefone: c.telefone,
      endereco: c.endereco,
      type: c.type,
      createdAt: c.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function createClient(input: ClientInput, companyId: string) {
  const session = await requireCompanyAccess(companyId);
  validateClientInput(input);

  const formattedCpfCnpj = formatCpfCnpj(input.cpfCnpj, input.type);

  // Check uniqueness within company
  const existing = await prisma.client.findUnique({
    where: {
      cpfCnpj_companyId: { cpfCnpj: formattedCpfCnpj, companyId },
    },
  });
  if (existing) {
    throw new Error(
      `Já existe um cliente cadastrado com este ${input.type === "PF" ? "CPF" : "CNPJ"} nesta empresa`
    );
  }

  const client = await prisma.client.create({
    data: {
      name: input.name.trim(),
      razaoSocial: input.razaoSocial?.trim() || null,
      cpfCnpj: formattedCpfCnpj,
      email: input.email?.trim() || null,
      telefone: input.telefone?.trim() || null,
      endereco: input.endereco?.trim() || null,
      type: input.type,
      companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Client",
    entityId: client.id,
    dataAfter: client as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { id: client.id };
}

export async function updateClient(
  clientId: string,
  input: ClientInput,
  companyId: string
) {
  const session = await requireCompanyAccess(companyId);
  validateClientInput(input);

  const formattedCpfCnpj = formatCpfCnpj(input.cpfCnpj, input.type);

  // Check uniqueness (exclude current client)
  const existing = await prisma.client.findFirst({
    where: {
      cpfCnpj: formattedCpfCnpj,
      companyId,
      NOT: { id: clientId },
    },
  });
  if (existing) {
    throw new Error(
      `Já existe outro cliente cadastrado com este ${input.type === "PF" ? "CPF" : "CNPJ"} nesta empresa`
    );
  }

  const before = await prisma.client.findFirst({
    where: { id: clientId, companyId },
  });
  if (!before) {
    throw new Error("Cliente não encontrado");
  }

  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      name: input.name.trim(),
      razaoSocial: input.razaoSocial?.trim() || null,
      cpfCnpj: formattedCpfCnpj,
      email: input.email?.trim() || null,
      telefone: input.telefone?.trim() || null,
      endereco: input.endereco?.trim() || null,
      type: input.type,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Client",
    entityId: clientId,
    dataBefore: before as unknown as Prisma.InputJsonValue,
    dataAfter: client as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { id: client.id };
}

export async function getClientForEdit(clientId: string, companyId: string) {
  await requireCompanyAccess(companyId);

  const sharedIds = await getSharedCompanyIds(companyId);
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId: { in: sharedIds } },
  });

  if (!client) {
    throw new Error("Cliente não encontrado");
  }

  return {
    id: client.id,
    name: client.name,
    razaoSocial: client.razaoSocial,
    cpfCnpj: client.cpfCnpj,
    email: client.email,
    telefone: client.telefone,
    endereco: client.endereco,
    type: client.type as "PF" | "PJ",
  };
}
