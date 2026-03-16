/**
 * Unit tests for AI tool definitions and channel-based tool routing.
 * Ensures that tools are correctly structured for the OpenAI function-calling
 * format and that channel routing returns the right tool sets.
 *
 * See: https://github.com/diogenesmendes01/MendesAplication/issues/155
 */
import { describe, it, expect } from "vitest";
import {
  ALL_TOOLS,
  WHATSAPP_TOOLS,
  EMAIL_TOOLS,
  getToolsForChannel,
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  RESPOND,
  RESPOND_EMAIL,
  ESCALATE,
  CREATE_NOTE,
} from "@/lib/ai/tools";

// ─── Tool structure validation ─────────────────────────────────────────────────

describe("tool definitions — structure", () => {
  const allToolDefs = [
    SEARCH_DOCUMENTS,
    GET_CLIENT_INFO,
    GET_HISTORY,
    RESPOND,
    RESPOND_EMAIL,
    ESCALATE,
    CREATE_NOTE,
  ];

  it.each(allToolDefs.map((t) => [t.name, t]))(
    "%s has required fields: name, description, parameters",
    (_name, tool) => {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);

      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.properties).toBeDefined();
    },
  );

  it("tool names are unique", () => {
    const names = allToolDefs.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("RESPOND requires 'message' parameter", () => {
    expect(RESPOND.parameters.required).toContain("message");
  });

  it("RESPOND_EMAIL requires 'subject' and 'message' parameters", () => {
    expect(RESPOND_EMAIL.parameters.required).toContain("subject");
    expect(RESPOND_EMAIL.parameters.required).toContain("message");
  });

  it("ESCALATE requires 'reason' parameter", () => {
    expect(ESCALATE.parameters.required).toContain("reason");
  });

  it("SEARCH_DOCUMENTS requires 'query' parameter", () => {
    expect(SEARCH_DOCUMENTS.parameters.required).toContain("query");
  });

  it("GET_CLIENT_INFO has no required parameters", () => {
    const required = GET_CLIENT_INFO.parameters.required as string[];
    expect(required).toEqual([]);
  });
});

// ─── Channel-based tool routing ───────────────────────────────────────────────

describe("getToolsForChannel", () => {
  it("returns WHATSAPP_TOOLS for WHATSAPP channel", () => {
    const tools = getToolsForChannel("WHATSAPP");
    expect(tools).toBe(WHATSAPP_TOOLS);
  });

  it("returns EMAIL_TOOLS for EMAIL channel", () => {
    const tools = getToolsForChannel("EMAIL");
    expect(tools).toBe(EMAIL_TOOLS);
  });

  it("WHATSAPP_TOOLS includes RESPOND but not RESPOND_EMAIL", () => {
    const names = WHATSAPP_TOOLS.map((t) => t.name);
    expect(names).toContain("RESPOND");
    expect(names).not.toContain("RESPOND_EMAIL");
  });

  it("EMAIL_TOOLS includes RESPOND_EMAIL but not RESPOND", () => {
    const names = EMAIL_TOOLS.map((t) => t.name);
    expect(names).toContain("RESPOND_EMAIL");
    expect(names).not.toContain("RESPOND");
  });

  it("both channels include shared tools (SEARCH_DOCUMENTS, GET_CLIENT_INFO, ESCALATE, CREATE_NOTE, GET_HISTORY)", () => {
    const sharedToolNames = [
      "SEARCH_DOCUMENTS",
      "GET_CLIENT_INFO",
      "GET_HISTORY",
      "ESCALATE",
      "CREATE_NOTE",
    ];

    const waNames = WHATSAPP_TOOLS.map((t) => t.name);
    const emailNames = EMAIL_TOOLS.map((t) => t.name);

    for (const name of sharedToolNames) {
      expect(waNames, `WHATSAPP missing ${name}`).toContain(name);
      expect(emailNames, `EMAIL missing ${name}`).toContain(name);
    }
  });
});

// ─── ALL_TOOLS (legacy) ───────────────────────────────────────────────────────

describe("ALL_TOOLS", () => {
  it("includes RESPOND (WhatsApp legacy default)", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toContain("RESPOND");
  });

  it("does NOT include RESPOND_EMAIL (email-only tool)", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).not.toContain("RESPOND_EMAIL");
  });

  it("has exactly 6 tools", () => {
    expect(ALL_TOOLS).toHaveLength(6);
  });
});
