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

  // Fetch boleto with related data — sem filtro de status para poder
  // reportar o status real caso o boleto não esteja pago.
  const boleto = await prisma.boleto.findFirst({
    where: { id: boletoId, companyId },
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
    throw new Error("Boleto não encontrado");
  }

  // Regra de negócio: NFS-e só pode ser emitida para boletos pagos.
  // Emitir nota para boleto não quitado gera inconsistência fiscal.
  if (boleto.status !== "PAID") {
    throw new Error(
      "NFS-e só pode ser emitida para boletos pagos. " +
        `Boleto atual: ${boleto.status}.`
    );
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

  // Validação obrigatória: emitir NFS-e com ISS zerado ou negativo é inválido
  // fiscalmente e pode resultar em multas ou rejeição pela prefeitura.
  // issRate deve ser > 0 antes de qualquer comunicação com o provider.
  if (issRate <= 0) {
    throw new Error(
      `ISS rate inválido para emissão de NFS-e: ${issRate}%. ` +
      "Configure a alíquota ISS correta em Configurações → Fiscal antes de emitir notas."
    );
  }

  // Seleciona o provider NFS-e correto para o município da empresa
  const nfseProvider = await getNfseProviderForCompany(companyId);

  // Gera o número RPS de forma atômica via banco para evitar colisões em
  // emissões simultâneas. FiscalConfig.nfseNextNumber é incrementado com
  // uma operação atômica (UPDATE ... SET nfseNextNumber = nfseNextNumber + 1),
  // garantindo unicidade mesmo sob alta concorrência.
  const fiscalConfigUpdated = await prisma.fiscalConfig.update({
    where: { companyId },
    data: { nfseNextNumber: { increment: 1 } },
    select: { nfseNextNumber: true },
  });
  const rpsNumero = String(fiscalConfigUpdated.nfseNextNumber);

  // Guard de idempotência com lock: evita emissão duplicada em requisições concorrentes.
  // pg_advisory_xact_lock SÓ funciona dentro de uma $transaction — o lock é liberado
  // ao fim da transação. Fora de $transaction o lock é liberado imediatamente, tornando
  // a proteção contra corridas ineficaz.
  const existingInvoice = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`nfse:${boletoId}`}))`;
    return tx.invoice.findFirst({
      where: { boletoId, companyId },
    });
  });

  if (existingInvoice) {
    throw new Error("Já existe uma nota fiscal emitida para este boleto");
  }

  // FLUXO SEGURO: salvar PENDING primeiro, emitir depois, atualizar para ISSUED.
  //
  // Problema anterior: a NFS-e era emitida ANTES do prisma.invoice.create.
  // Se o create falhasse (ex: constraint violation, timeout), a NFS-e já existia
  // na prefeitura mas não havia registro no banco — documento fiscal perdido.
  //
  // Solução: criar o invoice com status PENDING antes de qualquer comunicação com
  // a prefeitura. Se a emissão falhar, marcamos como FAILED. Se o update final
  // falhar após emissão bem-sucedida, o status PENDING sinaliza inconsistência
  // para reconciliação manual (nfNumber fica no banco mesmo assim via catch).
  const invoice = await prisma.invoice.create({
    data: {
      proposalId: boleto.proposal.id ?? undefined,
      boletoId: boleto.id,
      clientId: client.id,
      serviceDescription,
      value: new Prisma.Decimal(value),
      issRate: new Prisma.Decimal(issRate),
      status: "PENDING",
      nfNumber: null,
      companyId,
    },
  });

  // Emite a NFS-e via provider real (Campinas, São Paulo ou Taboão)
  let result: { nfNumber: string };
  try {
    result = await nfseProvider.emitNFSe({
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
      rpsNumero,
    });
  } catch (emitError) {
    // Compensação: a emissão falhou antes de chegar na prefeitura (ou a prefeitura
    // rejeitou). Marcar como CANCELLED para distinguir de PENDING legítimo.
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED", cancellationReason: String(emitError) },
    }).catch((updateErr) => {
      console.error("Falha ao cancelar invoice após erro de emissão:", updateErr);
    });
    throw emitError;
  }

  // Atualizar para ISSUED com o número da NFS-e retornado pela prefeitura.
  // Se este update falhar por algum motivo, o nfNumber fica salvo no catch
  // para facilitar reconciliação manual — o invoice permanece PENDING.
  try {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", nfNumber: result.nfNumber },
    });
  } catch (updateError) {
    // Registrar o nfNumber mesmo com falha no update para não perder o número
    console.error(
      `ATENÇÃO: NFS-e ${result.nfNumber} emitida na prefeitura mas falha ao atualizar invoice ${invoice.id}:`,
      updateError
    );
    // Tentar novamente sem o status para pelo menos salvar o nfNumber
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { nfNumber: result.nfNumber },
    }).catch(console.error);
    throw updateError;
  }

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

  // Registrar evento na proposta (best-effort — não falhar se der erro)
  try {
    await prisma.proposalEvent.create({
      data: {
        proposalId: boleto.proposal.id,
        type: "NFSE_EMITTED",
        description: `NFS-e emitida: número ${result.nfNumber}. Valor: R$ ${value.toFixed(2)}.`,
        userId: session.userId,
      },
    });
  } catch (eventErr) {
    console.error("[ProposalEvent] Falha ao registrar evento NFSE_EMITTED:", eventErr);
  }

  return {
    success: true,
    invoiceId: invoice.id,
    nfNumber: result.nfNumber,
  };
}
