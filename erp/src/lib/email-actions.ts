"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { sendEmail } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";
import {
  buildProposalEmailHtml,
  buildBoletoEmailHtml,
  type CompanyBranding,
} from "@/lib/email-templates";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
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

/**
 * Build a simple text-based PDF content as a base64 string.
 * Uses a minimal approach to avoid issues with jspdf on the server.
 */
function buildProposalPdfText(proposal: {
  id: string;
  clientName: string;
  companyName: string;
  totalValue: string;
  paymentConditions: string | null;
  validity: Date | null;
  observations: string | null;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
  }>;
}): string {
  const lines: string[] = [];
  lines.push(`PROPOSTA COMERCIAL #${proposal.id.slice(-6)}`);
  lines.push(`Empresa: ${proposal.companyName}`);
  lines.push(`Cliente: ${proposal.clientName}`);
  lines.push(`Valor Total: ${formatCurrency(parseFloat(proposal.totalValue))}`);
  if (proposal.paymentConditions) {
    lines.push(`Condições de Pagamento: ${proposal.paymentConditions}`);
  }
  if (proposal.validity) {
    lines.push(`Validade: ${formatDate(proposal.validity)}`);
  }
  lines.push("");
  lines.push("ITENS:");
  lines.push("---");

  for (const item of proposal.items) {
    const qty = parseFloat(item.quantity);
    const price = parseFloat(item.unitPrice);
    lines.push(
      `${item.description} | Qtd: ${qty} | Unit: ${formatCurrency(price)} | Subtotal: ${formatCurrency(qty * price)}`
    );
  }

  lines.push("---");
  lines.push(
    `TOTAL: ${formatCurrency(parseFloat(proposal.totalValue))}`
  );

  if (proposal.observations) {
    lines.push("");
    lines.push(`Observações: ${proposal.observations}`);
  }

  lines.push("");
  lines.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);

  return lines.join("\n");
}

function buildBoletoPdfText(boleto: {
  bankReference: string | null;
  value: string;
  dueDate: Date;
  installmentNumber: number;
  totalInstallments: number;
  clientName: string;
  companyName: string;
}): string {
  const installmentLabel =
    boleto.totalInstallments > 1
      ? `Parcela ${boleto.installmentNumber}/${boleto.totalInstallments}`
      : "Parcela única";

  const lines: string[] = [];
  lines.push("BOLETO BANCÁRIO");
  lines.push(`Empresa: ${boleto.companyName}`);
  lines.push(`Cliente: ${boleto.clientName}`);
  lines.push(`Referência: ${boleto.bankReference || "—"}`);
  lines.push(`${installmentLabel}`);
  lines.push(`Valor: ${formatCurrency(parseFloat(boleto.value))}`);
  lines.push(`Vencimento: ${formatDate(boleto.dueDate)}`);
  lines.push("");
  lines.push(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

/**
 * Send a proposal by email to the client, including a PDF attachment.
 * Also updates proposal status to SENT if currently DRAFT.
 */
export async function sendProposalEmail(
  proposalId: string,
  companyId: string
): Promise<{ success: true }> {
  const session = await requireCompanyAccess(companyId);

  const proposal = await prisma.proposal.findFirst({
    where: { id: proposalId, companyId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          cpfCnpj: true,
        },
      },
      company: {
        select: {
          nomeFantasia: true,
          razaoSocial: true,
          cnpj: true,
          logoUrl: true,
          email: true,
          telefone: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!proposal) {
    throw new Error("Proposta não encontrada");
  }

  if (!proposal.client.email) {
    throw new Error("Cliente não possui e-mail cadastrado");
  }

  const branding = getCompanyBranding(proposal.company);

  const proposalEmailData = {
    proposalId: proposal.id,
    clientName: proposal.client.name,
    totalValue: proposal.totalValue.toString(),
    paymentConditions: proposal.paymentConditions,
    validity: proposal.validity?.toISOString() ?? null,
    items: proposal.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  };

  const htmlBody = buildProposalEmailHtml(branding, proposalEmailData);

  const pdfContent = buildProposalPdfText({
    id: proposal.id,
    clientName: proposal.client.name,
    companyName: proposal.company.nomeFantasia,
    totalValue: proposal.totalValue.toString(),
    paymentConditions: proposal.paymentConditions,
    validity: proposal.validity,
    observations: proposal.observations,
    items: proposal.items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
    })),
  });

  const subject = `Proposta Comercial #${proposal.id.slice(-6)} - ${proposal.company.nomeFantasia}`;

  await sendEmail({
    to: proposal.client.email,
    subject,
    htmlBody,
    attachments: [
      {
        filename: `Proposta_${proposal.id.slice(-6)}.txt`,
        content: pdfContent,
      },
    ],
  });

  // Update proposal status to SENT if currently DRAFT
  if (proposal.status === "DRAFT") {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "SENT" },
    });

    await logAuditEvent({
      userId: session.userId,
      action: "STATUS_CHANGE",
      entity: "Proposal",
      entityId: proposalId,
      dataBefore: { status: proposal.status },
      dataAfter: { status: "SENT" },
      companyId,
    });
  }

  // Log email send event
  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Email",
    entityId: proposalId,
    dataAfter: {
      type: "proposal",
      to: proposal.client.email,
      subject,
      proposalId: proposal.id,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Registrar evento na proposta
  try {
    await prisma.proposalEvent.create({
      data: {
        proposalId: proposal.id,
        type: "EMAIL_SENT",
        description: `Proposta enviada por e-mail para ${proposal.client.email}.`,
        userId: session.userId,
      },
    });
  } catch (eventErr) {
    logger.error("[ProposalEvent] Falha ao registrar evento EMAIL_SENT:", eventErr);
  }

  return { success: true };
}

