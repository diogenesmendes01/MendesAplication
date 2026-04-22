"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export interface UserCompany {
  id: string;
  nomeFantasia: string;
  razaoSocial: string;
  cnpj: string;
}

/**
 * Get companies accessible to the current user.
 * Admin sees all active companies; Manager sees only assigned companies.
 */
export async function getUserCompanies(): Promise<UserCompany[]> {
  const session = await requireSession();

  if (session.role === "ADMIN") {
    return prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, nomeFantasia: true, razaoSocial: true, cnpj: true },
      orderBy: { nomeFantasia: "asc" },
    });
  }

  // Manager: only assigned companies that are active
  const assignments = await prisma.userCompany.findMany({
    where: { userId: session.userId },
    include: {
      company: {
        select: { id: true, nomeFantasia: true, razaoSocial: true, cnpj: true, status: true },
      },
    },
  });

  return assignments
    .filter((a) => a.company.status === "ACTIVE")
    .map((a) => ({
      id: a.company.id,
      nomeFantasia: a.company.nomeFantasia,
      razaoSocial: a.company.razaoSocial,
      cnpj: a.company.cnpj,
    }));
}
