/**
 * Unit tests for sanitizeEmailHtml.
 * Covers whitelist enforcement, attribute stripping, and bypass attempts
 * via malformed attributes containing `>`.
 *
 * Imports from sanitize-utils (pure module, no "use server" side effects).
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

  // --- Attribute stripping from allowed tags ---

  it("strips simple class attribute from allowed tag: <b class='x'> → <b>", () => {
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

  it("removes <img> tags", () => {
    const result = sanitizeEmailHtml('<img src="evil.jpg" />');
    expect(result).not.toContain("<img");
  });

  it("removes <a href> tags", () => {
    const result = sanitizeEmailHtml('<a href="http://evil.com">click</a>');
    expect(result).not.toContain("<a");
    expect(result).not.toContain("</a");
    expect(result).toContain("click");
  });

  it("removes <div> tags but keeps text content", () => {
    const result = sanitizeEmailHtml("<div>conteúdo</div>");
    expect(result).not.toContain("<div");
    expect(result).toContain("conteúdo");
  });

  // --- Bypass attempts via attribute with embedded `>` ---

  it("handles attribute with > embedded: <b onclick='a>b'> → <b>", () => {
    // This is the key bypass case documented in WARN-1.
    const result = sanitizeEmailHtml('<b onclick="a>b">texto</b>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("<b>");
    expect(result).toContain("texto");
  });

  // WARN-4: documents exact (broken) output when attribute contains `>`.
  // The regex [^>]* stops at the first `>` inside the attribute value, so the
  // fragment `b">` leaks as visible text in the email body.
  // Current output: `<b>b">texto</b>` — the `b">` fragment is visible noise.
  // Expected output after TODO #103 (sanitize-html): `<b>texto</b>`.
  // ⚠️ This test will FAIL when TODO #103 is resolved — update toBe() to "<b>texto</b>" then.
  it("KNOWN LIMITATION: attribute with > leaks fragment into output until TODO #103 (sanitize-html)", () => {
    const result = sanitizeEmailHtml('<b onclick="a>b">texto</b>');
    // Documents the current broken output. Remove/update when TODO #103 is done.
    expect(result).toBe('<b>b">texto</b>');
  });

  it("handles attribute with > in single quotes", () => {
    const result = sanitizeEmailHtml("<b onmouseover='x>y'>texto</b>");
    expect(result).not.toContain("onmouseover");
    expect(result).toContain("<b>");
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
});
