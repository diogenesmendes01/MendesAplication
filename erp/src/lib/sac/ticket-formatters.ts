export const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function priorityLabel(p: string): string {
  switch (p) {
    case "HIGH": return "Alta";
    case "LOW": return "Baixa";
    default: return "Média";
  }
}

export function priorityColor(p: string): string {
  switch (p) {
    case "HIGH": return "bg-red-100 text-red-800";
    case "LOW": return "bg-blue-100 text-blue-800";
    default: return "bg-yellow-100 text-yellow-800";
  }
}

export function statusLabel(s: string): string {
  switch (s) {
    case "OPEN": return "Aberto";
    case "IN_PROGRESS": return "Em Andamento";
    case "WAITING_CLIENT": return "Aguardando Cliente";
    case "RESOLVED": return "Resolvido";
    case "CLOSED": return "Fechado";
    case "MERGED": return "Mergeado";
    default: return s;
  }
}

export function statusColor(s: string): string {
  switch (s) {
    case "OPEN": return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS": return "bg-yellow-100 text-yellow-800";
    case "WAITING_CLIENT": return "bg-orange-100 text-orange-800";
    case "RESOLVED": return "bg-green-100 text-green-800";
    case "CLOSED": return "bg-gray-100 text-gray-800";
    case "MERGED": return "bg-purple-100 text-purple-800";
    default: return "bg-gray-100 text-gray-800";
  }
}

export function getFeelingEmoji(feeling: string | null): string {
  if (!feeling) return "";
  const f = feeling.toLowerCase();
  if (f.includes("irritado") || f.includes("raiva")) return "😡";
  if (f.includes("triste") || f.includes("decepcionado")) return "😢";
  if (f.includes("neutro")) return "😐";
  if (f.includes("satisfeito")) return "😊";
  return "💬";
}

export function formatCurrency(value: number): string {
  const [int, dec = ""] = value.toFixed(2).split(".");
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${formatted},${dec}`;
}
