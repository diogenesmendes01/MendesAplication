/**
 * Controle atômico de numeração para NF-e Modelo 55.
 *
 * Usa `UPDATE ... RETURNING` via Prisma para garantir que dois processos
 * simultâneos nunca recebam o mesmo número — elimina a colisão que ocorreria
 * com geração client-side (Date.now(), contador em memória, etc.).
 *
 * Uso:
 *   const { nNumber, serie } = await getNextNfeNumber(prisma, companyId);
 *   await provider.emitNFe({ ..., nNumber, serie });
 */

import { PrismaClient } from "@prisma/client";

export async function getNextNfeNumber(
  prisma: PrismaClient,
  companyId: string
): Promise<{ nNumber: number; serie: string }> {
  // Incremento atômico: garante unicidade mesmo sob concorrência
  const updated = await prisma.fiscalConfig.update({
    where: { companyId },
    data: { nfeNextNumber: { increment: 1 } },
    select: { nfeNextNumber: true, nfeSerieNumber: true },
  });

  // Após o increment, o valor retornado já é o novo (incrementado)
  return {
    nNumber: updated.nfeNextNumber,
    serie: updated.nfeSerieNumber,
  };
}
