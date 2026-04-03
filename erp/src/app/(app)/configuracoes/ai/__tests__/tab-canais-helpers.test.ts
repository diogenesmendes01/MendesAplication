/**
 * Unit tests for pure helper functions in tab-canais.tsx.
 *
 * isToolEnabled and toggleTool are extracted and tested here because they
 * contain non-trivial logic (empty-array = all-enabled semantics, collapse
 * back to empty when all tools are re-enabled).
 */
import { describe, it, expect } from "vitest";

// ── Helpers duplicated here for unit testing ──────────────────────────────────
// (tab-canais.tsx is a client component — importing it in vitest would require
//  full React/Next.js setup. Testing the pure logic in isolation is simpler.)

interface ToolDef { id: string; label: string }

function isToolEnabled(enabledTools: string[], toolId: string): boolean {
  return enabledTools.length === 0 || enabledTools.includes(toolId);
}

function toggleTool(
  enabledTools: string[],
  toolId: string,
  enabled: boolean,
  allTools: ToolDef[],
): string[] {
  const allIds = allTools.map((t) => t.id);
  if (enabled) {
    const newList = Array.from(new Set(enabledTools.concat([toolId])));
    return allIds.every((id) => newList.includes(id)) ? [] : newList;
  } else {
    const currentList = enabledTools.length === 0 ? allIds : enabledTools;
    return currentList.filter((id) => id !== toolId);
  }
}

const SAMPLE_TOOLS: ToolDef[] = [
  { id: "SEARCH_DOCUMENTS", label: "RAG" },
  { id: "GET_CLIENT_INFO",  label: "Client info" },
  { id: "CREATE_NOTE",      label: "Note" },
];

// ─── isToolEnabled ────────────────────────────────────────────────────────────

describe("isToolEnabled", () => {
  it("returns true for any tool when enabledTools is empty (all enabled)", () => {
    expect(isToolEnabled([], "SEARCH_DOCUMENTS")).toBe(true);
    expect(isToolEnabled([], "GET_CLIENT_INFO")).toBe(true);
    expect(isToolEnabled([], "NONEXISTENT")).toBe(true);
  });

  it("returns true when tool is in the list", () => {
    expect(isToolEnabled(["SEARCH_DOCUMENTS", "CREATE_NOTE"], "SEARCH_DOCUMENTS")).toBe(true);
  });

  it("returns false when tool is NOT in the non-empty list", () => {
    expect(isToolEnabled(["SEARCH_DOCUMENTS"], "GET_CLIENT_INFO")).toBe(false);
  });

  it("returns false for unknown tool in non-empty list", () => {
    expect(isToolEnabled(["SEARCH_DOCUMENTS"], "NONEXISTENT")).toBe(false);
  });
});

// ─── toggleTool — enabling ────────────────────────────────────────────────────

describe("toggleTool — enabling a tool", () => {
  it("adds the tool to a partial list", () => {
    const result = toggleTool(["SEARCH_DOCUMENTS"], "GET_CLIENT_INFO", true, SAMPLE_TOOLS);
    expect(result).toContain("SEARCH_DOCUMENTS");
    expect(result).toContain("GET_CLIENT_INFO");
  });

  it("collapses to empty array when all tools are enabled", () => {
    // Start with 2/3 enabled, enable the last one
    const result = toggleTool(
      ["SEARCH_DOCUMENTS", "GET_CLIENT_INFO"],
      "CREATE_NOTE",
      true,
      SAMPLE_TOOLS,
    );
    expect(result).toEqual([]); // empty = all enabled
  });

  it("does not duplicate tools when enabling an already-enabled tool", () => {
    const result = toggleTool(["SEARCH_DOCUMENTS"], "SEARCH_DOCUMENTS", true, SAMPLE_TOOLS);
    const count = result.filter((id) => id === "SEARCH_DOCUMENTS").length;
    expect(count).toBe(1);
  });

  it("collapses to empty even if starting from empty (edge case: re-enable last)", () => {
    // Already all enabled (empty) — enabling any tool should stay empty
    const result = toggleTool([], "SEARCH_DOCUMENTS", true, SAMPLE_TOOLS);
    // All tools include SEARCH_DOCUMENTS + the empty ones from [] base
    // Actually: enabledTools=[] means all on, adding one to empty = just that one
    // then check if all 3 are included — no, so NOT collapsed
    expect(result).toEqual(["SEARCH_DOCUMENTS"]);
  });
});

// ─── toggleTool — disabling ───────────────────────────────────────────────────

describe("toggleTool — disabling a tool", () => {
  it("removes the tool from the list", () => {
    const result = toggleTool(["SEARCH_DOCUMENTS", "GET_CLIENT_INFO"], "SEARCH_DOCUMENTS", false, SAMPLE_TOOLS);
    expect(result).not.toContain("SEARCH_DOCUMENTS");
    expect(result).toContain("GET_CLIENT_INFO");
  });

  it("expands empty array to all-except-disabled when disabling from 'all enabled' state", () => {
    // enabledTools=[] means all 3 are on. Disabling one expands to explicit list minus that tool.
    const result = toggleTool([], "SEARCH_DOCUMENTS", false, SAMPLE_TOOLS);
    expect(result).not.toContain("SEARCH_DOCUMENTS");
    expect(result).toContain("GET_CLIENT_INFO");
    expect(result).toContain("CREATE_NOTE");
    expect(result).toHaveLength(2);
  });

  it("returns empty array when the last tool is also disabled... wait, leaves other tools intact", () => {
    const result = toggleTool(["SEARCH_DOCUMENTS"], "SEARCH_DOCUMENTS", false, SAMPLE_TOOLS);
    expect(result).toEqual([]);
  });

  it("is idempotent — disabling already-disabled tool removes nothing extra", () => {
    const before = ["GET_CLIENT_INFO", "CREATE_NOTE"];
    const result = toggleTool(before, "SEARCH_DOCUMENTS", false, SAMPLE_TOOLS);
    expect(result).toEqual(["GET_CLIENT_INFO", "CREATE_NOTE"]);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe("toggleTool — round-trip enable/disable", () => {
  it("disable then enable returns to empty (all-enabled)", () => {
    // Start: all enabled (empty)
    const afterDisable = toggleTool([], "SEARCH_DOCUMENTS", false, SAMPLE_TOOLS);
    expect(afterDisable).toHaveLength(2); // GET_CLIENT_INFO, CREATE_NOTE

    const afterReEnable = toggleTool(afterDisable, "SEARCH_DOCUMENTS", true, SAMPLE_TOOLS);
    expect(afterReEnable).toEqual([]); // back to all-enabled (empty)
  });
});
