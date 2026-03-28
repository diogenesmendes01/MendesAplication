import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClientFindMany = vi.fn();
const mockTicketFindUnique = vi.fn();
const mockTicketUpdate = vi.fn();
const mockTicketMessageCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    client: { findFirst: vi.fn(), findMany: (...a: unknown[]) => mockClientFindMany(...a) },
    accountReceivable: { findMany: vi.fn(), update: vi.fn() },
    ticket: { findUnique: (...a: unknown[]) => mockTicketFindUnique(...a), update: (...a: unknown[]) => mockTicketUpdate(...a) },
    ticketMessage: { create: (...a: unknown[]) => mockTicketMessageCreate(...a) },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { executeBlock, interpolate, interpolateRecord, evaluateCondition } from "../workflow-blocks";
import type { BlockContext } from "../workflow-blocks";
import type { CollectInfoConfig, SearchConfig, RespondConfig, WaitConfig, SendAttachmentConfig, SetTagConfig, ConditionConfig, EscalateConfig } from "../workflow-types";

const BASE_CTX: BlockContext = { companyId: "c1", ticketId: "t1", channel: "WHATSAPP", stepData: {} };
function ctx(stepData: Record<string, unknown> = {}): BlockContext { return { ...BASE_CTX, stepData }; }

describe("interpolate", () => {
  it("replaces simple vars", () => expect(interpolate("CNPJ: ${cnpj}", { cnpj: "12345" })).toBe("CNPJ: 12345"));
  it("handles nested dot notation", () => expect(interpolate("${a.b}", { a: { b: 5 } })).toBe("5"));
  it("keeps unreplaced vars", () => expect(interpolate("${x}", {})).toBe("${x}"));
  it("handles null", () => expect(interpolate("${v}", { v: null })).toBe("${v}"));
});

describe("interpolateRecord", () => {
  it("interpolates all values", () => {
    expect(interpolateRecord({ a: "${x}", b: "static" }, { x: "1" })).toEqual({ a: "1", b: "static" });
  });
});

describe("COLLECT_INFO", () => {
  it("skips if already collected", async () => {
    const r = await executeBlock("COLLECT_INFO", { campo: "cnpj", obrigatorio: true } as CollectInfoConfig, ctx({ cnpj: "123" }));
    expect(r.success).toBe(true);
    expect(r.message).toContain("já coletado");
  });

  it("returns prompt for mandatory missing field", async () => {
    const r = await executeBlock("COLLECT_INFO", { campo: "cnpj", obrigatorio: true, promptPorCanal: { WHATSAPP: "Informe CNPJ" } } as CollectInfoConfig, ctx());
    expect(r.message).toBe("Informe CNPJ");
    expect(r.data?._pendingField).toBe("cnpj");
  });

  it("uses channel-specific prompt", async () => {
    const r = await executeBlock("COLLECT_INFO", { campo: "x", obrigatorio: true, promptPorCanal: { WHATSAPP: "WA", EMAIL: "EM" } } as CollectInfoConfig, { ...BASE_CTX, channel: "EMAIL" });
    expect(r.message).toBe("EM");
  });

  it("skips optional field", async () => {
    const r = await executeBlock("COLLECT_INFO", { campo: "obs", obrigatorio: false } as CollectInfoConfig, ctx());
    expect(r.message).toContain("opcional");
  });
});

describe("SEARCH", () => {
  beforeEach(() => vi.clearAllMocks());

  it("errors on unknown entity", async () => {
    expect((await executeBlock("SEARCH", { entidade: "unknown", filtro: {} } as SearchConfig, ctx())).success).toBe(false);
  });

  it("searches cliente by cnpj", async () => {
    mockClientFindMany.mockResolvedValue([{ id: "c1" }]);
    const r = await executeBlock("SEARCH", { entidade: "cliente", filtro: { cnpj: "${cnpj}" } } as SearchConfig, ctx({ cnpj: "123" }));
    expect(r.success).toBe(true);
    expect(r.data?.total).toBe(1);
  });
});

describe("RESPOND", () => {
  it("uses channel template", async () => {
    const r = await executeBlock("RESPOND", { templatePorCanal: { WHATSAPP: "OK ✅" } } as RespondConfig, ctx());
    expect(r.message).toBe("OK ✅");
  });

  it("interpolates variables", async () => {
    const r = await executeBlock("RESPOND", { templatePorCanal: { WHATSAPP: "CNPJ: ${cnpj}" } } as RespondConfig, ctx({ cnpj: "12345" }));
    expect(r.message).toBe("CNPJ: 12345");
  });

  it("handles RA dual response", async () => {
    const r = await executeBlock("RESPOND", { templatePorCanal: { RECLAMEAQUI: { publico: "Pub", privado: "Priv" } } } as RespondConfig, { ...BASE_CTX, channel: "RECLAMEAQUI" });
    const parsed = JSON.parse(r.message!);
    expect(parsed.publico).toBe("Pub");
  });

  it("uses fallback template", async () => {
    const r = await executeBlock("RESPOND", { templatePorCanal: { EMAIL: "Email" } } as RespondConfig, ctx());
    expect(r.message).toBe("Email");
  });
});

