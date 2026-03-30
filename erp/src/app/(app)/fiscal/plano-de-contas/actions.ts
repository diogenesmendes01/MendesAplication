"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type AccountType } from "@prisma/client";
import { withLogging } from "@/lib/with-logging";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountNode {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  level: number;
  parentId: string | null;
  children: AccountNode[];
}

export interface CreateAccountInput {
  companyId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
}

export interface UpdateAccountInput {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
}

export interface ParentOption {
  id: string;
  code: string;
  name: string;
  level: number;
}

// ---------------------------------------------------------------------------
// Default chart of accounts (Brazilian standard simplified)
// ---------------------------------------------------------------------------

interface DefaultAccount {
  code: string;
  name: string;
  type: AccountType;
  children?: DefaultAccount[];
}

const DEFAULT_CHART: DefaultAccount[] = [
  {
    code: "1",
    name: "Ativo",
    type: "ASSET",
    children: [
      {
        code: "1.1",
        name: "Ativo Circulante",
        type: "ASSET",
        children: [
          { code: "1.1.1", name: "Caixa e Equivalentes", type: "ASSET" },
          { code: "1.1.2", name: "Bancos Conta Movimento", type: "ASSET" },
          { code: "1.1.3", name: "Contas a Receber", type: "ASSET" },
          { code: "1.1.4", name: "Estoques", type: "ASSET" },
        ],
      },
      {
        code: "1.2",
        name: "Ativo Não Circulante",
        type: "ASSET",
        children: [
          { code: "1.2.1", name: "Investimentos", type: "ASSET" },
          { code: "1.2.2", name: "Imobilizado", type: "ASSET" },
          { code: "1.2.3", name: "Intangível", type: "ASSET" },
        ],
      },
    ],
  },
  {
    code: "2",
    name: "Passivo",
    type: "LIABILITY",
    children: [
      {
        code: "2.1",
        name: "Passivo Circulante",
        type: "LIABILITY",
        children: [
          { code: "2.1.1", name: "Fornecedores", type: "LIABILITY" },
          { code: "2.1.2", name: "Obrigações Trabalhistas", type: "LIABILITY" },
          { code: "2.1.3", name: "Obrigações Tributárias", type: "LIABILITY" },
          { code: "2.1.4", name: "Empréstimos e Financiamentos", type: "LIABILITY" },
        ],
      },
      {
        code: "2.2",
        name: "Passivo Não Circulante",
        type: "LIABILITY",
        children: [
          { code: "2.2.1", name: "Empréstimos de Longo Prazo", type: "LIABILITY" },
        ],
      },
    ],
  },
  {
    code: "3",
    name: "Patrimônio Líquido",
    type: "EQUITY",
    children: [
      { code: "3.1", name: "Capital Social", type: "EQUITY" },
      { code: "3.2", name: "Reservas de Capital", type: "EQUITY" },
      { code: "3.3", name: "Lucros/Prejuízos Acumulados", type: "EQUITY" },
    ],
  },
  {
    code: "4",
    name: "Receitas",
    type: "REVENUE",
    children: [
      { code: "4.1", name: "Receita Bruta de Serviços", type: "REVENUE" },
      { code: "4.2", name: "Receita Bruta de Vendas", type: "REVENUE" },
      { code: "4.3", name: "Deduções da Receita", type: "REVENUE" },
      { code: "4.4", name: "Outras Receitas Operacionais", type: "REVENUE" },
    ],
  },
  {
    code: "5",
    name: "Despesas e Custos",
    type: "EXPENSE",
    children: [
      { code: "5.1", name: "Custos dos Serviços Prestados", type: "EXPENSE" },
      { code: "5.2", name: "Despesas Administrativas", type: "EXPENSE" },
      { code: "5.3", name: "Despesas Comerciais", type: "EXPENSE" },
      { code: "5.4", name: "Despesas Financeiras", type: "EXPENSE" },
      { code: "5.5", name: "Despesas Tributárias", type: "EXPENSE" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Seed the default chart of accounts for a company.
 * Skips accounts that already exist (by code+companyId).
 */
async function _seedDefaultChartOfAccounts(companyId: string) {
  const session = await requireCompanyAccess(companyId);

  // Check if company already has accounts
  const existingCount = await prisma.chartOfAccounts.count({
    where: { companyId },
  });
  if (existingCount > 0) {
    return { created: 0, message: "Plano de contas já existe para esta empresa" };
  }

  let created = 0;

  async function createAccounts(
    accounts: DefaultAccount[],
    parentId: string | null,
    level: number
  ) {
    for (const acct of accounts) {
      const record = await prisma.chartOfAccounts.create({
        data: {
          code: acct.code,
          name: acct.name,
          type: acct.type,
          level,
          parentId,
          companyId,
        },
      });
      created++;

      if (acct.children?.length) {
        await createAccounts(acct.children, record.id, level + 1);
      }
    }
  }

  await createAccounts(DEFAULT_CHART, null, 1);

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "ChartOfAccounts",
    entityId: companyId,
    dataAfter: { action: "seed_default", accountsCreated: created } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { created, message: `${created} contas criadas com sucesso` };
}

/**
 * List all chart of accounts for a company as a flat list, ordered by code.
 */
async function _listChartOfAccounts(
  companyId: string
): Promise<AccountNode[]> {
  await requireCompanyAccess(companyId);

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { companyId },
    take: 500,
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      level: true,
      parentId: true,
    },
  });

  // Build tree structure
  const map = new Map<string, AccountNode>();
  const roots: AccountNode[] = [];

  // First pass: create all nodes
  for (const acct of accounts) {
    map.set(acct.id, { ...acct, children: [] });
  }

  // Second pass: link parents and children
  for (const acct of accounts) {
    const node = map.get(acct.id)!;
    if (acct.parentId && map.has(acct.parentId)) {
      map.get(acct.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * List accounts as flat options for parent selector (exclude self and descendants).
 */
async function _listParentOptions(
  companyId: string,
  excludeId?: string
): Promise<ParentOption[]> {
  await requireCompanyAccess(companyId);

  const accounts = await prisma.chartOfAccounts.findMany({
    where: { companyId },
    take: 500,
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, level: true, parentId: true },
  });

  if (!excludeId) {
    return accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      level: a.level,
    }));
  }

  // Exclude the account itself and all its descendants
  const excludeIds = new Set<string>([excludeId]);
  // Iterate until no more descendants found
  let changed = true;
  while (changed) {
    changed = false;
    for (const acct of accounts) {
      if (acct.parentId && excludeIds.has(acct.parentId) && !excludeIds.has(acct.id)) {
        excludeIds.add(acct.id);
        changed = true;
      }
    }
  }

  return accounts
    .filter((a) => !excludeIds.has(a.id))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      level: a.level,
    }));
}

