import { jsPDF } from "jspdf";
import type { TicketDetail, TimelineEvent, RefundSummary } from "@/app/(app)/sac/tickets/actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketPdfOptions {
  ticket: TicketDetail;
  events: TimelineEvent[];
  refunds: RefundSummary[];
  includeInternalNotes: boolean;
  includeAttachmentList: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const dateFmtShort = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function priorityLabel(p: string): string {
  switch (p) {
    case "HIGH": return "Alta";
    case "MEDIUM": return "Media";
    case "LOW": return "Baixa";
    default: return p;
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "OPEN": return "Aberto";
    case "IN_PROGRESS": return "Em Andamento";
    case "WAITING_CLIENT": return "Aguardando Cliente";
    case "RESOLVED": return "Resolvido";
    case "CLOSED": return "Fechado";
    default: return s;
  }
}

function channelLabel(c: string | null): string {
  if (!c) return "Web";
  switch (c) {
    case "EMAIL": return "Email";
    case "WHATSAPP": return "WhatsApp";
    default: return c;
  }
}

function directionLabel(d: string | null): string {
  if (!d) return "";
  switch (d) {
    case "INBOUND": return "Recebida";
    case "OUTBOUND": return "Enviada";
    default: return d;
  }
}

function refundStatusLabel(s: string): string {
  switch (s) {
    case "AWAITING_APPROVAL": return "Aguardando Aprovacao";
    case "APPROVED": return "Aprovado";
    case "REJECTED": return "Rejeitado";
    case "PROCESSING": return "Processando";
    case "COMPLETED": return "Concluido";
    default: return s;
  }
}

// ---------------------------------------------------------------------------
// PDF Generator
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 210; // A4 mm
const MARGIN_LEFT = 15;
const MARGIN_RIGHT = 15;
const MARGIN_TOP = 15;
const MARGIN_BOTTOM = 20;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

class TicketPdfBuilder {
  private doc: jsPDF;
  private y: number;
  private pageNum: number;
  private companyName: string;
  private ticketId: string;

  constructor(companyName: string, ticketId: string) {
    this.doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    this.y = MARGIN_TOP;
    this.pageNum = 1;
    this.companyName = companyName;
    this.ticketId = ticketId;
  }

  private checkPageBreak(neededHeight: number) {
    if (this.y + neededHeight > 297 - MARGIN_BOTTOM) {
      this.addFooter();
      this.doc.addPage();
      this.pageNum++;
      this.y = MARGIN_TOP;
    }
  }

  private addFooter() {
    const footer = `${this.companyName} - Ticket #${this.ticketId.substring(0, 8)} - Pagina ${this.pageNum}`;
    this.doc.setFontSize(8);
    this.doc.setTextColor(150, 150, 150);
    this.doc.text(footer, PAGE_WIDTH / 2, 297 - 10, { align: "center" });
    this.doc.setTextColor(0, 0, 0);
  }

  private addHeader(companyName: string) {
    this.doc.setFontSize(16);
    this.doc.setFont("helvetica", "bold");
    this.doc.text(companyName, MARGIN_LEFT, this.y);
    this.y += 6;

    this.doc.setFontSize(10);
    this.doc.setFont("helvetica", "normal");
    this.doc.setTextColor(100, 100, 100);
    this.doc.text(`Exportado em ${dateFmt.format(new Date())}`, MARGIN_LEFT, this.y);
    this.doc.setTextColor(0, 0, 0);
    this.y += 4;

    // Horizontal line
    this.doc.setDrawColor(200, 200, 200);
    this.doc.setLineWidth(0.5);
    this.doc.line(MARGIN_LEFT, this.y, PAGE_WIDTH - MARGIN_RIGHT, this.y);
    this.y += 6;
  }

  private addSectionTitle(title: string) {
    this.checkPageBreak(12);
    this.doc.setFontSize(12);
    this.doc.setFont("helvetica", "bold");
    this.doc.setTextColor(50, 50, 50);
    this.doc.text(title, MARGIN_LEFT, this.y);
    this.y += 2;
    this.doc.setDrawColor(220, 220, 220);
    this.doc.setLineWidth(0.3);
    this.doc.line(MARGIN_LEFT, this.y, PAGE_WIDTH - MARGIN_RIGHT, this.y);
    this.y += 5;
    this.doc.setTextColor(0, 0, 0);
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
  }

