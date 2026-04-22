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
  RECLAMEAQUI_TOOLS,
  CNPJ_TOOLS,
  ATTACHMENT_TOOLS,
  getToolsForChannel,
  SEARCH_DOCUMENTS,
  GET_CLIENT_INFO,
  GET_HISTORY,
  RESPOND,
  RESPOND_EMAIL,
  RESPOND_RECLAMEAQUI,
  ESCALATE,
  CREATE_NOTE,
  LOOKUP_CLIENT_BY_CNPJ,
  LINK_TICKET_TO_CLIENT,
  READ_ATTACHMENT,
} from "@/lib/ai/tools";

// ─── Tool structure validation ─────────────────────────────────────────────────

describe("tool definitions — structure", () => {
  const allToolDefs = [
    SEARCH_DOCUMENTS,
    GET_CLIENT_INFO,
    GET_HISTORY,
    RESPOND,
    RESPOND_EMAIL,
    RESPOND_RECLAMEAQUI,
    ESCALATE,
    CREATE_NOTE,
    LOOKUP_CLIENT_BY_CNPJ,
    LINK_TICKET_TO_CLIENT,
    READ_ATTACHMENT,
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
    const required = GET_CLIENT_INFO.parameters.required as unknown as string[];
    expect(required).toEqual([]);
  });
});

// ─── v2 tool structure ──────────────────────────────────────────────────────

describe("v2 tool definitions — structure", () => {
  it("LOOKUP_CLIENT_BY_CNPJ requires 'cnpj' parameter", () => {
    expect(LOOKUP_CLIENT_BY_CNPJ.parameters.required).toContain("cnpj");
  });

  it("LINK_TICKET_TO_CLIENT requires 'cnpj' parameter", () => {
    expect(LINK_TICKET_TO_CLIENT.parameters.required).toContain("cnpj");
  });

  it("LINK_TICKET_TO_CLIENT has optional contactName, contactEmail, contactPhone", () => {
    const props = Object.keys(LINK_TICKET_TO_CLIENT.parameters.properties);
    expect(props).toContain("contactName");
    expect(props).toContain("contactEmail");
    expect(props).toContain("contactPhone");
    // These should NOT be required
    expect(LINK_TICKET_TO_CLIENT.parameters.required).not.toContain("contactName");
    expect(LINK_TICKET_TO_CLIENT.parameters.required).not.toContain("contactEmail");
    expect(LINK_TICKET_TO_CLIENT.parameters.required).not.toContain("contactPhone");
  });

  it("READ_ATTACHMENT requires 'attachmentId' parameter", () => {
    expect(READ_ATTACHMENT.parameters.required).toContain("attachmentId");
  });

  it("READ_ATTACHMENT has optional 'query' parameter", () => {
    const props = Object.keys(READ_ATTACHMENT.parameters.properties);
    expect(props).toContain("query");
    expect(READ_ATTACHMENT.parameters.required).not.toContain("query");
  });
});

// ─── v2 tool groups ─────────────────────────────────────────────────────────

describe("v2 tool groups", () => {
  it("CNPJ_TOOLS contains LOOKUP_CLIENT_BY_CNPJ and LINK_TICKET_TO_CLIENT", () => {
    const names = CNPJ_TOOLS.map((t) => t.name);
    expect(names).toContain("LOOKUP_CLIENT_BY_CNPJ");
    expect(names).toContain("LINK_TICKET_TO_CLIENT");
    expect(names).toHaveLength(2);
  });

  it("ATTACHMENT_TOOLS contains READ_ATTACHMENT", () => {
    const names = ATTACHMENT_TOOLS.map((t) => t.name);
    expect(names).toContain("READ_ATTACHMENT");
    expect(names).toHaveLength(1);
  });
});

// ─── Channel-based tool routing ───────────────────────────────────────────────

