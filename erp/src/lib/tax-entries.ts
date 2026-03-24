import { prisma } from "@/lib/prisma";
import { type PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import type { FiscalConfigData } from "@/app/(app)/configuracoes/fiscal/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

interface TaxEntryInput {
  invoiceId: string;
  companyId: string;
  value: number;
  fiscalConfig: FiscalConfigData;
  /** If true, creates entries with negative values (for credit notes / estorno) */
  isEstorno?: boolean;
  /** Optional transaction client — if provided, operations run inside the transaction */
  tx?: PrismaTransactionClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentPeriod(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();
  return `${year}-${month}`;
}

function getDefaultDueDate(): Date {
  // Default: 20th of next month
  const now = new Date();
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 20);
  return dueDate;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create TaxEntry records for each applicable tax on an invoice.
 * Only creates entries for taxes with rate > 0 in the FiscalConfig.
 * Pass `tx` to run inside an existing Prisma transaction.
 */
export async function createTaxEntriesForInvoice(input: TaxEntryInput) {
  const { invoiceId, companyId, value, fiscalConfig, isEstorno, tx } = input;
  const db = tx ?? prisma;
  const period = getCurrentPeriod();
  const dueDate = getDefaultDueDate();
  const sign = isEstorno ? -1 : 1;

  const taxes: { type: "ISS" | "PIS" | "COFINS" | "IRPJ" | "CSLL"; rate: number }[] = [
    { type: "ISS", rate: fiscalConfig.issRate },
    { type: "PIS", rate: fiscalConfig.pisRate },
    { type: "COFINS", rate: fiscalConfig.cofinsRate },
    { type: "IRPJ", rate: fiscalConfig.irpjRate },
    { type: "CSLL", rate: fiscalConfig.csllRate },
  ];

  const entries = taxes
    .filter((t) => t.rate > 0)
    .map((t) => ({
      companyId,
      invoiceId,
      type: t.type as "ISS" | "PIS" | "COFINS" | "IRPJ" | "CSLL",
      period,
      value: new Decimal(sign * value * (t.rate / 100)),
      dueDate,
      status: "PENDING" as const,
    }));

  if (entries.length > 0) {
    await db.taxEntry.createMany({ data: entries });
  }
}

/**
 * Cancel all TaxEntries linked to an invoice.
 * Pass `tx` to run inside an existing Prisma transaction.
 */
export async function cancelTaxEntriesForInvoice(
  invoiceId: string,
  tx?: PrismaTransactionClient
) {
  const db = tx ?? prisma;
  await db.taxEntry.updateMany({
    where: { invoiceId, status: { not: "CANCELLED" } },
    data: { status: "CANCELLED" },
  });
}
