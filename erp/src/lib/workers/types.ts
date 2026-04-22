// ---------------------------------------------------------------------------
// Shared worker types
// ---------------------------------------------------------------------------

export interface AiAgentJobData {
  ticketId: string;
  companyId: string;
  messageContent: string;
  messageId?: string; // Inbound TicketMessage id that triggered the agent
  channel?: "WHATSAPP" | "EMAIL" | "RECLAMEAQUI";
  /** Enriched RA ticket context for better AI suggestions */
  raContext?: import("@/lib/reclameaqui/types").RaAiContext;
  /** Flag indicating this job was re-queued from recovery */
  isRecovery?: boolean;
}