describe("WAIT", () => {
  it("signals pause", async () => {
    const r = await executeBlock("WAIT", { quem: "humano", condicao: "Aprovação", timeoutHoras: 48 } as WaitConfig, ctx());
    expect(r.shouldPause).toBe(true);
    expect(r.data?.waitingFor).toBe("humano");
  });
});

describe("SEND_ATTACHMENT", () => {
  it("skips for RA", async () => {
    const r = await executeBlock("SEND_ATTACHMENT", { source: "busca", porCanal: { RECLAMEAQUI: false }, fallbackTexto: "Texto" } as SendAttachmentConfig, { ...BASE_CTX, channel: "RECLAMEAQUI" });
    expect(r.data?.skipped).toBe(true);
    expect(r.message).toBe("Texto");
  });

  it("processes supported channel", async () => {
    const r = await executeBlock("SEND_ATTACHMENT", { source: "busca", referenciaStep: "s", porCanal: { WHATSAPP: true } } as SendAttachmentConfig, ctx({ s: {} }));
    expect(r.data?.attachmentSent).toBe(true);
  });
});

describe("SET_TAG", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adds tag", async () => {
    mockTicketFindUnique.mockResolvedValue({ tags: ["a"] });
    mockTicketUpdate.mockResolvedValue({});
    const r = await executeBlock("SET_TAG", { alvo: "ticket", acao: "adicionar_tag", valor: "b" } as SetTagConfig, ctx());
    expect(r.success).toBe(true);
    expect(mockTicketUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { tags: ["a", "b"] } }));
  });

  it("removes tag", async () => {
    mockTicketFindUnique.mockResolvedValue({ tags: ["a", "b"] });
    mockTicketUpdate.mockResolvedValue({});
    await executeBlock("SET_TAG", { alvo: "ticket", acao: "remover_tag", valor: "a" } as SetTagConfig, ctx());
    expect(mockTicketUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { tags: ["b"] } }));
  });
});

describe("CONDITION / evaluateCondition", () => {
  it("maior", () => {
    const { result, nextStepId } = evaluateCondition({ se: { campo: "a.b", operador: "maior", valor: 0 }, entao: "yes", senao: "no" }, { a: { b: 5 } });
    expect(result).toBe(true);
    expect(nextStepId).toBe("yes");
  });
  it("igual", () => expect(evaluateCondition({ se: { campo: "s", operador: "igual", valor: "X" }, entao: "a", senao: "b" }, { s: "X" }).result).toBe(true));
  it("existe", () => {
    expect(evaluateCondition({ se: { campo: "x", operador: "existe", valor: null }, entao: "a", senao: "b" }, { x: "v" }).result).toBe(true);
    expect(evaluateCondition({ se: { campo: "x", operador: "existe", valor: null }, entao: "a", senao: "b" }, {}).result).toBe(false);
  });
  it("nao_existe", () => expect(evaluateCondition({ se: { campo: "x", operador: "nao_existe", valor: null }, entao: "a", senao: "b" }, {}).result).toBe(true));
  it("contem", () => expect(evaluateCondition({ se: { campo: "m", operador: "contem", valor: "bol" }, entao: "a", senao: "b" }, { m: "boleto" }).result).toBe(true));
  it("diferente", () => expect(evaluateCondition({ se: { campo: "s", operador: "diferente", valor: "X" }, entao: "a", senao: "b" }, { s: "Y" }).result).toBe(true));
  it("menor", () => expect(evaluateCondition({ se: { campo: "v", operador: "menor", valor: 500 }, entao: "a", senao: "b" }, { v: 100 }).result).toBe(true));
  it("works via executeBlock", async () => {
    const r = await executeBlock("CONDITION", { se: { campo: "n", operador: "maior", valor: 0 }, entao: "found", senao: "nope" } as ConditionConfig, ctx({ n: 3 }));
    expect(r.nextStepId).toBe("found");
  });
});

describe("ESCALATE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables AI and creates note", async () => {
    mockTicketUpdate.mockResolvedValue({});
    mockTicketMessageCreate.mockResolvedValue({});
    const r = await executeBlock("ESCALATE", { motivo: "Reembolso ${v}", prioridade: "HIGH", incluirContexto: true } as EscalateConfig, ctx({ v: "R$500" }));
    expect(r.shouldComplete).toBe(true);
    expect(mockTicketUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ aiEnabled: false, priority: "HIGH" }) }));
  });

  it("interpolates motivo", async () => {
    mockTicketUpdate.mockResolvedValue({});
    mockTicketMessageCreate.mockResolvedValue({});
    const r = await executeBlock("ESCALATE", { motivo: "Cliente ${n}", incluirContexto: false } as EscalateConfig, ctx({ n: "João" }));
    expect(r.data?.motivo).toBe("Cliente João");
  });
});

describe("Unknown block", () => {
  it("returns error", async () => {
    expect((await executeBlock("X" as any, {} as any, ctx())).success).toBe(false);
  });
});
