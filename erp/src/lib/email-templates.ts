/**
 * Email template system with company branding.
 * Generates branded HTML emails using company variables (name, logo, colors).
 */

export interface CompanyBranding {
  name: string;
  logoUrl?: string | null;
  email?: string | null;
  telefone?: string | null;
}

interface TemplateVars {
  company: CompanyBranding;
  subject: string;
  bodyContent: string;
}

const PRIMARY_COLOR = "#2563eb";
const SECONDARY_COLOR = "#1e40af";

function buildEmailHtml(vars: TemplateVars): string {
  const logoSection = vars.company.logoUrl
    ? `<img src="${vars.company.logoUrl}" alt="${vars.company.name}" style="max-height:60px;max-width:200px;" />`
    : `<span style="font-size:24px;font-weight:bold;color:#ffffff;">${vars.company.name}</span>`;

  const contactLines: string[] = [];
  if (vars.company.email) {
    contactLines.push(vars.company.email);
  }
  if (vars.company.telefone) {
    contactLines.push(vars.company.telefone);
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${vars.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:20px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:${PRIMARY_COLOR};padding:24px 32px;text-align:center;">
              ${logoSection}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${vars.bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:${SECONDARY_COLOR};padding:16px 32px;text-align:center;color:#cbd5e1;font-size:12px;">
              <p style="margin:0;">${vars.company.name}</p>
              ${contactLines.length > 0 ? `<p style="margin:4px 0 0;">${contactLines.join(" | ")}</p>` : ""}
              <p style="margin:8px 0 0;color:#94a3b8;">Este é um e-mail automático. Por favor, não responda diretamente.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Proposal Email Template
// ---------------------------------------------------------------------------

export interface ProposalEmailData {
  proposalId: string;
  clientName: string;
  totalValue: string;
  paymentConditions: string | null;
  validity: string | null;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
  }>;
}

export function buildProposalEmailHtml(
  company: CompanyBranding,
  data: ProposalEmailData
): string {
  const currencyFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const itemRows = data.items
    .map((item) => {
      const qty = parseFloat(item.quantity);
      const price = parseFloat(item.unitPrice);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${currencyFmt.format(price)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${currencyFmt.format(qty * price)}</td>
      </tr>`;
    })
    .join("");

  const bodyContent = `
    <h2 style="color:#1e293b;margin:0 0 16px;">Proposta Comercial</h2>
    <p style="color:#475569;line-height:1.6;">
      Prezado(a) <strong>${data.clientName}</strong>,
    </p>
    <p style="color:#475569;line-height:1.6;">
      Segue em anexo a proposta comercial da empresa <strong>${company.name}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
      <tr style="background-color:#f8fafc;">
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Proposta</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">#${data.proposalId.slice(-6)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Valor Total</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:bold;color:${PRIMARY_COLOR};">${currencyFmt.format(parseFloat(data.totalValue))}</td>
      </tr>
      ${data.paymentConditions ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Condições</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${data.paymentConditions}</td></tr>` : ""}
      ${data.validity ? `<tr><td style="padding:8px 12px;font-weight:bold;">Validade</td><td style="padding:8px 12px;">${dateFmt.format(new Date(data.validity))}</td></tr>` : ""}
    </table>
    <h3 style="color:#1e293b;margin:24px 0 8px;">Itens</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
      <tr style="background-color:${PRIMARY_COLOR};color:#ffffff;">
        <td style="padding:8px 12px;font-weight:bold;">Descrição</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">Qtd</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">Preço Unit.</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">Subtotal</td>
      </tr>
      ${itemRows}
      <tr style="background-color:#f8fafc;">
        <td colspan="3" style="padding:8px 12px;font-weight:bold;text-align:right;">Total</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">${currencyFmt.format(parseFloat(data.totalValue))}</td>
      </tr>
    </table>
    <p style="color:#475569;margin-top:24px;line-height:1.6;">
      A proposta em formato PDF segue em anexo para sua conveniência.
    </p>
  `;

  return buildEmailHtml({
    company,
    subject: `Proposta Comercial #${data.proposalId.slice(-6)} - ${company.name}`,
    bodyContent,
  });
}

// ---------------------------------------------------------------------------
// Boleto Email Template
// ---------------------------------------------------------------------------

export interface BoletoEmailData {
  boletoId: string;
  bankReference: string | null;
  clientName: string;
  value: string;
  dueDate: string;
  installmentNumber: number;
  totalInstallments: number;
}

export function buildBoletoEmailHtml(
  company: CompanyBranding,
  data: BoletoEmailData,
): string {
  const currencyFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const installmentLabel =
    data.totalInstallments > 1
      ? `Parcela ${data.installmentNumber}/${data.totalInstallments}`
      : "Parcela única";

  const bodyContent = `
    <h2 style="color:#1e293b;margin:0 0 16px;">Boleto Bancário</h2>
    <p style="color:#475569;line-height:1.6;">
      Prezado(a) <strong>${data.clientName}</strong>,
    </p>
    <p style="color:#475569;line-height:1.6;">
      Segue em anexo o boleto bancário emitido pela empresa <strong>${company.name}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
      <tr style="background-color:#f8fafc;">
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Referência</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${data.bankReference || "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">${installmentLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:bold;color:${PRIMARY_COLOR};">${currencyFmt.format(parseFloat(data.value))}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;">Vencimento</td>
        <td style="padding:8px 12px;font-weight:bold;color:#dc2626;">${dateFmt.format(new Date(data.dueDate))}</td>
      </tr>
    </table>
    <p style="color:#475569;line-height:1.6;">
      O boleto em formato PDF segue em anexo. Por favor, efetue o pagamento até a data de vencimento para evitar juros e multas.
    </p>
  `;

  return buildEmailHtml({
    company,
    subject: `Boleto - ${installmentLabel} - ${company.name}`,
    bodyContent,
  });
}

// ---------------------------------------------------------------------------
// NFS-e Email Template
// ---------------------------------------------------------------------------

export interface NfseEmailData {
  nfNumber: string;
  clientName: string;
  serviceDescription: string;
  value: string;
  issRate: string;
  issValue: string;
  companyName: string;
}

export function buildNfseEmailHtml(
  company: CompanyBranding,
  data: NfseEmailData
): string {
  const currencyFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const bodyContent = `
    <h2 style="color:#1e293b;margin:0 0 16px;">Nota Fiscal de Serviço Eletrônica</h2>
    <p style="color:#475569;line-height:1.6;">
      Prezado(a) <strong>${data.clientName}</strong>,
    </p>
    <p style="color:#475569;line-height:1.6;">
      Segue em anexo a Nota Fiscal de Serviço emitida pela empresa <strong>${company.name}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden;">
      <tr style="background-color:#f8fafc;">
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Número NFS-e</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${data.nfNumber}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Serviço</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${data.serviceDescription}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">Valor</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:bold;color:${PRIMARY_COLOR};">${currencyFmt.format(parseFloat(data.value))}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #e5e7eb;">ISS (${data.issRate}%)</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${currencyFmt.format(parseFloat(data.issValue))}</td>
      </tr>
    </table>
    <p style="color:#475569;line-height:1.6;">
      A nota fiscal em formato PDF segue em anexo para sua conveniência.
    </p>
  `;

  return buildEmailHtml({
    company,
    subject: `NFS-e ${data.nfNumber} - ${company.name}`,
    bodyContent,
  });
}
