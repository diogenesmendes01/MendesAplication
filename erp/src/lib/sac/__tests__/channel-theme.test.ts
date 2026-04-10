import { describe, it, expect } from "vitest";
import { getChannelTheme } from "../channel-theme";

describe("getChannelTheme", () => {
  it("returns purple theme for RECLAMEAQUI", () => {
    const theme = getChannelTheme("RECLAMEAQUI");
    expect(theme.id).toBe("RECLAMEAQUI");
    expect(theme.primary).toBe("#7C3AED");
    expect(theme.label).toBe("Reclame Aqui");
  });

  it("returns blue theme for EMAIL", () => {
    const theme = getChannelTheme("EMAIL");
    expect(theme.id).toBe("EMAIL");
    expect(theme.primary).toBe("#2563EB");
    expect(theme.label).toBe("Email");
  });

  it("returns green theme for WHATSAPP", () => {
    const theme = getChannelTheme("WHATSAPP");
    expect(theme.id).toBe("WHATSAPP");
    expect(theme.primary).toBe("#059669");
    expect(theme.label).toBe("WhatsApp");
  });

  it("returns EMAIL theme as default for null", () => {
    const theme = getChannelTheme(null);
    expect(theme.id).toBe("EMAIL");
  });

  it("returns EMAIL theme as default for unknown string", () => {
    const theme = getChannelTheme("UNKNOWN");
    expect(theme.id).toBe("EMAIL");
  });

  it("includes header gradient colors", () => {
    const theme = getChannelTheme("RECLAMEAQUI");
    expect(theme.headerBg).toContain("linear-gradient");
    expect(theme.headerBorder).toBe("#E8DAFF");
  });

  it("includes button styles", () => {
    const theme = getChannelTheme("RECLAMEAQUI");
    expect(theme.btnPrimaryBg).toBe("#7C3AED");
    expect(theme.btnPrimaryHover).toBe("#6D28D9");
    expect(theme.btnOutlineBorder).toBe("#DDD6FE");
    expect(theme.btnOutlineColor).toBe("#7C3AED");
  });

  it("includes mini-card styles", () => {
    const theme = getChannelTheme("RECLAMEAQUI");
    expect(theme.miniCardBg).toBe("#FDFAFF");
    expect(theme.miniCardBorder).toBe("#E8DAFF");
  });

  it("includes tab active color", () => {
    const theme = getChannelTheme("WHATSAPP");
    expect(theme.tabActive).toBe("#059669");
  });

  it("includes title color", () => {
    const theme = getChannelTheme("RECLAMEAQUI");
    expect(theme.titleColor).toBe("#4C1D95");
  });
});
