"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isValidCnpj, stripCnpj, formatCnpj } from "@/lib/cnpj";
import { logAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanyInput {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  inscricaoEstadual?: string;
  endereco?: string;
  telefone?: string;
  email?: string;
  segmento?: string;
  logoUrl?: string;
}

export interface ListCompaniesParams {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateCompanyInput(input: CompanyInput) {
  if (!input.razaoSocial?.trim()) {
    throw new Error("Razão Social é obrigatória");
  }
  if (!input.nomeFantasia?.trim()) {
    throw new Error("Nome Fantasia é obrigatório");
  }
  if (!input.cnpj?.trim()) {
    throw new Error("CNPJ é obrigatório");
  }
  if (!isValidCnpj(input.cnpj)) {
    throw new Error("CNPJ inválido. Use o formato XX.XXX.XXX/XXXX-XX");
  }
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Create a new company. Only ADMIN users can call this.
 */
export async function createCompany(input: CompanyInput) {
  const session = await requireAdmin();
  validateCompanyInput(input);

  const cnpjDigits = stripCnpj(input.cnpj);
  const formattedCnpj = formatCnpj(cnpjDigits);

  // Check uniqueness
  const existing = await prisma.company.findUnique({
    where: { cnpj: formattedCnpj },
  });
  if (existing) {
    throw new Error("Já existe uma empresa cadastrada com este CNPJ");
  }

  const company = await prisma.company.create({
    data: {
      razaoSocial: input.razaoSocial.trim(),
      nomeFantasia: input.nomeFantasia.trim(),
      cnpj: formattedCnpj,
      inscricaoEstadual: input.inscricaoEstadual?.trim() || null,
      endereco: input.endereco?.trim() || null,
      telefone: input.telefone?.trim() || null,
      email: input.email?.trim() || null,
      segmento: input.segmento?.trim() || null,
      logoUrl: input.logoUrl?.trim() || null,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Company",
    entityId: company.id,
    dataAfter: company as unknown as Prisma.InputJsonValue,
  });

  return company;
}

/**
 * Update an existing company. Only ADMIN users can call this.
 */
export async function updateCompany(id: string, input: CompanyInput) {
  const session = await requireAdmin();
  validateCompanyInput(input);

  const cnpjDigits = stripCnpj(input.cnpj);
  const formattedCnpj = formatCnpj(cnpjDigits);

  // Check uniqueness (exclude current company)
  const existing = await prisma.company.findFirst({
    where: { cnpj: formattedCnpj, NOT: { id } },
  });
  if (existing) {
    throw new Error("Já existe outra empresa cadastrada com este CNPJ");
  }

  const before = await prisma.company.findUnique({ where: { id } });

  const company = await prisma.company.update({
    where: { id },
    data: {
      razaoSocial: input.razaoSocial.trim(),
      nomeFantasia: input.nomeFantasia.trim(),
      cnpj: formattedCnpj,
      inscricaoEstadual: input.inscricaoEstadual?.trim() || null,
      endereco: input.endereco?.trim() || null,
      telefone: input.telefone?.trim() || null,
      email: input.email?.trim() || null,
      segmento: input.segmento?.trim() || null,
      logoUrl: input.logoUrl?.trim() || null,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "Company",
    entityId: id,
    dataBefore: before as unknown as Prisma.InputJsonValue,
    dataAfter: company as unknown as Prisma.InputJsonValue,
  });

  return company;
}

/**
 * List companies with pagination and optional search.
 * Only ADMIN users can call this.
 */
export async function listCompanies(
  params: ListCompaniesParams = {}
): Promise<PaginatedResult<Awaited<ReturnType<typeof prisma.company.findMany>>[number]>> {
  await requireAdmin();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where = params.search
    ? {
        OR: [
          { razaoSocial: { contains: params.search, mode: "insensitive" as const } },
          { nomeFantasia: { contains: params.search, mode: "insensitive" as const } },
          { cnpj: { contains: params.search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [data, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { nomeFantasia: "asc" },
      skip,
      take: pageSize,
    }),
    prisma.company.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single company by ID. Only ADMIN users can call this.
 */
export async function getCompanyById(id: string) {
  await requireAdmin();

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) {
    throw new Error("Empresa não encontrada");
  }

  return company;
}

/**
 * Toggle a company's status between ACTIVE and INACTIVE.
 * Only ADMIN users can call this.
 */
export async function toggleCompanyStatus(id: string) {
  const session = await requireAdmin();

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) {
    throw new Error("Empresa não encontrada");
  }

  const newStatus = company.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  const updated = await prisma.company.update({
    where: { id },
    data: { status: newStatus },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "Company",
    entityId: id,
    dataBefore: { status: company.status },
    dataAfter: { status: newStatus },
  });

  return updated;
}
