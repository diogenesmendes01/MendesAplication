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

  it("preserves style attribute on allowed tags (rich text support)", () => {
    expect(sanitizeEmailHtml('<p style="color:red">texto</p>')).toBe(
      '<p style="color:red">texto</p>'
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

  it("strips http:// src from <img> tags (http scheme blocked)", () => {
    const result = sanitizeEmailHtml('<img src="http://evil.com/pixel.gif" />');
    // img tag remains but src is stripped (only https/data allowed for img src)
    expect(result).not.toContain("evil.com");
    expect(result).not.toContain("http://");
  });

  it("strips onerror and JS from <img> — XSS payload neutralised", () => {
    const result = sanitizeEmailHtml('<img onerror="alert(1)" src="x" />');
    // event handler stripped; non-https src stripped; tag remains empty/harmless
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("blocks <a href='javascript:'> XSS payload", () => {
    const result = sanitizeEmailHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
    expect(result).toContain("click");
  });

  it("preserves <div> tags (rich text support)", () => {
    const result = sanitizeEmailHtml("<div>conteúdo</div>");
    expect(result).toContain("<div");
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

  // --- Mixed / nested HTML ---

  it("preserves nested <div><b>ok</b></div> (both tags now allowed)", () => {
    const result = sanitizeEmailHtml("<div><b>ok</b></div>");
    expect(result).toContain("<div");
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

  it("strips http:// tracking pixel src — evil.com not present in output", () => {
    const result = sanitizeEmailHtml('<img src="http://evil.com/pixel" />');
    expect(result).not.toContain("evil.com");
    expect(result).not.toContain("http://");
  });

  it("removes <style> tags", () => {
    const result = sanitizeEmailHtml("<style>body{background:red}</style><p>ok</p>");
    expect(result).not.toContain("<style");
    expect(result).toContain("<p>ok</p>");
  });
});

// ─── stripHtmlToText Tests (Issue #293) ──────────────────────────────────────

import { stripHtmlToText } from "@/lib/ai/sanitize-utils";

describe("stripHtmlToText", () => {
  it("strips all HTML tags and returns plain text", () => {
    expect(stripHtmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("strips <script> tags and their content", () => {
    const result = stripHtmlToText("<script>alert(1)</script>safe text");
    expect(result).not.toContain("<script");
    expect(result).toContain("safe text");
  });

  it("strips <img> tracking pixels", () => {
    const result = stripHtmlToText('text<img src="http://evil.com/pixel.gif" />more');
    expect(result).not.toContain("<img");
    expect(result).not.toContain("evil.com");
    expect(result).toContain("text");
    expect(result).toContain("more");
  });

  it("handles malformed tags that bypass regex (e.g. attribute with >)", () => {
    // The old regex `/<[^>]*>/g` would fail on this — it would match up to
    // the `>` inside the attribute, leaving a broken fragment.
    const result = stripHtmlToText('<b onclick="a>b">texto</b>');
    expect(result).not.toContain("<b");
    expect(result).not.toContain("onclick");
    expect(result).toContain("texto");
  });

  it("handles unclosed tags", () => {
    const result = stripHtmlToText("<div>content<br>more");
    expect(result).not.toContain("<div");
    expect(result).not.toContain("<br");
    expect(result).toContain("content");
    expect(result).toContain("more");
  });

  it("passes plain text through unchanged", () => {
    expect(stripHtmlToText("just plain text")).toBe("just plain text");
  });

  it("returns empty string for empty input", () => {
    expect(stripHtmlToText("")).toBe("");
  });

  it("strips nested HTML completely", () => {
    const result = stripHtmlToText("<div><p><b>deep</b></p></div>");
    expect(result).toBe("deep");
  });

  it("strips <style> tags", () => {
    const result = stripHtmlToText("<style>body{color:red}</style>text");
    expect(result).not.toContain("<style");
    expect(result).toContain("text");
  });
});
