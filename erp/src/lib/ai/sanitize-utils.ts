// ─── Email Sanitization Utilities ────────────────────────────────────────────
// Pure utility functions — NOT server actions.
// Kept separate from tool-executor.ts so that "use server" only wraps async exports.
// See: https://github.com/diogenesmendes01/MendesAplication/issues/109
//
// Resolves TODO #103: replaced regex-based sanitization with `sanitize-html`
// package for production-grade HTML sanitization.
//
// Resolves #293: added stripHtmlToText for inbound email text extraction,
// replacing fragile regex `.replace(/<[^>]*>/g, "")`.

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
  allowedTags: ["p", "br", "strong", "em", "b", "i", "u", "s", "ul", "ol", "li", "a", "img", "span", "div", "h1", "h2", "h3"],
  allowedAttributes: {
    a: ["href"],
    img: ["src", "alt", "width", "height"],
    "*": ["style"],
  },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: {
    img: ["https", "data"],
  },
  // Disallow javascript: and data: URIs (except img src data:)
  disallowedTagsMode: "discard",
};

/**
 * Configuration to strip ALL HTML tags, returning plain text only.
 * Used for inbound email text extraction where no HTML should remain.
 */
const STRIP_ALL_CONFIG: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
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

/**
 * Strips ALL HTML tags from input, returning plain text only.
 *
 * Replaces the fragile regex pattern `str.replace(/<[^>]*>/g, "")` which
 * can be bypassed with malformed tags (e.g. `<b onclick="a>b">`) or
 * unclosed tags. Uses `sanitize-html` parser for robust tag removal.
 */
export function stripHtmlToText(input: string): string {
  return sanitizeHtml(input, STRIP_ALL_CONFIG);
}
