// ─── Email Sanitization Utilities ────────────────────────────────────────────
// Pure utility functions — NOT server actions.
// Kept separate from tool-executor.ts so that "use server" only wraps async exports.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/109

const ALLOWED_EMAIL_TAGS = new Set(["b", "i", "br", "p", "ul", "li", "strong", "em"]);

// Solução segura: strip TUDO e reinsere somente as tags permitidas via whitelist,
// sem depender de regex para preservar qualquer tag com atributos.
export function sanitizeEmailHtml(input: string): string {
  // Tira todos os atributos de todas as tags primeiro; grupos separados para open/close
  // evitam ambiguidade de captura que permitia bypass via atributos malformados.
  const noAttrs = input.replace(
    /<([a-zA-Z]+)[^>]*\/?>|<\/([a-zA-Z]+)>/gi,
    (match, openTag, closeTag) => {
      const tag = (openTag || closeTag).toLowerCase();
      if (!ALLOWED_EMAIL_TAGS.has(tag)) return "";
      return closeTag
        ? `</${tag}>`
        : match.trimEnd().endsWith("/>")
          ? `<${tag} />`
          : `<${tag}>`;
    }
  );
  return noAttrs;
}
