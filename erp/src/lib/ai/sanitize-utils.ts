// ─── Email Sanitization Utilities ────────────────────────────────────────────
// Pure utility functions — NOT server actions.
// Kept separate from tool-executor.ts so that "use server" only wraps async exports.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/109
//
// Resolves TODO #103: replaced regex-based sanitization with `sanitize-html`
// package for production-grade HTML sanitization.

import sanitizeHtml from "sanitize-html";

/**
 * Restrictive sanitize-html configuration for outbound emails.
 *
 * - Only allows safe formatting tags: p, br, strong, em, b, i, ul, ol, li, a
 * - For <a> tags: only `href` attribute is allowed, and `javascript:` protocol is blocked
 * - All other tags and attributes are stripped
 * - Prevents: XSS, tracking pixels, phishing links via img/script/iframe, etc.
 */
const EMAIL_SANITIZE_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "b", "i", "ul", "ol", "li", "a"],
  allowedAttributes: {
    a: ["href"],
  },
  allowedSchemes: ["https", "mailto"],
  allowProtocolRelative: false,
  // Disallow javascript: and data: URIs
  disallowedTagsMode: "discard",
};

/**
 * Sanitizes LLM-generated HTML before email dispatch.
 *
 * Uses `sanitize-html` with a restrictive allow-list to prevent
 * prompt-injection attacks where inbound email content could cause
 * the LLM to emit malicious HTML (tracking pixels, phishing links,
 * arbitrary scripts) in outgoing replies.
 */
export function sanitizeEmailHtml(input: string): string {
  return sanitizeHtml(input, EMAIL_SANITIZE_CONFIG);
}