/**
 * Create a new chart of accounts entry.
 */
async function _createAccount(input: CreateAccountInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.code?.trim()) {
    throw new Error("Código é obrigatório");
  }
  if (!input.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }

  // Check code uniqueness within company
  const existing = await prisma.chartOfAccounts.findFirst({
    where: { code: input.code.trim(), companyId: input.companyId },
  });
  if (existing) {
    throw new Error("Já existe uma conta com este código nesta empresa");
  }

  // Determine level from parent
  let level = 1;
  if (input.parentId) {
    const parent = await prisma.chartOfAccounts.findFirst({
      where: { id: input.parentId, companyId: input.companyId },
    });
    if (!parent) {
      throw new Error("Conta pai não encontrada");
    }
    level = parent.level + 1;
  }

  const account = await prisma.chartOfAccounts.create({
    data: {
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      level,
      parentId: input.parentId || null,
      companyId: input.companyId,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "ChartOfAccounts",
    entityId: account.id,
    dataAfter: {
      code: account.code,
      name: account.name,
      type: account.type,
      level: account.level,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { id: account.id };
}

/**
 * Update an existing chart of accounts entry.
 */
async function _updateAccount(input: UpdateAccountInput) {
  const session = await requireCompanyAccess(input.companyId);

  if (!input.code?.trim()) {
    throw new Error("Código é obrigatório");
  }
  if (!input.name?.trim()) {
    throw new Error("Nome é obrigatório");
  }

  const existing = await prisma.chartOfAccounts.findFirst({
    where: { id: input.id, companyId: input.companyId },
  });
  if (!existing) {
    throw new Error("Conta não encontrada");
  }

  // Check code uniqueness (exclude self)
  const duplicate = await prisma.chartOfAccounts.findFirst({
    where: {
      code: input.code.trim(),
      companyId: input.companyId,
      NOT: { id: input.id },
    },
  });
  if (duplicate) {
    throw new Error("Já existe outra conta com este código nesta empresa");
  }

  // Determine level from parent
  let level = 1;
  if (input.parentId) {
    // Prevent setting self as parent
    if (input.parentId === input.id) {
      throw new Error("Uma conta não pode ser pai de si mesma");
    }
    const parent = await prisma.chartOfAccounts.findFirst({
      where: { id: input.parentId, companyId: input.companyId },
    });
    if (!parent) {
      throw new Error("Conta pai não encontrada");
    }
    level = parent.level + 1;
  }

  const updated = await prisma.chartOfAccounts.update({
    where: { id: input.id },
    data: {
      code: input.code.trim(),
      name: input.name.trim(),
      type: input.type,
      level,
      parentId: input.parentId || null,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "ChartOfAccounts",
    entityId: input.id,
    dataBefore: {
      code: existing.code,
      name: existing.name,
      type: existing.type,
      level: existing.level,
    } as unknown as Prisma.InputJsonValue,
    dataAfter: {
      code: updated.code,
      name: updated.name,
      type: updated.type,
      level: updated.level,
    } as unknown as Prisma.InputJsonValue,
    companyId: input.companyId,
  });

  return { id: updated.id };
}

/**
 * Delete a chart of accounts entry.
 * Children are re-parented to the deleted account's parent (or become roots).
 */
async function _deleteAccount(id: string, companyId: string) {
  const session = await requireCompanyAccess(companyId);

  const account = await prisma.chartOfAccounts.findFirst({
    where: { id, companyId },
    include: { children: { select: { id: true } } },
  });
  if (!account) {
    throw new Error("Conta não encontrada");
  }

  // Re-parent children to the deleted account's parent
  if (account.children.length > 0) {
    const newParentId = account.parentId;
    const newLevel = account.level; // Children take the deleted account's level
    await prisma.chartOfAccounts.updateMany({
      where: { parentId: id, companyId },
      data: { parentId: newParentId, level: newLevel },
    });
  }

  await prisma.chartOfAccounts.delete({
    where: { id },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "DELETE",
    entity: "ChartOfAccounts",
    entityId: id,
    dataBefore: {
      code: account.code,
      name: account.name,
      type: account.type,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const seedDefaultChartOfAccounts = withLogging('planoContas.seedDefaultChartOfAccounts', _seedDefaultChartOfAccounts);
export const listChartOfAccounts = withLogging('planoContas.listChartOfAccounts', _listChartOfAccounts);
export const listParentOptions = withLogging('planoContas.listParentOptions', _listParentOptions);
export const createAccount = withLogging('planoContas.createAccount', _createAccount);
export const updateAccount = withLogging('planoContas.updateAccount', _updateAccount);
export const deleteAccount = withLogging('planoContas.deleteAccount', _deleteAccount);
