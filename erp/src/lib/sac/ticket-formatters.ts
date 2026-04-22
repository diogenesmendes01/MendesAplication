/**
 * Shared label/color utilities for SAC ticket display.
 * Eliminates duplication across ticket-table, master-dashboard,
 * ticket-dashboard, page.tsx, ticket-timeline, suggestions, etc.
 */

// ---------------------------------------------------------------------------
// Date formatter (shared)
// ---------------------------------------------------------------------------

export const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export function priorityLabel(p: string): string {
  switch (p) {
    case "HIGH":
      return "Alta";
    case "LOW":
      return "Baixa";
    default:
      return "Média";
  }
}

export function priorityColor(p: string): string {
  switch (p) {
    case "HIGH":
      return "bg-red-100 text-red-800";
    case "LOW":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}

/** Text-only variant for inline spans (no background). */
export function priorityTextColor(p: string): string {
  switch (p) {
    case "HIGH":
      return "text-red-600";
    case "LOW":
      return "text-blue-600";
    default:
      return "text-yellow-600";
  }
}

export function priorityVariant(
  priority: string
): "destructive" | "secondary" | "outline" {
  switch (priority) {
    case "HIGH":
      return "destructive";
    case "MEDIUM":
      return "secondary";
    default:
      return "outline";
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function statusLabel(s: string): string {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Aguardando Cliente";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    case "MERGED":
      return "Mergeado";
    default:
      return s;
  }
}

export function statusLabelShort(s: string): string {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Ag. Cliente";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    case "MERGED":
      return "Mergeado";
    default:
      return s;
  }
}

export function statusColor(s: string): string {
  switch (s) {
    case "OPEN":
      return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS":
      return "bg-yellow-100 text-yellow-800";
    case "WAITING_CLIENT":
      return "bg-orange-100 text-orange-800";
    case "RESOLVED":
      return "bg-green-100 text-green-800";
    case "CLOSED":
      return "bg-gray-100 text-gray-800";
    case "MERGED":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export function channelLabel(channel: string | null): string {
  switch (channel) {
    case "EMAIL":
      return "Email";
    case "WHATSAPP":
      return "WhatsApp";
    case "RECLAMEAQUI":
      return "Reclame Aqui";
    default:
      return "Web";
  }
}

export function channelColor(channel: string): string {
  switch (channel) {
    case "EMAIL":
      return "#3b82f6";
    case "WHATSAPP":
      return "#22c55e";
    case "RECLAMEAQUI":
      return "#8b5cf6";
    default:
      return "#94a3b8";
  }
}

// ---------------------------------------------------------------------------
// Hex colors (for charts / Recharts <Cell fill={...} />)
// ---------------------------------------------------------------------------

/** Hex color for priority — use in Recharts or inline SVG fills. */
export function priorityHexColor(p: string): string {
  switch (p) {
    case "HIGH":
      return "#ef4444";
    case "LOW":
      return "#3b82f6";
    default:
      return "#eab308";
  }
}

// ---------------------------------------------------------------------------
// Feeling emoji (RA)
// ---------------------------------------------------------------------------

export function getFeelingEmoji(feeling: string | null): string {
  if (!feeling) return "";
  const f = feeling.toLowerCase();
  if (f.includes("irritado") || f.includes("raiva")) return "😡";
  if (f.includes("triste") || f.includes("decepcionado")) return "😢";
  if (f.includes("neutro")) return "😐";
  if (f.includes("satisfeito")) return "😊";
  return "💬";
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

export function formatCurrency(value: number): string {
  const [int, dec = ""] = value.toFixed(2).split(".");
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted},${dec}`;
}
