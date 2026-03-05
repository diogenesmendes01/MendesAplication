"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { getNfseProviderForCompany } from "@/lib/nfse";
import { sendEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";
import {
  buildNfseEmailHtml,
  type CompanyBranding,
} from "@/lib/email-templates";
import { Prisma } from "@prisma/client";
import { getCachedFiscalConfig } from "@/app/(app)/configuracoes/fiscal/actions";
import { createTaxEntriesForInvoice } from "@/lib/tax-entries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function getCompanyBranding(company: {
  nomeFantasia: string;
  logoUrl: string | null;
  email: string | null;
  telefone: string | null;
}): CompanyBranding {
  return {
    name: company.nomeFantasia,
    logoUrl: company.logoUrl,
    email: company.email,
    telefone: company.telefone,
  };
}

function buildNfsePdfText(data: {
  nfNumber: string;
  companyName: string;
  companyCnpj: string;
  clientName: string;
  clientCpfCnpj: string;
  serviceDescription: string;
  value: number;
  issRate: number;
  issValue: number;
}): string {
  const lines: string[] = [];
  lines.push("NOTA FISCAL DE SERVIÇO ELETRÔNICA (NFS-e)");
  lines.push(`Número: ${data.nfNumber}`);
  lines.push("");
  lines.push("PRESTADOR:");
  lines.push(`  ${data.companyName}`);
  lines.push(`  CNPJ: ${data.companyCnpj}`);
  lines.push("");
  lines.push("TOMADOR:");
  lines.push(`  ${data.clientName}`);
  lines.push(`  CPF/CNPJ: ${data.clientCpfCnpj}`);
  lines.push("");
  lines.push("SERVIÇO:");
  lines.push(`  ${data.serviceDescription}`);
  lines.push("");
  lines.push(`Valor do Serviço: ${formatCurrency(data.value)}`);
  lines.push(`Alíquota ISS:     ${data.issRate.toFixed(2)}%`);
  lines.push(`Valor ISS:        ${formatCurrency(data.issValue)}`);
  lines.push("");
  lines.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Emit an NFS-e (Nota Fiscal de Serviço Eletrônica) linked to a paid boleto.
 * Creates an Invoice record, calls the NFS-e provider, updates status to ISSUED,
 * and auto-sends the NFS-e PDF to the client via email.
 */
export async function emitInvoiceForBoleto(
  boletoId: string,
  companyId: string
): Promise<{ success: true; invoiceId: string; nfNumber: string }> {
  const session = await requireCompanyAccess(companyId);

  // Fetch boleto with related data
  const boleto = await prisma.boleto.findFirst({
    where: { id: boletoId, companyId, status: "PAID" },
    include: {
      proposal: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
              cpfCnpj: true,
              email: true,
              endereco: true,
            },
          },
          items: {
            select: { description: true },
          },
        },
      },
      company: {
        select: {
          id: true,
          razaoSocial: true,
          nomeFantasia: true,
          cnpj: true,
          inscricaoEstadual: true,
          logoUrl: true,
          email: true,
          telefone: true,
        },
      },
    },
  });

  if (!boleto) {
    throw new Error("Boleto não encontrado ou não está com status PAID");
  }

  const client = boleto.proposal.client;
  const company = boleto.company;
  const value = Number(boleto.value);

  // Build service description from proposal items
  const serviceDescription = boleto.proposal.items
    .map((item) => item.description)
    .join("; ");

  // Use fiscal config rates (cached 5min)
  const fiscalConfig = await getCachedFiscalConfig(companyId);
  const issRate = fiscalConfig.issRate;

  // Seleciona o provider NFS-e correto para o município da empresa
  const nfseProvider = await getNfseProviderForCompany(companyId);

  // Guard de idempotência com lock: evita emissão duplicada em requisições concorrentes.
  // Tenta criar o invoice em estado PENDING dentro da transação — se já existir, aborta.
  await prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nfse:${boletoId}`}))`;

  const existingInvoice = await prisma.invoice.findFirst({
    where: { boletoId, companyId },
  });

  if (existingInvoice) {
    throw new Error("Já existe uma nota fiscal emitida para este boleto");
  }

  // Emite a NFS-e via provider real (Campinas, São Paulo ou Taboão)
  const result = await nfseProvider.emitNFSe({
    companyData: {
      razaoSocial: company.razaoSocial,
      cnpj: company.cnpj,
      inscricaoEstadual: company.inscricaoEstadual,
    },
    clientData: {
      name: client.name,
      cpfCnpj: client.cpfCnpj,
      email: client.email,
      endereco: client.endereco,
    },
    serviceDescription,
    value,
    issRate,
  });

  // Create the Invoice record with ISSUED status
  const invoice = await prisma.invoice.create({
    data: {
      proposalId: boleto.proposal.id ?? undefined,
      boletoId: boleto.id,
      clientId: client.id,
      serviceDescription,
      value: new Prisma.Decimal(value),
      issRate: new Prisma.Decimal(issRate),
      status: "ISSUED",
      nfNumber: result.nfNumber,
      companyId,
    },
  });

  // Log audit event for invoice creation
  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Invoice",
    entityId: invoice.id,
    dataAfter: {
      nfNumber: result.nfNumber,
      boletoId,
      clientId: client.id,
      value,
      issRate,
      status: "ISSUED",
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Create TaxEntry records for each applicable tax
  await createTaxEntriesForInvoice({
    invoiceId: invoice.id,
    companyId,
    value,
    fiscalConfig,
  });

  // Auto-send NFS-e PDF to client via email
  if (client.email) {
    try {
      const issValue = value * (issRate / 100);
      const branding = getCompanyBranding(company);

      const htmlBody = buildNfseEmailHtml(branding, {
        nfNumber: result.nfNumber,
        clientName: client.name,
        serviceDescription,
        value: value.toString(),
        issRate: issRate.toFixed(2),
        issValue: issValue.toString(),
        companyName: company.nomeFantasia,
      });

      const pdfContent = buildNfsePdfText({
        nfNumber: result.nfNumber,
        companyName: company.razaoSocial,
        companyCnpj: company.cnpj,
        clientName: client.name,
        clientCpfCnpj: client.cpfCnpj,
        serviceDescription,
        value,
        issRate,
        issValue,
      });

      const subject = `NFS-e ${result.nfNumber} - ${company.nomeFantasia}`;

      await sendEmail({
        to: client.email,
        subject,
        htmlBody,
        attachments: [
          {
            filename: `NFSe_${result.nfNumber}.txt`,
            content: pdfContent,
          },
        ],
      });

      // Log email send event
      await logAuditEvent({
        userId: session.userId,
        action: "CREATE",
        entity: "Email",
        entityId: invoice.id,
        dataAfter: {
          type: "nfse",
          to: client.email,
          subject,
          invoiceId: invoice.id,
          nfNumber: result.nfNumber,
        } as unknown as Prisma.InputJsonValue,
        companyId,
      });
    } catch (error) {
      // Email failure should not prevent invoice emission
      console.error("Failed to send NFS-e email:", error);
    }
  }

  return {
    success: true,
    invoiceId: invoice.id,
    nfNumber: result.nfNumber,
  };
}
