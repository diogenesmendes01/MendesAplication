/**
 * Unit tests for sanitizeEmailHtml.
 * Covers whitelist enforcement, attribute stripping, and security payloads.
 *
 * Updated for #103: now uses `sanitize-html` package instead of regex.
 */
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml } from "@/lib/ai/sanitize-utils";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sanitizeEmailHtml", () => {
  // --- Allowed tags passthrough ---

  it("preserves allowed tag <b> without attributes", () => {
    expect(sanitizeEmailHtml("<b>texto</b>")).toBe("<b>texto</b>");
  });

  it("preserves allowed tag <i>", () => {
    expect(sanitizeEmailHtml("<i>itálico</i>")).toBe("<i>itálico</i>");
  });

  it("preserves allowed tags <strong> and <em>", () => {
    expect(sanitizeEmailHtml("<strong>forte</strong> <em>ênfase</em>")).toBe(
      "<strong>forte</strong> <em>ênfase</em>"
    );
  });

  it("preserves <br> self-closing tag", () => {
    const result = sanitizeEmailHtml("linha1<br>linha2");
    expect(result).toContain("linha1");
    expect(result).toContain("linha2");
    expect(result).toMatch(/<br\s*\/?>/);
  });

  it("preserves <p>, <ul>, <li> tags", () => {
    const html = "<p>Parágrafo</p><ul><li>item</li></ul>";
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("<p>");
    expect(result).toContain("</p>");
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
    expect(result).toContain("</li>");
    expect(result).toContain("</ul>");
  });

  it("preserves <ol> ordered lists", () => {
    const html = "<ol><li>primeiro</li><li>segundo</li></ol>";
    const result = sanitizeEmailHtml(html);
    expect(result).toContain("<ol>");
    expect(result).toContain("</ol>");
  });

  it("preserves <a> tags with https href", () => {
    const html = '<a href="https://example.com">link</a>';
    expect(sanitizeEmailHtml(html)).toBe('<a href="https://example.com">link</a>');
  });

  // --- Attribute stripping from allowed tags ---

  it("strips class attribute from allowed tag: <b class='x'> → <b>", () => {
    expect(sanitizeEmailHtml('<b class="x">texto</b>')).toBe("<b>texto</b>");
  });

  it("strips style attribute from allowed tag", () => {
    expect(sanitizeEmailHtml('<p style="color:red">texto</p>')).toBe(
      "<p>texto</p>"
    );
  });

  it("strips multiple attributes from a single tag", () => {
    expect(
      sanitizeEmailHtml('<b id="foo" class="bar" data-x="y">texto</b>')
    ).toBe("<b>texto</b>");
  });

  // --- Disallowed tags removed ---

  it("removes <script> tags entirely", () => {
    const result = sanitizeEmailHtml("<script>alert(1)</script>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("</script");
  });

  it("removes <img> tags (tracking pixel prevention)", () => {
    const result = sanitizeEmailHtml('<img src="http://evil.com/pixel.gif" />');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("evil.com");
  });

  it("removes <img onerror> XSS payload", () => {
    const result = sanitizeEmailHtml('<img onerror="alert(1)" src="x" />');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("blocks <a href='javascript:'> XSS payload", () => {
    const result = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
    expect(result).toContain("click");
  });

  it("removes <div> tags but keeps text content", () => {
    const result = sanitizeEmailHtml("<div>conteúdo</div>");
    expect(result).not.toContain("<div");
    expect(result).toContain("conteúdo");
  });

  it("removes <iframe> tags", () => {
    const result = sanitizeEmailHtml('<iframe src="http://evil.com"></iframe>');
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("evil.com");
  });

  // --- Bypass attempts ---

  it("handles attribute with > embedded correctly (was KNOWN LIMITATION with regex)", () => {
    const result = sanitizeEmailHtml('<b onclick="a>b">texto</b>');
    expect(result).not.toContain("onclick");
    // sanitize-html properly parses the HTML — no leaked fragments
    expect(result).toBe("<b>texto</b>");
  });

  it("strips event handlers from allowed tags", () => {
    const result = sanitizeEmailHtml('<b onmouseover="alert(1)">texto</b>');
    expect(result).not.toContain("onmouseover");
    expect(result).toBe("<b>texto</b>");
  });

  it("removes data: URI in href", () => {
    const result = sanitizeEmailHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
    expect(result).not.toContain("data:");
  });

  it("blocks protocol-relative URL in href (//evil.com bypasses allowedSchemes)", () => {
    const result = sanitizeEmailHtml('<a href="//evil.com">click</a>');
    expect(result).not.toContain("//evil.com");
    expect(result).toContain("click");
  });

  // --- Mixed / nested HTML ---

  it("handles nested allowed inside disallowed: <div><b>ok</b></div> → <b>ok</b>", () => {
    const result = sanitizeEmailHtml("<div><b>ok</b></div>");
    expect(result).not.toContain("<div");
    expect(result).toContain("<b>ok</b>");
  });

  it("plain text without tags passes through unchanged", () => {
    const text = "Olá, tudo bem?";
    expect(sanitizeEmailHtml(text)).toBe(text);
  });

  it("empty string returns empty string", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });

  // --- Security payloads (from Tech Lead recommendation) ---

  it("removes tracking pixel <img src='http://evil.com/pixel'>", () => {
    const result = sanitizeEmailHtml('<img src="http://evil.com/pixel" />');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("evil.com");
  });

  it("removes <style> tags", () => {
    const result = sanitizeEmailHtml("<style>body{background:red}</style><p>ok</p>");
    expect(result).not.toContain("<style");
    expect(result).toContain("<p>ok</p>");
  });
});