  private addField(label: string, value: string) {
    this.checkPageBreak(6);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.text(`${label}: `, MARGIN_LEFT, this.y);
    const labelWidth = this.doc.getTextWidth(`${label}: `);
    this.doc.setFont("helvetica", "normal");
    const lines = this.doc.splitTextToSize(value, CONTENT_WIDTH - labelWidth);
    this.doc.text(lines, MARGIN_LEFT + labelWidth, this.y);
    this.y += lines.length * 4.5;
  }

  private addWrappedText(text: string, indent: number = 0) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9);
    const maxWidth = CONTENT_WIDTH - indent;
    const lines = this.doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      this.checkPageBreak(5);
      this.doc.text(line, MARGIN_LEFT + indent, this.y);
      this.y += 4;
    }
  }

  build(options: TicketPdfOptions): jsPDF {
    const { ticket, events, refunds, includeInternalNotes, includeAttachmentList } = options;

    // Filter events based on options
    const filteredEvents = includeInternalNotes
      ? events
      : events.filter((e) => !e.isInternal);

    // ---- Company Header ----
    this.addHeader(ticket.company.nomeFantasia);

    // ---- Ticket Info ----
    this.addSectionTitle("Informacoes do Ticket");
    this.addField("Ticket", `#${ticket.id.substring(0, 8)}`);
    this.addField("Assunto", ticket.subject);
    this.addField("Status", statusLabel(ticket.status));
    this.addField("Prioridade", priorityLabel(ticket.priority));
    this.addField("Canal", channelLabel(ticket.channelType));
    this.addField("Criado em", dateFmt.format(new Date(ticket.createdAt)));
    this.addField("Atualizado em", dateFmt.format(new Date(ticket.updatedAt)));
    if (ticket.tags.length > 0) {
      this.addField("Tags", ticket.tags.join(", "));
    }
    this.y += 3;

    // ---- Client Info ----
    this.addSectionTitle("Cliente");
    this.addField("Nome", ticket.client.name);
    this.addField("CNPJ/CPF", ticket.client.cpfCnpj);
    if (ticket.client.email) {
      this.addField("Email", ticket.client.email);
    }
    if (ticket.contact) {
      this.addField("Contato", `${ticket.contact.name}${ticket.contact.role ? ` (${ticket.contact.role})` : ""}`);
    }
    if (ticket.assignee) {
      this.addField("Responsavel", ticket.assignee.name);
    }
    this.y += 3;

    // ---- SLA ----
    if (ticket.slaFirstReply || ticket.slaResolution) {
      this.addSectionTitle("SLA");
      if (ticket.slaFirstReply) {
        this.addField("1a Resposta", dateFmt.format(new Date(ticket.slaFirstReply)));
      }
      if (ticket.slaResolution) {
        this.addField("Resolucao", dateFmt.format(new Date(ticket.slaResolution)));
      }
      this.addField("Estourado", ticket.slaBreached ? "Sim" : "Nao");
      this.y += 3;
    }

    // ---- Description ----
    this.addSectionTitle("Descricao");
    this.addWrappedText(ticket.description || "(sem descricao)");
    this.y += 3;

    // ---- Timeline / History ----
    this.addSectionTitle("Historico Completo");

    filteredEvents.forEach((event, idx) => {
      const num = idx + 1;
      const eventDate = dateFmt.format(new Date(event.createdAt));

      // Calculate needed height for this event
      this.checkPageBreak(20);

      // Event number and type header
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(9);

      let eventTypeLabel = "";
      switch (event.type) {
        case "message":
          eventTypeLabel = event.isInternal ? "[Nota Interna]" : `[Mensagem ${channelLabel(event.channel)}]`;
          break;
        case "internal_note":
          eventTypeLabel = "[Nota Interna]";
          break;
        case "refund":
          eventTypeLabel = "[Reembolso]";
          break;
        case "status_change":
          eventTypeLabel = "[Mudanca de Status]";
          break;
      }

      // Gray background for internal notes
      if (event.isInternal || event.type === "internal_note") {
        this.doc.setFillColor(255, 250, 230);
        this.doc.rect(MARGIN_LEFT, this.y - 3.5, CONTENT_WIDTH, 5, "F");
      }

      const headerText = `#${num} ${eventTypeLabel} - ${eventDate}`;
      this.doc.text(headerText, MARGIN_LEFT, this.y);
      this.y += 4.5;

      // Sender info
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(100, 100, 100);

      const senderParts: string[] = [];
      if (event.sender) {
        senderParts.push(event.sender.name);
      } else if (event.contactName) {
        senderParts.push(`${event.contactName}${event.contactRole ? ` (${event.contactRole})` : ""}`);
      }
      if (event.direction) {
        senderParts.push(directionLabel(event.direction));
      }
      if (event.origin === "EXTERNAL") {
        senderParts.push(`via ${channelLabel(event.channel)}`);
      } else if (event.origin === "SYSTEM") {
        senderParts.push("via ERP");
      }

      if (senderParts.length > 0) {
        this.doc.text(senderParts.join(" · "), MARGIN_LEFT + 2, this.y);
        this.y += 4;
      }

      this.doc.setTextColor(0, 0, 0);

      // Content
      if (event.type === "status_change") {
        this.addWrappedText(`${statusLabel(event.oldStatus ?? "")} → ${statusLabel(event.newStatus ?? "")}`, 2);
      } else if (event.type === "refund") {
        const amount = event.refundAmount
          ? `R$ ${Number(event.refundAmount).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : "";
        this.addWrappedText(`${amount} - ${refundStatusLabel(event.refundStatus ?? "")}`, 2);
        if (event.content) {
          this.addWrappedText(event.content, 2);
        }
      } else {
        this.addWrappedText(event.content || "(sem conteudo)", 2);
      }

      // Attachments
      if (event.attachments.length > 0) {
        this.doc.setFont("helvetica", "italic");
        this.doc.setFontSize(8);
        this.doc.setTextColor(80, 80, 80);
        for (const att of event.attachments) {
          this.checkPageBreak(5);
          this.doc.text(`  📎 ${att.fileName} (${formatFileSize(att.fileSize)})`, MARGIN_LEFT + 2, this.y);
          this.y += 3.5;
        }
        this.doc.setTextColor(0, 0, 0);
        this.doc.setFont("helvetica", "normal");
      }

      // Separator line
      this.y += 2;
      this.doc.setDrawColor(230, 230, 230);
      this.doc.setLineWidth(0.2);
      this.doc.line(MARGIN_LEFT + 5, this.y, PAGE_WIDTH - MARGIN_RIGHT - 5, this.y);
      this.y += 4;
    });

    // ---- Refunds ----
    if (refunds.length > 0) {
      this.addSectionTitle("Reembolsos");

      for (const refund of refunds) {
        this.checkPageBreak(25);

        this.addField("Valor", `R$ ${refund.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
        this.addField("Status", refundStatusLabel(refund.status));
        this.addField("Solicitante", refund.requestedBy.name);
        this.addField("Data", dateFmt.format(new Date(refund.requestedAt)));
        if (refund.approvedBy) {
          this.addField(refund.status === "REJECTED" ? "Rejeitado por" : "Aprovado por", refund.approvedBy.name);
        }
        if (refund.approvedAt) {
          this.addField("Data Aprovacao", dateFmt.format(new Date(refund.approvedAt)));
        }
        if (refund.rejectionReason) {
          this.addField("Motivo Rejeicao", refund.rejectionReason);
        }
        if (refund.paymentMethod) {
          this.addField("Metodo", refund.paymentMethod);
        }
        if (refund.slaDeadline) {
          this.addField("SLA Prazo", dateFmt.format(new Date(refund.slaDeadline)));
          this.addField("SLA Estourado", refund.slaBreached ? "Sim" : "Nao");
        }
        this.y += 4;
      }
    }

    // ---- Attachment List ----
    if (includeAttachmentList) {
      const allAttachments = filteredEvents.flatMap((e) =>
        e.attachments.map((a) => ({
          ...a,
          eventDate: dateFmt.format(new Date(e.createdAt)),
          eventType: e.type,
        }))
      );

      if (allAttachments.length > 0) {
        this.addSectionTitle("Lista de Anexos");

        allAttachments.forEach((att, idx) => {
          this.checkPageBreak(6);
          this.doc.setFontSize(9);
          this.doc.setFont("helvetica", "normal");
          this.doc.text(
            `${idx + 1}. ${att.fileName} (${formatFileSize(att.fileSize)}) - ${att.eventDate}`,
            MARGIN_LEFT,
            this.y
          );
          this.y += 4.5;
        });
      }
    }

    // ---- Footer on last page ----
    this.addFooter();

    return this.doc;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateTicketPdf(options: TicketPdfOptions): void {
  const builder = new TicketPdfBuilder(
    options.ticket.company.nomeFantasia,
    options.ticket.id
  );
  const doc = builder.build(options);

  const fileName = `ticket-${options.ticket.id.substring(0, 8)}-${dateFmtShort.format(new Date()).replace(/\//g, "-")}.pdf`;
  doc.save(fileName);
}
