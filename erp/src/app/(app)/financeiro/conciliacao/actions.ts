"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import { Prisma, type BankTransactionStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListBankTransactionsParams {
  companyId: string;
  page?: number;
  pageSize?: number;
  status?: BankTransactionStatus;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface BankTransactionRow {
  id: string;
  date: string;
  description: string;
  value: string;
  status: BankTransactionStatus;
  createdAt: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface ParsedTransaction {
  date: Date;
  description: string;
  value: number;
}

// ---------------------------------------------------------------------------
// OFX Parser
// ---------------------------------------------------------------------------

function parseOFX(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  // Extract all STMTTRN blocks
  const trxRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match: RegExpExecArray | null;

  while ((match = trxRegex.exec(content)) !== null) {
    const block = match[1];

    const dtPosted = extractOFXField(block, "DTPOSTED");
    const trnAmt = extractOFXField(block, "TRNAMT");
    const memo = extractOFXField(block, "MEMO") || extractOFXField(block, "NAME") || "";

    if (!dtPosted || !trnAmt) continue;

    // Parse OFX date (YYYYMMDD or YYYYMMDDHHMMSS)
    const year = parseInt(dtPosted.substring(0, 4), 10);
    const month = parseInt(dtPosted.substring(4, 6), 10) - 1;
    const day = parseInt(dtPosted.substring(6, 8), 10);
    const date = new Date(year, month, day);

    if (isNaN(date.getTime())) continue;

    const value = parseFloat(trnAmt.replace(",", "."));
    if (isNaN(value)) continue;

    transactions.push({
      date,
      description: memo.trim(),
      value,
    });
  }

  return transactions;
}

function extractOFXField(block: string, fieldName: string): string | null {
  // OFX fields can be in two formats:
  // 1. <FIELD>value (SGML-style, no closing tag)
  // 2. <FIELD>value</FIELD> (XML-style)
  const xmlRegex = new RegExp(`<${fieldName}>([^<]*)</${fieldName}>`, "i");
  const xmlMatch = xmlRegex.exec(block);
  if (xmlMatch) return xmlMatch[1].trim();

  const sgmlRegex = new RegExp(`<${fieldName}>(.+)`, "im");
  const sgmlMatch = sgmlRegex.exec(block);
  if (sgmlMatch) return sgmlMatch[1].trim();

  return null;
}

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------

function parseCSV(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length < 2) return transactions;

  // Detect delimiter (semicolon or comma)
  const headerLine = lines[0];
  const delimiter = headerLine.includes(";") ? ";" : ",";

  const headers = headerLine.split(delimiter).map((h) => h.trim().toLowerCase().replace(/"/g, ""));

  // Find column indices — support common Portuguese and English headers
  const dateIdx = headers.findIndex((h) =>
    ["data", "date", "dt", "data_transacao", "data transação"].includes(h)
  );
  const descIdx = headers.findIndex((h) =>
    ["descricao", "descrição", "description", "desc", "historico", "histórico", "memo"].includes(h)
  );
  const valueIdx = headers.findIndex((h) =>
    ["valor", "value", "amount", "vl", "quantia"].includes(h)
  );

  if (dateIdx === -1 || valueIdx === -1) {
    // Try positional fallback: date, description, value (3 columns)
    if (headers.length >= 3) {
      return parseCSVPositional(lines.slice(1), delimiter);
    }
    return transactions;
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i], delimiter);
    if (cols.length <= Math.max(dateIdx, descIdx, valueIdx)) continue;

    const date = parseFlexibleDate(cols[dateIdx]);
    if (!date) continue;

    const rawValue = cols[valueIdx].replace(/"/g, "").replace(/\s/g, "");
    const value = parseBrazilianNumber(rawValue);
    if (isNaN(value)) continue;

    const description = descIdx >= 0 ? cols[descIdx].replace(/"/g, "").trim() : "";

    transactions.push({ date, description, value });
  }

  return transactions;
}

function parseCSVPositional(lines: string[], delimiter: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    const cols = splitCSVLine(line, delimiter);
    if (cols.length < 3) continue;

    const date = parseFlexibleDate(cols[0]);
    if (!date) continue;

    const description = cols[1].replace(/"/g, "").trim();

    const rawValue = cols[2].replace(/"/g, "").replace(/\s/g, "");
    const value = parseBrazilianNumber(rawValue);
    if (isNaN(value)) continue;

    transactions.push({ date, description, value });
  }

  return transactions;
}

function splitCSVLine(line: string, delimiter: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      cols.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseFlexibleDate(raw: string): Date | null {
  const cleaned = raw.replace(/"/g, "").trim();
  if (!cleaned) return null;

  // Try DD/MM/YYYY (Brazilian format)
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(cleaned);
  if (brMatch) {
    const d = new Date(parseInt(brMatch[3], 10), parseInt(brMatch[2], 10) - 1, parseInt(brMatch[1], 10));
    if (!isNaN(d.getTime())) return d;
  }

  // Try YYYY-MM-DD (ISO format)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);
  if (isoMatch) {
    const d = new Date(parseInt(isoMatch[1], 10), parseInt(isoMatch[2], 10) - 1, parseInt(isoMatch[3], 10));
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function parseBrazilianNumber(raw: string): number {
  // Handle Brazilian format: 1.234,56 → 1234.56
  // Also handle plain format: 1234.56
  const cleaned = raw.replace(/"/g, "").trim();

  // If there's a comma, treat it as Brazilian format
  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    return parseFloat(normalized);
  }

  return parseFloat(cleaned);
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function importBankTransactions(
  companyId: string,
  fileContent: string,
  fileName: string
): Promise<ImportResult> {
  const session = await requireCompanyAccess(companyId);

  const ext = fileName.toLowerCase().split(".").pop() || "";
  let parsed: ParsedTransaction[] = [];

  if (ext === "ofx" || ext === "qfx") {
    parsed = parseOFX(fileContent);
  } else if (ext === "csv" || ext === "txt") {
    parsed = parseCSV(fileContent);
  } else {
    return { imported: 0, skipped: 0, errors: [`Formato de arquivo não suportado: .${ext}. Use OFX ou CSV.`] };
  }

  if (parsed.length === 0) {
    return { imported: 0, skipped: 0, errors: ["Nenhuma transação encontrada no arquivo."] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const trx of parsed) {
    try {
      await prisma.bankTransaction.create({
        data: {
          date: trx.date,
          description: trx.description || "Sem descrição",
          value: new Prisma.Decimal(trx.value),
          companyId,
        },
      });
      imported++;
    } catch (err) {
      skipped++;
      errors.push(`Erro ao importar transação de ${trx.date.toLocaleDateString("pt-BR")}: ${String(err)}`);
    }
  }

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "BankTransaction",
    entityId: "bulk-import",
    dataAfter: { fileName, totalParsed: parsed.length, imported, skipped } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  return { imported, skipped, errors: errors.slice(0, 5) };
}

export async function listBankTransactions(
  params: ListBankTransactionsParams
): Promise<PaginatedResult<BankTransactionRow>> {
  const { companyId, page = 1, pageSize = 20, status, dateFrom, dateTo, search } = params;
  await requireCompanyAccess(companyId);

  const where: Prisma.BankTransactionWhereInput = { companyId };

  if (status) where.status = status;
  if (search) where.description = { contains: search, mode: "insensitive" };

  if (dateFrom || dateTo) {
    where.date = {};
    if (dateFrom) (where.date as Prisma.DateTimeFilter).gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      (where.date as Prisma.DateTimeFilter).lte = end;
    }
  }

  const [data, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.bankTransaction.count({ where }),
  ]);

  return {
    data: data.map((t) => ({
      id: t.id,
      date: t.date.toISOString(),
      description: t.description,
      value: t.value.toString(),
      status: t.status,
      createdAt: t.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function deleteBankTransaction(id: string, companyId: string): Promise<void> {
  const session = await requireCompanyAccess(companyId);

  const existing = await prisma.bankTransaction.findFirst({ where: { id, companyId } });
  if (!existing) throw new Error("Transação não encontrada");

  await prisma.bankTransaction.delete({ where: { id } });

  await logAuditEvent({
    userId: session.userId,
    action: "DELETE",
    entity: "BankTransaction",
    entityId: id,
    dataBefore: existing as unknown as Prisma.InputJsonValue,
    companyId,
  });
}
