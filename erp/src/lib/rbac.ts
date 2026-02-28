"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Check if a user can access a specific company.
 * Admin users can access all companies.
 * Manager users can only access companies assigned to them via UserCompany.
 */
export async function canAccessCompany(
  userId: string,
  role: string,
  companyId: string
): Promise<boolean> {
  // Admin bypasses company-level checks
  if (role === "ADMIN") return true;

  // Manager: check UserCompany junction
  const assignment = await prisma.userCompany.findUnique({
    where: {
      userId_companyId: { userId, companyId },
    },
  });

  return assignment !== null;
}

/**
 * Check if a user can access a specific module within a company.
 * Admin users can access all modules.
 * Manager users must have the module listed in their UserCompany.modules array.
 */
export async function canAccessModule(
  userId: string,
  role: string,
  companyId: string,
  module: string
): Promise<boolean> {
  // Admin bypasses all checks
  if (role === "ADMIN") return true;

  // Manager: check UserCompany junction and module list
  const assignment = await prisma.userCompany.findUnique({
    where: {
      userId_companyId: { userId, companyId },
    },
  });

  if (!assignment) return false;

  // If modules array is empty, user has access to all modules for this company
  if (assignment.modules.length === 0) return true;

  return assignment.modules.includes(module);
}

/**
 * Server action middleware: require the current user to have access to the given company.
 * Throws an error if the user does not have access.
 * Returns the session payload for convenience.
 */
export async function requireCompanyAccess(companyId: string) {
  const session = await requireSession();

  if (!companyId) {
    throw new Error("Empresa não selecionada");
  }

  const hasAccess = await canAccessCompany(session.userId, session.role, companyId);
  if (!hasAccess) {
    throw new Error("Acesso negado. Você não tem permissão para acessar esta empresa.");
  }

  return session;
}

/**
 * Server action middleware: require the current user to have access to a specific module
 * within a company. Throws an error if the user does not have access.
 * Returns the session payload for convenience.
 */
export async function requireModuleAccess(companyId: string, module: string) {
  const session = await requireSession();

  if (!companyId) {
    throw new Error("Empresa não selecionada");
  }

  const hasAccess = await canAccessModule(session.userId, session.role, companyId, module);
  if (!hasAccess) {
    throw new Error(
      `Acesso negado. Você não tem permissão para acessar o módulo "${module}" nesta empresa.`
    );
  }

  return session;
}
