/**
 * Shared helpers for suggestion-related UI components.
 * Extracted to avoid duplication across page.tsx and ai-suggestion-card.tsx.
 */

/**
 * Returns a human-readable relative time string (e.g. "há 5min", "há 2h").
 */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/**
 * Returns Tailwind classes for confidence badge coloring.
 */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-700 bg-green-100";
  if (confidence >= 0.6) return "text-yellow-700 bg-yellow-100";
  return "text-red-700 bg-red-100";
}

/**
 * Returns Tailwind class for the confidence progress bar fill.
 */
export function confidenceBarColor(confidence: number): string {
  if (confidence >= 0.8) return "bg-green-500";
  if (confidence >= 0.6) return "bg-yellow-500";
  return "bg-red-500";
}