/**
 * Send a boleto by email to the client, including a PDF attachment.
 * Also updates boleto status to SENT if currently GENERATED.
 */
export async function sendBoletoEmail(
  boletoId: string,
  companyId: string
): Promise<{ success: true }> {
  const session = await requireCompanyAccess(companyId);

  const boleto = await prisma.boleto.findFirst({
    where: { id: boletoId, companyId },
    include: {
      proposal: {
        include: {
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          company: {
            select: {
              nomeFantasia: true,
              razaoSocial: true,
              cnpj: true,
              logoUrl: true,
              email: true,
              telefone: true,
            },
          },
          boletos: {
            select: { id: true },
          },
        },
      },
    },
  });

  if (!boleto) {
    throw new Error("Boleto não encontrado");
  }

  const client = boleto.proposal.client;
  const company = boleto.proposal.company;

  if (!client.email) {
    throw new Error("Cliente não possui e-mail cadastrado");
  }

  const branding = getCompanyBranding(company);
  const totalInstallments = boleto.proposal.boletos.length;

  const boletoEmailData = {
    boletoId: boleto.id,
    bankReference: boleto.bankReference,
    clientName: client.name,
    value: boleto.value.toString(),
    dueDate: boleto.dueDate.toISOString(),
    installmentNumber: boleto.installmentNumber,
    totalInstallments,
  };

  const htmlBody = buildBoletoEmailHtml(branding, boletoEmailData);

  const pdfContent = buildBoletoPdfText({
    bankReference: boleto.bankReference,
    value: boleto.value.toString(),
    dueDate: boleto.dueDate,
    installmentNumber: boleto.installmentNumber,
    totalInstallments,
    clientName: client.name,
    companyName: company.nomeFantasia,
  });

  const installmentLabel =
    totalInstallments > 1
      ? `Parcela ${boleto.installmentNumber}/${totalInstallments}`
      : "Parcela única";

  const subject = `Boleto - ${installmentLabel} - ${company.nomeFantasia}`;

  await sendEmail({
    to: client.email,
    subject,
    htmlBody,
    attachments: [
      {
        filename: `Boleto_${boleto.bankReference || boleto.id.slice(-6)}.txt`,
        content: pdfContent,
      },
    ],
  });

  // Update boleto status to SENT if currently GENERATED
  if (boleto.status === "GENERATED") {
    await prisma.boleto.update({
      where: { id: boletoId },
      data: { status: "SENT" },
    });

    await logAuditEvent({
      userId: session.userId,
      action: "STATUS_CHANGE",
      entity: "Boleto",
      entityId: boletoId,
      dataBefore: { status: boleto.status },
      dataAfter: { status: "SENT" },
      companyId,
    });
  }

  // Log email send event
  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "Email",
    entityId: boletoId,
    dataAfter: {
      type: "boleto",
      to: client.email,
      subject,
      boletoId: boleto.id,
    } as unknown as Prisma.InputJsonValue,
    companyId,
  });

  // Registrar evento na proposta
  try {
    await prisma.proposalEvent.create({
      data: {
        proposalId: boleto.proposalId,
        type: "BOLETO_SENT",
        description: `Boleto #${boleto.installmentNumber} enviado por e-mail para ${client.email}.`,
        userId: session.userId,
      },
    });
  } catch (eventErr) {
    logger.error("[ProposalEvent] Falha ao registrar evento BOLETO_SENT:", eventErr);
  }

  return { success: true };
}
