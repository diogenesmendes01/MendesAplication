"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  companyId: string | null;
  companyName: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface ListAuditLogsParams {
  page?: number;
  pageSize?: number;
  userId?: string;
  action?: string;
  entity?: string;
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * List audit logs with filters and pagination. Only ADMIN can access.
 */
export async function listAuditLogs(
  params: ListAuditLogsParams = {}
): Promise<PaginatedResult<AuditLogEntry>> {
  await requireAdmin();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const skip = (page - 1) * pageSize;

  const where: Prisma.AuditLogWhereInput = {};

  if (params.userId) {
    where.userId = params.userId;
  }
  if (params.action) {
    where.action = params.action;
  }
  if (params.entity) {
    where.entity = { equals: params.entity, mode: "insensitive" };
  }
  if (params.companyId) {
    where.companyId = params.companyId;
  }
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {};
    if (params.dateFrom) {
      where.createdAt.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      // End of day
      const endDate = new Date(params.dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = endDate;
    }
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true } },
        company: { select: { id: true, nomeFantasia: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data: AuditLogEntry[] = logs.map((log) => ({
    id: log.id,
    userId: log.userId,
    userName: log.user.name,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId,
    companyId: log.companyId,
    companyName: log.company?.nomeFantasia ?? null,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
  }));

  return {
    data,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Export audit logs as CSV string with the same filters. Only ADMIN can access.
 */
export async function exportAuditLogsCsv(
  params: ListAuditLogsParams = {}
): Promise<string> {
  await requireAdmin();

  const where: Prisma.AuditLogWhereInput = {};

  if (params.userId) {
    where.userId = params.userId;
  }
  if (params.action) {
    where.action = params.action;
  }
  if (params.entity) {
    where.entity = { equals: params.entity, mode: "insensitive" };
  }
  if (params.companyId) {
    where.companyId = params.companyId;
  }
  if (params.dateFrom || params.dateTo) {
    where.createdAt = {};
    if (params.dateFrom) {
      where.createdAt.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      const endDate = new Date(params.dateTo);
      endDate.setHours(23, 59, 59, 999);
      where.createdAt.lte = endDate;
    }
  }

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      user: { select: { name: true } },
      company: { select: { nomeFantasia: true } },
    },
  });

  const header = "Data/Hora,Usuário,Ação,Entidade,ID Entidade,Empresa,IP";
  const rows = logs.map((log) => {
    const date = new Date(log.createdAt).toLocaleString("pt-BR");
    const user = csvEscape(log.user.name);
    const action = log.action;
    const entity = csvEscape(log.entity);
    const entityId = csvEscape(log.entityId);
    const company = csvEscape(log.company?.nomeFantasia ?? "—");
    const ip = log.ipAddress ?? "—";
    return `${date},${user},${action},${entity},${entityId},${company},${ip}`;
  });

  return [header, ...rows].join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Get distinct entity types from audit logs. Used for the entity filter dropdown.
 */
export async function getAuditEntityTypes(): Promise<string[]> {
  await requireAdmin();

  const result = await prisma.auditLog.findMany({
    select: { entity: true },
    distinct: ["entity"],
    orderBy: { entity: "asc" },
  });

  return result.map((r) => r.entity);
}

/**
 * Get users for the user filter dropdown.
 */
export async function getAuditUsers(): Promise<
  { id: string; name: string }[]
> {
  await requireAdmin();

  return prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Get companies for the company filter dropdown.
 */
export async function getAuditCompanies(): Promise<
  { id: string; nomeFantasia: string }[]
> {
  await requireAdmin();

  return prisma.company.findMany({
    select: { id: true, nomeFantasia: true },
    orderBy: { nomeFantasia: "asc" },
  });
}
