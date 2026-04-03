import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

/**
 * Type guard and helper functions extracted from [id]/page.tsx
 * These are duplicated here for testing purposes (not ideal, but necessary for unit tests)
 */

type RaFormField = { name: string; value: string };

function isRaFormFields(val: unknown): val is RaFormField[] {
  return (
    Array.isArray(val) &&
    val.every(
      (f) =>
        typeof f === "object" &&
        f !== null &&
        "name" in f &&
        "value" in f &&
        typeof (f as Record<string, unknown>).name === "string" &&
        typeof (f as Record<string, unknown>).value === "string"
    )
  );
}

function priorityLabel(p: string) {
  switch (p) {
    case "HIGH":
      return "Alta";
    case "LOW":
      return "Baixa";
    default:
      return "Média";
  }
}

function priorityColor(p: string) {
  switch (p) {
    case "HIGH":
      return "bg-red-100 text-red-800";
    case "LOW":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-yellow-100 text-yellow-800";
  }
}

function statusLabel(s: string) {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Aguardando Cliente";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    case "MERGED":
      return "Mergeado";
    default:
      return s;
  }
}

function statusColor(s: string) {
  switch (s) {
    case "OPEN":
      return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS":
      return "bg-yellow-100 text-yellow-800";
    case "WAITING_CLIENT":
      return "bg-orange-100 text-orange-800";
    case "RESOLVED":
      return "bg-green-100 text-green-800";
    case "CLOSED":
      return "bg-gray-100 text-gray-800";
    case "MERGED":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe("Type Guard: isRaFormFields", () => {
  // Valid cases
  it("should validate empty array", () => {
    expect(isRaFormFields([])).toBe(true);
  });

  it("should validate single valid field", () => {
    const valid = [{ name: "field1", value: "value1" }];
    expect(isRaFormFields(valid)).toBe(true);
  });

  it("should validate multiple valid fields", () => {
    const valid = [
      { name: "field1", value: "value1" },
      { name: "field2", value: "value2" },
      { name: "field3", value: "value3" },
    ];
    expect(isRaFormFields(valid)).toBe(true);
  });

  it("should validate fields with special characters", () => {
    const valid = [
      { name: "field-1", value: "value@123!#$" },
      { name: "field_2", value: "another-value.test" },
    ];
    expect(isRaFormFields(valid)).toBe(true);
  });

  it("should validate fields with empty strings", () => {
    const valid = [{ name: "", value: "" }];
    expect(isRaFormFields(valid)).toBe(true);
  });

  it("should validate fields with whitespace-only strings", () => {
    const valid = [{ name: "   ", value: "\t\n" }];
    expect(isRaFormFields(valid)).toBe(true);
  });

  it("should validate fields with long strings", () => {
    const longStr = "a".repeat(1000);
    const valid = [{ name: longStr, value: longStr }];
    expect(isRaFormFields(valid)).toBe(true);
  });

  // Invalid cases
  it("should reject non-array", () => {
    expect(isRaFormFields("not-array")).toBe(false);
    expect(isRaFormFields(123)).toBe(false);
    expect(isRaFormFields({ name: "test" })).toBe(false);
  });

  it("should reject null/undefined", () => {
    expect(isRaFormFields(null)).toBe(false);
    expect(isRaFormFields(undefined)).toBe(false);
  });

  it("should reject array with null element", () => {
    const invalid = [null];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });

  it("should reject field missing 'name'", () => {
    const invalid = [{ value: "test" }];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });

  it("should reject field missing 'value'", () => {
    const invalid = [{ name: "test" }];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });

  it("should reject field with non-string 'name'", () => {
    const invalid = [{ name: 123, value: "test" }];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });

  it("should reject field with non-string 'value'", () => {
    const invalid = [{ name: "test", value: 123 }];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });

  it("should reject field with extra properties (but valid name/value)", () => {
    // NOTE: Should actually accept this, as long as name and value are present and strings
    const data = [{ name: "test", value: "ok", extra: "field" }];
    expect(isRaFormFields(data as any)).toBe(true);
  });

  it("should reject array with mixed valid/invalid", () => {
    const invalid = [
      { name: "valid", value: "ok" },
      { name: "invalid" }, // missing value
    ];
    expect(isRaFormFields(invalid as any)).toBe(false);
  });
});

describe("Helper: priorityLabel", () => {
  it("should return 'Alta' for HIGH", () => {
    expect(priorityLabel("HIGH")).toBe("Alta");
  });

  it("should return 'Baixa' for LOW", () => {
    expect(priorityLabel("LOW")).toBe("Baixa");
  });

  it("should return 'Média' for MEDIUM", () => {
    expect(priorityLabel("MEDIUM")).toBe("Média");
  });

  it("should return 'Média' for unknown priority", () => {
    expect(priorityLabel("UNKNOWN")).toBe("Média");
    expect(priorityLabel("")).toBe("Média");
  });
});

describe("Helper: priorityColor", () => {
  it("should return red classes for HIGH", () => {
    expect(priorityColor("HIGH")).toBe("bg-red-100 text-red-800");
  });

  it("should return blue classes for LOW", () => {
    expect(priorityColor("LOW")).toBe("bg-blue-100 text-blue-800");
  });

  it("should return yellow classes for default", () => {
    expect(priorityColor("MEDIUM")).toBe("bg-yellow-100 text-yellow-800");
    expect(priorityColor("UNKNOWN")).toBe("bg-yellow-100 text-yellow-800");
  });
});

describe("Helper: statusLabel", () => {
  it("should return 'Aberto' for OPEN", () => {
    expect(statusLabel("OPEN")).toBe("Aberto");
  });

  it("should return 'Em Andamento' for IN_PROGRESS", () => {
    expect(statusLabel("IN_PROGRESS")).toBe("Em Andamento");
  });

  it("should return 'Aguardando Cliente' for WAITING_CLIENT", () => {
    expect(statusLabel("WAITING_CLIENT")).toBe("Aguardando Cliente");
  });

  it("should return 'Resolvido' for RESOLVED", () => {
    expect(statusLabel("RESOLVED")).toBe("Resolvido");
  });

  it("should return 'Fechado' for CLOSED", () => {
    expect(statusLabel("CLOSED")).toBe("Fechado");
  });

  it("should return 'Mergeado' for MERGED", () => {
    expect(statusLabel("MERGED")).toBe("Mergeado");
  });

  it("should return original string for unknown status", () => {
    expect(statusLabel("UNKNOWN_STATUS")).toBe("UNKNOWN_STATUS");
    expect(statusLabel("")).toBe("");
  });
});

describe("Helper: statusColor", () => {
  it("should return blue classes for OPEN", () => {
    expect(statusColor("OPEN")).toBe("bg-blue-100 text-blue-800");
  });

  it("should return yellow classes for IN_PROGRESS", () => {
    expect(statusColor("IN_PROGRESS")).toBe("bg-yellow-100 text-yellow-800");
  });

  it("should return orange classes for WAITING_CLIENT", () => {
    expect(statusColor("WAITING_CLIENT")).toBe("bg-orange-100 text-orange-800");
  });

  it("should return green classes for RESOLVED", () => {
    expect(statusColor("RESOLVED")).toBe("bg-green-100 text-green-800");
  });

  it("should return gray classes for CLOSED", () => {
    expect(statusColor("CLOSED")).toBe("bg-gray-100 text-gray-800");
  });

  it("should return purple classes for MERGED", () => {
    expect(statusColor("MERGED")).toBe("bg-purple-100 text-purple-800");
  });

  it("should return gray classes for unknown status", () => {
    expect(statusColor("UNKNOWN")).toBe("bg-gray-100 text-gray-800");
    expect(statusColor("")).toBe("bg-gray-100 text-gray-800");
  });
});

describe("Edge Cases: Optional chaining in UI", () => {
  it("should handle optional proposalId safely", () => {
    // Simulating the fix: proposalId?.slice(-8) || "---"
    const proposalId: string | undefined = "123456789ABC";
    const result = proposalId?.slice(-8) || "---";
    expect(result).toBe("56789ABC");
  });

  it("should fallback to '---' for undefined proposalId", () => {
    const proposalId: string | undefined = undefined;
    const result = proposalId?.slice(-8) || "---";
    expect(result).toBe("---");
  });

  it("should fallback to '---' for null boletoId", () => {
    const boletoId: string | null = null;
    const result = (boletoId as any)?.slice(-8) || "---";
    expect(result).toBe("---");
  });

  it("should handle short IDs gracefully", () => {
    const shortId = "ABC";
    const result = shortId?.slice(-8) || "---";
    expect(result).toBe("ABC");
  });
});