describe("getToolsForChannel", () => {
  it("returns WHATSAPP_TOOLS for WHATSAPP channel", () => {
    const tools = getToolsForChannel("WHATSAPP");
    expect(tools).toEqual(expect.arrayContaining(WHATSAPP_TOOLS));
  });

  it("returns EMAIL_TOOLS for EMAIL channel", () => {
    const tools = getToolsForChannel("EMAIL");
    expect(tools).toEqual(expect.arrayContaining(EMAIL_TOOLS));
  });

  it("returns RECLAMEAQUI_TOOLS for RECLAMEAQUI channel", () => {
    const tools = getToolsForChannel("RECLAMEAQUI");
    expect(tools).toEqual(expect.arrayContaining(RECLAMEAQUI_TOOLS));
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

  it("all channels include v2 tools (LOOKUP_CLIENT_BY_CNPJ, LINK_TICKET_TO_CLIENT, READ_ATTACHMENT)", () => {
    const v2ToolNames = [
      "LOOKUP_CLIENT_BY_CNPJ",
      "LINK_TICKET_TO_CLIENT",
      "READ_ATTACHMENT",
    ];

    const waNames = WHATSAPP_TOOLS.map((t) => t.name);
    const emailNames = EMAIL_TOOLS.map((t) => t.name);
    const raNames = RECLAMEAQUI_TOOLS.map((t) => t.name);

    for (const name of v2ToolNames) {
      expect(waNames, `WHATSAPP missing ${name}`).toContain(name);
      expect(emailNames, `EMAIL missing ${name}`).toContain(name);
      expect(raNames, `RECLAMEAQUI missing ${name}`).toContain(name);
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

// ─── getToolsForChannel — enabledTools filter (feat/ai-config-enabled-tools) ──

describe("getToolsForChannel — enabledTools filter", () => {
  it("returns channel tools + WORKFLOW_TOOLS when enabledTools is empty (default)", () => {
    const wa = getToolsForChannel("WHATSAPP", []);
    const waNames = wa.map((t) => t.name);
    // Channel tools are included
    for (const t of WHATSAPP_TOOLS) expect(waNames).toContain(t.name);
    // WORKFLOW_TOOLS are also included
    expect(waNames).toContain("EXECUTE_WORKFLOW");
    expect(waNames).toContain("GET_WORKFLOW_STATE");
    expect(waNames).toContain("ADVANCE_WORKFLOW");

    const ra = getToolsForChannel("RECLAMEAQUI", []);
    const raNames = ra.map((t) => t.name);
    for (const t of RECLAMEAQUI_TOOLS) expect(raNames).toContain(t.name);
    expect(raNames).toContain("EXECUTE_WORKFLOW");
  });

  it("returns channel tools + WORKFLOW_TOOLS when enabledTools is undefined", () => {
    const wa = getToolsForChannel("WHATSAPP", undefined);
    const waNames = wa.map((t) => t.name);
    for (const t of WHATSAPP_TOOLS) expect(waNames).toContain(t.name);
    expect(waNames).toContain("EXECUTE_WORKFLOW");

    const ra = getToolsForChannel("RECLAMEAQUI", undefined);
    const raNames = ra.map((t) => t.name);
    for (const t of RECLAMEAQUI_TOOLS) expect(raNames).toContain(t.name);
    expect(raNames).toContain("ADVANCE_WORKFLOW");
  });

  it("filters to only the specified tools plus always-on tools", () => {
    const result = getToolsForChannel("WHATSAPP", ["SEARCH_DOCUMENTS"]);
    const names = result.map((t) => t.name);

    // Requested tool present
    expect(names).toContain("SEARCH_DOCUMENTS");

    // Always-on tools present regardless
    expect(names).toContain("GET_HISTORY");
    expect(names).toContain("ESCALATE");
    expect(names).toContain("RESPOND");

    // Non-requested, non-always-on tools absent
    expect(names).not.toContain("GET_CLIENT_INFO");
    expect(names).not.toContain("CREATE_NOTE");
    expect(names).not.toContain("LOOKUP_CLIENT_BY_CNPJ");
    expect(names).not.toContain("READ_ATTACHMENT");
  });

  it("always-on tools are preserved even when not in enabledTools list", () => {
    // Pass a nonexistent tool ID — only always-on + WORKFLOW_TOOLS should survive
    const result = getToolsForChannel("RECLAMEAQUI", ["NONEXISTENT_TOOL"]);
    const names = result.map((t) => t.name);

    // Core always-on
    expect(names).toContain("GET_HISTORY");
    expect(names).toContain("ESCALATE");
    expect(names).toContain("RESPOND_RECLAMEAQUI");

    // WORKFLOW_TOOLS are also always-on (infrastructure)
    expect(names).toContain("EXECUTE_WORKFLOW");
    expect(names).toContain("GET_WORKFLOW_STATE");
    expect(names).toContain("ADVANCE_WORKFLOW");

    // Non-requested tools absent
    expect(names).not.toContain("SEARCH_DOCUMENTS");
    expect(names).not.toContain("GET_CLIENT_INFO");
  });

  it("EMAIL always-on includes RESPOND_EMAIL not RESPOND", () => {
    const result = getToolsForChannel("EMAIL", ["NONEXISTENT"]);
    const names = result.map((t) => t.name);

    expect(names).toContain("RESPOND_EMAIL");
    expect(names).not.toContain("RESPOND");
  });

  it("multiple enabled tools are all included", () => {
    const result = getToolsForChannel("WHATSAPP", ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO", "CREATE_NOTE"]);
    const names = result.map((t) => t.name);

    expect(names).toContain("SEARCH_DOCUMENTS");
    expect(names).toContain("GET_CLIENT_INFO");
    expect(names).toContain("CREATE_NOTE");
  });

  it("filtered result is a subset of the full channel tool set", () => {
    const full = getToolsForChannel("WHATSAPP");
    const filtered = getToolsForChannel("WHATSAPP", ["SEARCH_DOCUMENTS"]);

    for (const tool of filtered) {
      expect(full.map((t) => t.name)).toContain(tool.name);
    }
  });

  it("result never contains tools outside the channel set even if listed in enabledTools", () => {
    // RESPOND_EMAIL is not in WHATSAPP_TOOLS — should not appear even if listed
    const result = getToolsForChannel("WHATSAPP", ["RESPOND_EMAIL", "SEARCH_DOCUMENTS"]);
    const names = result.map((t) => t.name);
    expect(names).not.toContain("RESPOND_EMAIL");
  });

  it("WORKFLOW_TOOLS are always present even when enabledTools is set", () => {
    // Workflow tools are infrastructure — never filtered out
    const result = getToolsForChannel("WHATSAPP", ["SEARCH_DOCUMENTS"]);
    const names = result.map((t) => t.name);
    expect(names).toContain("EXECUTE_WORKFLOW");
    expect(names).toContain("GET_WORKFLOW_STATE");
    expect(names).toContain("ADVANCE_WORKFLOW");
  });

  it("WORKFLOW_TOOLS are present in unfiltered results too", () => {
    const result = getToolsForChannel("RECLAMEAQUI");
    const names = result.map((t) => t.name);
    expect(names).toContain("EXECUTE_WORKFLOW");
    expect(names).toContain("GET_WORKFLOW_STATE");
    expect(names).toContain("ADVANCE_WORKFLOW");
  });
});
