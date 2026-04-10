import { describe, it, expect } from "vitest";
import {
  priorityLabel,
  priorityColor,
  statusLabel,
  statusColor,
  getFeelingEmoji,
  formatCurrency,
  dateFmt,
} from "../ticket-formatters";

describe("priorityLabel", () => {
  it("returns Alta for HIGH", () => expect(priorityLabel("HIGH")).toBe("Alta"));
  it("returns Baixa for LOW", () => expect(priorityLabel("LOW")).toBe("Baixa"));
  it("returns Media for MEDIUM", () => expect(priorityLabel("MEDIUM")).toBe("Média"));
  it("returns Media for unknown", () => expect(priorityLabel("UNKNOWN")).toBe("Média"));
});

describe("priorityColor", () => {
  it("returns red classes for HIGH", () => expect(priorityColor("HIGH")).toContain("red"));
  it("returns blue classes for LOW", () => expect(priorityColor("LOW")).toContain("blue"));
  it("returns yellow classes for MEDIUM", () => expect(priorityColor("MEDIUM")).toContain("yellow"));
});

describe("statusLabel", () => {
  it("returns Aberto for OPEN", () => expect(statusLabel("OPEN")).toBe("Aberto"));
  it("returns Em Andamento for IN_PROGRESS", () => expect(statusLabel("IN_PROGRESS")).toBe("Em Andamento"));
  it("returns Aguardando Cliente for WAITING_CLIENT", () => expect(statusLabel("WAITING_CLIENT")).toBe("Aguardando Cliente"));
  it("returns Resolvido for RESOLVED", () => expect(statusLabel("RESOLVED")).toBe("Resolvido"));
  it("returns Fechado for CLOSED", () => expect(statusLabel("CLOSED")).toBe("Fechado"));
  it("returns Mergeado for MERGED", () => expect(statusLabel("MERGED")).toBe("Mergeado"));
  it("returns raw value for unknown", () => expect(statusLabel("CUSTOM")).toBe("CUSTOM"));
});

describe("statusColor", () => {
  it("returns blue for OPEN", () => expect(statusColor("OPEN")).toContain("blue"));
  it("returns yellow for IN_PROGRESS", () => expect(statusColor("IN_PROGRESS")).toContain("yellow"));
  it("returns green for RESOLVED", () => expect(statusColor("RESOLVED")).toContain("green"));
  it("returns purple for MERGED", () => expect(statusColor("MERGED")).toContain("purple"));
});

describe("getFeelingEmoji", () => {
  it("returns angry emoji for irritado", () => expect(getFeelingEmoji("irritado")).toBe("😡"));
  it("returns sad emoji for triste", () => expect(getFeelingEmoji("triste")).toBe("😢"));
  it("returns neutral emoji for neutro", () => expect(getFeelingEmoji("neutro")).toBe("😐"));
  it("returns happy emoji for satisfeito", () => expect(getFeelingEmoji("satisfeito")).toBe("😊"));
  it("returns speech emoji for unknown", () => expect(getFeelingEmoji("outro")).toBe("💬"));
  it("returns empty for null", () => expect(getFeelingEmoji(null)).toBe(""));
});

describe("formatCurrency", () => {
  it("formats number with 2 decimal places", () => {
    expect(formatCurrency(1234.5)).toBe("1.234,50");
  });
  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("0,00");
  });
});

describe("dateFmt", () => {
  it("is an Intl.DateTimeFormat instance", () => {
    expect(dateFmt).toBeInstanceOf(Intl.DateTimeFormat);
  });
});
