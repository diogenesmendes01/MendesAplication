"use client";

import { User, FileText, Info, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useChannelTheme } from "./channel-theme-provider";
import RaSuggestionCard from "../ra-suggestion-card";
import {
  priorityLabel,
  priorityColor,
  statusLabel,
  statusColor,
  channelLabel,
  dateFmt,
} from "@/lib/sac/ticket-formatters";

// --- Types ---

type RaFormField = { name: string; value: string };

function isRaFormFields(val: unknown): val is RaFormField[] {
  return (
    Array.isArray(val) &&
    val.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        "name" in f &&
        "value" in f &&
        typeof (f as Record<string, unknown>).name === "string" &&
        typeof (f as Record<string, unknown>).value === "string"
    )
  );
}

// --- SLA Card ---

function SlaCard({ label, deadline, breached }: { label: string; deadline: string; breached: boolean }) {
  const deadlineDate = new Date(deadline);
  const now = Date.now();
  const diffMs = deadlineDate.getTime() - now;

  const isBreached = breached || diffMs <= 0;
  const progressPct = isBreached ? 100 : Math.min(100, Math.max(0, 100 - (diffMs / (60 * 60_000)) * 10));

  let barColor = "#10B981";
  if (progressPct >= 90 || isBreached) barColor = "#EF4444";
  else if (progressPct >= 70) barColor = "#F59E0B";

  let sl = "OK";
  let sc = "#10B981";
  if (isBreached) { sl = "Estourado"; sc = "#EF4444"; }
  else if (progressPct >= 70) { sl = "Em Risco"; sc = "#F59E0B"; }

  let timeText: string;
  if (diffMs <= 0) {
    const overMs = Math.abs(diffMs);
    const h = Math.floor(overMs / 3_600_000);
    const m = Math.floor((overMs % 3_600_000) / 60_000);
    timeText = `-${h}h${String(m).padStart(2, "0")}m`;
  } else {
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.floor((diffMs % 3_600_000) / 60_000);
    timeText = `${h}h${String(m).padStart(2, "0")}m`;
  }

  return (
    <div className="flex-1 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase tracking-[0.05em] font-bold text-[#94a3b8]">{label}</span>
        <span className="text-[9px] font-semibold" style={{ color: sc }}>{sl}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-[#f1f5f9] overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, progressPct)}%`, backgroundColor: barColor }} />
        </div>
        <span className="text-[9px] font-mono text-[#94a3b8] w-14 text-right">{timeText}</span>
      </div>
    </div>
  );
}

// --- Props ---

interface TicketDetailsTabProps {
  ticket: {
    id: string;
    subject: string;
    description: string;
    status: string;
    priority: string;
    channelType: string | null;
    aiEnabled: boolean;
    raFormFields: unknown;
    proposalId?: string | null;
    boletoId?: string | null;
    slaFirstReply?: string | null;
    slaResolution?: string | null;
    slaBreached: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
    client: { name: string; email?: string | null };
    contact?: { name: string; role?: string | null } | null;
    company: { nomeFantasia: string };
  };
  raContext: {
    client?: { name?: string; email?: string; phone?: string } | null;
    lastSuggestion?: { id: string; content: string; createdAt: string } | null;
  } | null;
  companyId: string;
  onUseSuggestion: (message: string) => void;
  onSuggestionAction: () => void;
}

// --- Component ---

export default function TicketDetailsTab({
  ticket,
  raContext,
  companyId,
  onUseSuggestion,
  onSuggestionAction,
}: TicketDetailsTabProps) {
  const theme = useChannelTheme();
  const isRa = ticket.channelType === "RECLAMEAQUI";
  const raSuggestion = raContext?.lastSuggestion ?? null;

  function extractPublicFromSuggestion(content: string): string {
    try {
      const parsed = JSON.parse(content);
      return parsed.publicMessage ?? parsed.suggestedResponse ?? content;
    } catch {
      return content;
    }
  }

  return (
    <div className="px-5 py-4 space-y-4">
      {/* AI Suggestion (RA only) */}
      {isRa && raSuggestion && (
        <div
          className="rounded-[9px] border p-3 space-y-2"
          style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="h-[14px] w-[14px]" style={{ color: theme.primary }} />
              <span className="text-[11px] font-semibold" style={{ color: theme.primary }}>Sugestao da IA</span>
              <span className="rounded-full px-[7px] py-[2px] text-[9px] border"
                style={{ background: "#F3E8FF", color: "#7C3AED", borderColor: "#E8DAFF" }}
              >
                Pendente de aprovacao
              </span>
            </div>
            <button
              className="rounded-[5px] px-[7px] py-[2px] text-[10px] border bg-white hover:bg-[#F5F0FF] transition-colors"
              style={{ borderColor: "#DDD6FE", color: "#7C3AED" }}
              onClick={() => {
                const publicMsg = extractPublicFromSuggestion(raSuggestion.content);
                onUseSuggestion(publicMsg);
                toast.info("Sugestao copiada para a aba de Resposta Publica");
              }}
            >
              <ChevronRight className="mr-1 inline h-3 w-3" />
              Usar esta sugestao
            </button>
          </div>
          <RaSuggestionCard
            messageId={raSuggestion.id}
            companyId={companyId}
            content={raSuggestion.content}
            createdAt={raSuggestion.createdAt}
            onActionComplete={onSuggestionAction}
          />
        </div>
      )}

      {/* Mini Cards */}
      {isRa ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
          {/* Consumidor */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <User className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Consumidor</span>
            </div>
            <p className="text-[12px] font-semibold text-[#0F172A]">{raContext?.client?.name ?? ticket.client.name}</p>
            {(raContext?.client?.email ?? ticket.client.email) && (
              <p className="text-[12px] text-[#475569]">{raContext?.client?.email ?? ticket.client.email}</p>
            )}
            {raContext?.client?.phone && (
              <p className="text-[12px] text-[#475569]">{raContext.client.phone}</p>
            )}
          </div>

          {/* Dados da Reclamacao */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Dados da Reclamacao</span>
            </div>
            {isRaFormFields(ticket.raFormFields) && ticket.raFormFields.length > 0 ? (
              ticket.raFormFields.slice(0, 3).map((f, i) => (
                <div key={i}>
                  <p className="text-[12px] text-[#94a3b8]">{f.name}</p>
                  <p className="text-[12px] font-medium text-[#0F172A]">{f.value}</p>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-[#94a3b8]">Sem dados adicionais</p>
            )}
          </div>

          {/* Informacoes Gerais */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Info className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Informacoes Gerais</span>
            </div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Empresa</span><span className="font-medium truncate ml-2">{ticket.company.nomeFantasia}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Canal</span><span className="font-medium" style={{ color: theme.primary }}>Reclame Aqui</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Criado</span><span className="font-medium">{dateFmt.format(new Date(ticket.createdAt))}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Atualizado</span><span className="font-medium">{dateFmt.format(new Date(ticket.updatedAt))}</span></div>
          </div>
        </div>
      ) : (
        /* Generic mini cards (Email/WhatsApp) */
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
          {/* Cliente */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <User className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Cliente</span>
            </div>
            <p className="text-[12px] font-semibold text-[#0F172A]">{ticket.client.name}</p>
            {ticket.contact && (
              <>
                <p className="text-[12px] text-[#475569]">{ticket.contact.name}</p>
                {ticket.contact.role && <p className="text-[12px] text-[#475569]">{ticket.contact.role}</p>}
              </>
            )}
            {ticket.client.email && <p className="text-[12px] text-[#475569] truncate">{ticket.client.email}</p>}
          </div>

          {/* Dados */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Dados</span>
            </div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Prioridade</span><span className={`font-medium px-1.5 py-0.5 rounded-full ${priorityColor(ticket.priority)}`}>{priorityLabel(ticket.priority)}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Status</span><span className={`font-medium px-1.5 py-0.5 rounded-full ${statusColor(ticket.status)}`}>{statusLabel(ticket.status)}</span></div>
            {ticket.proposalId && (
              <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Proposta</span><span className="font-medium text-primary">#{ticket.proposalId.slice(-8)}</span></div>
            )}
            {ticket.boletoId && (
              <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Boleto</span><span className="font-medium text-primary">#{ticket.boletoId.slice(-8)}</span></div>
            )}
          </div>

          {/* Informacoes */}
          <div className="rounded-[9px] border p-3" style={{ background: theme.miniCardBg, borderColor: theme.miniCardBorder }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Info className="h-3 w-3" style={{ color: theme.primary }} />
              <span className="text-[9px] uppercase tracking-[0.05em] font-bold" style={{ color: theme.primary }}>Informacoes</span>
            </div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Empresa</span><span className="font-medium truncate ml-2">{ticket.company.nomeFantasia}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Canal</span><span className="font-medium">{channelLabel(ticket.channelType)}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Criado</span><span className="font-medium">{dateFmt.format(new Date(ticket.createdAt))}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#94a3b8]">Atualizado</span><span className="font-medium">{dateFmt.format(new Date(ticket.updatedAt))}</span></div>
          </div>
        </div>
      )}

      {/* SLA Bar */}
      {(ticket.slaFirstReply || ticket.slaResolution) && !["RESOLVED", "CLOSED"].includes(ticket.status) && (
        <div className="flex gap-[14px] rounded-[9px] border border-[#f1f5f9] px-[14px] py-[10px]">
          {ticket.slaFirstReply && <SlaCard label="SLA Resposta" deadline={ticket.slaFirstReply} breached={ticket.slaBreached} />}
          {ticket.slaResolution && <SlaCard label="SLA Resolucao" deadline={ticket.slaResolution} breached={ticket.slaBreached} />}
        </div>
      )}

      {/* Description */}
      <div className="rounded-[9px] border border-[#f1f5f9] bg-white p-[14px]">
        <h3 className="text-[12px] font-semibold text-[#475569] mb-2">
          {isRa ? "Descricao da Reclamacao" : "Descricao"}
        </h3>
        <p className="whitespace-pre-wrap text-[12px] text-[#64748b] leading-[1.7]">{ticket.description}</p>
      </div>
    </div>
  );
}
