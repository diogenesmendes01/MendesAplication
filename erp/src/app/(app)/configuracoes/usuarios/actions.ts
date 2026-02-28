"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "MANAGER";
}

export interface UpdateUserInput {
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER";
  password?: string;
}

export interface ListUsersParams {
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

export interface CompanyAssignment {
  companyId: string;
  modules: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateCreateUserInput(input: CreateUserInput) {
  if (!input.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }
  if (!input.email?.trim()) {
    throw new Error("Email é obrigatório");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(input.email)) {
    throw new Error("Email inválido");
  }
  if (!input.password || input.password.length < 6) {
    throw new Error("Senha deve ter pelo menos 6 caracteres");
  }
  if (!["ADMIN", "MANAGER"].includes(input.role)) {
    throw new Error("Perfil inválido. Use ADMIN ou MANAGER");
  }
}

function validateUpdateUserInput(input: UpdateUserInput) {
  if (!input.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }
  if (!input.email?.trim()) {
    throw new Error("Email é obrigatório");
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(input.email)) {
    throw new Error("Email inválido");
  }
  if (input.password !== undefined && input.password.length < 6) {
    throw new Error("Senha deve ter pelo menos 6 caracteres");
  }
  if (!["ADMIN", "MANAGER"].includes(input.role)) {
    throw new Error("Perfil inválido. Use ADMIN ou MANAGER");
  }
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Create a new user. Only ADMIN users can call this.
 */
export async function createUser(input: CreateUserInput) {
  const session = await requireAdmin();
  validateCreateUserInput(input);

  // Check email uniqueness
  const existing = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
  });
  if (existing) {
    throw new Error("Já existe um usuário cadastrado com este email");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      passwordHash,
      role: input.role,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "User",
    entityId: user.id,
    dataAfter: { name: user.name, email: user.email, role: user.role },
  });

  return user;
}

/**
 * Update an existing user. Only ADMIN users can call this.
 */
export async function updateUser(id: string, input: UpdateUserInput) {
  const session = await requireAdmin();
  validateUpdateUserInput(input);

  // Check email uniqueness (exclude current user)
  const existing = await prisma.user.findFirst({
    where: { email: input.email.trim().toLowerCase(), NOT: { id } },
  });
  if (existing) {
    throw new Error("Já existe outro usuário cadastrado com este email");
  }

  const before = await prisma.user.findUnique({
    where: { id },
    select: { name: true, email: true, role: true },
  });

  const data: Record<string, unknown> = {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
  };

  // Only update password if provided
  if (input.password) {
    data.passwordHash = await hashPassword(input.password);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "User",
    entityId: id,
    dataBefore: before as unknown as Prisma.InputJsonValue,
    dataAfter: { name: user.name, email: user.email, role: user.role },
  });

  return user;
}

/**
 * List users with pagination and optional search.
 * Only ADMIN users can call this.
 */
export async function listUsers(params: ListUsersParams = {}) {
  await requireAdmin();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const skip = (page - 1) * pageSize;

  const where = params.search
    ? {
        OR: [
          { name: { contains: params.search, mode: "insensitive" as const } },
          { email: { contains: params.search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.user.count({ where }),
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
 * Assign a user to companies with module permissions.
 * Replaces all existing company assignments for this user.
 * Only ADMIN users can call this.
 */
export async function assignUserToCompanies(
  userId: string,
  assignments: CompanyAssignment[]
) {
  const session = await requireAdmin();

  // Verify user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error("Usuário não encontrado");
  }

  // Verify all companies exist
  if (assignments.length > 0) {
    const companyIds = assignments.map((a) => a.companyId);
    const companies = await prisma.company.findMany({
      where: { id: { in: companyIds } },
      select: { id: true },
    });
    const foundIds = new Set(companies.map((c) => c.id));
    const missing = companyIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new Error("Empresa(s) não encontrada(s)");
    }
  }

  // Replace all assignments in a transaction
  await prisma.$transaction(async (tx) => {
    // Delete existing assignments
    await tx.userCompany.deleteMany({ where: { userId } });

    // Create new assignments
    if (assignments.length > 0) {
      await tx.userCompany.createMany({
        data: assignments.map((a) => ({
          userId,
          companyId: a.companyId,
          modules: a.modules,
        })),
      });
    }
  });

  // Return updated assignments
  const updated = await prisma.userCompany.findMany({
    where: { userId },
    include: { company: { select: { id: true, nomeFantasia: true } } },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "UserCompany",
    entityId: userId,
    dataAfter: { assignments: assignments as unknown as Prisma.InputJsonValue },
  });

  return updated;
}

/**
 * Toggle a user's status between ACTIVE and INACTIVE.
 * Only ADMIN users can call this.
 */
export async function toggleUserStatus(id: string) {
  const session = await requireAdmin();

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new Error("Usuário não encontrado");
  }

  const newStatus = user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  const updated = await prisma.user.update({
    where: { id },
    data: { status: newStatus },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "STATUS_CHANGE",
    entity: "User",
    entityId: id,
    dataBefore: { status: user.status },
    dataAfter: { status: newStatus },
  });

  return updated;
}

/**
 * List all active companies (for company assignment UI).
 * Only ADMIN users can call this.
 */
export async function listAllCompanies() {
  await requireAdmin();

  return prisma.company.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, nomeFantasia: true },
    orderBy: { nomeFantasia: "asc" },
  });
}

/**
 * Get a user by ID with their company assignments.
 * Only ADMIN users can call this.
 */
export async function getUserById(id: string) {
  await requireAdmin();

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      userCompanies: {
        include: {
          company: { select: { id: true, nomeFantasia: true, cnpj: true } },
        },
      },
    },
  });

  if (!user) {
    throw new Error("Usuário não encontrado");
  }

  return user;
}
