import { describe, it, expect, vi, beforeEach } from "vitest";
const mockCreate = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { aiFeedback: { create: (...args: unknown[]) => mockCreate(...args) } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
import { captureFeedback, computeDiff } from "../feedback-capture";
describe("feedback-capture", () => {
  beforeEach(() => { vi.clearAllMocks(); mockCreate.mockResolvedValue({ id: "fb-1" }); });
  const base = { companyId: "c1", suggestionId: "s1", ticketId: "t1", channel: "WHATSAPP" as const, originalResponse: "Olá", confidence: 0.8 };
  describe("captureFeedback", () => {
    it("captures positive on APPROVED", async () => { const id = await captureFeedback(base, "APPROVED"); expect(id).toBe("fb-1"); expect(mockCreate.mock.calls[0][0].data.type).toBe("positive"); expect(mockCreate.mock.calls[0][0].data.diff).toBeNull(); });
    it("captures correction on EDITED", async () => { await captureFeedback(base, "EDITED", "Oi!"); const d = mockCreate.mock.calls[0][0].data; expect(d.type).toBe("correction"); expect(d.editedResponse).toBe("Oi!"); expect(d.diff).toBeDefined(); });
    it("captures negative on REJECTED", async () => { await captureFeedback(base, "REJECTED", null, "ruim"); expect(mockCreate.mock.calls[0][0].data.rejectionReason).toBe("ruim"); });
    it("handles REJECTED without reason", async () => { await captureFeedback(base, "REJECTED"); expect(mockCreate.mock.calls[0][0].data.rejectionReason).toBeNull(); });
  });
  describe("computeDiff", () => {
    it("computes word diff", () => { const d = computeDiff("hello world foo", "hello world bar baz"); expect(d.wordsAdded).toBe(2); expect(d.wordsRemoved).toBe(1); });
    it("detects minor edits", () => { const d = computeDiff("Olá como posso ajudar você hoje? Estamos à disposição para qualquer dúvida.", "Olá como posso ajudar você hoje? Estamos à disposição para qualquer pergunta."); expect(d.isMinorEdit).toBe(true); });
    it("detects major edits", () => { const d = computeDiff("Prezado cliente informamos que seu pedido está em processamento.", "Oi! Seu pedido tá sendo preparado."); expect(d.isMinorEdit).toBe(false); });
    it("handles empty", () => { expect(computeDiff("", "novo texto").wordsAdded).toBe(2); });
    it("handles identical", () => { const d = computeDiff("same", "same"); expect(d.changePercent).toBe(0); });
  });
});
