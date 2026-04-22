import { prisma } from "@/lib/prisma";

/**
 * Returns all company IDs that share clients with the given company.
 * If the company is in a SharedClientGroup, returns all company IDs in that group.
 * Otherwise, returns just the given company ID.
 */
export async function getSharedCompanyIds(
  companyId: string
): Promise<string[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { sharedClientGroupId: true },
  });

  if (!company?.sharedClientGroupId) {
    return [companyId];
  }

  const groupCompanies = await prisma.company.findMany({
    where: { sharedClientGroupId: company.sharedClientGroupId },
    select: { id: true },
  });

  return groupCompanies.map((c) => c.id);
}
