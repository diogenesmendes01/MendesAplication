import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWorkflowFindMany = vi.fn();
const mockExecFindFirst = vi.fn();
const mockExecFindUnique = vi.fn();
const mockExecCreate = vi.fn();
const mockExecUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflow: {
      findMany: (...a: unknown[]) => mockWorkflowFindMany(...a),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workflowExecution: {
      findFirst: (...a: unknown[]) => mockExecFindFirst(...a),
      findUnique: (...a: unknown[]) => mockExecFindUnique(...a),
      create: (...a: unknown[]) => mockExecCreate(...a),
      update: (...a: unknown[]) => mockExecUpdate(...a),
    },
    ticket: { findUnique: vi.fn(), update: vi.fn() },
    ticketMessage: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  matchWorkflow,
  createExecution,
  getActiveExecution,
  advanceWorkflow,
  pauseWorkflow,
  resumeWorkflow,
  failWorkflow,
  timeoutWorkflow,
  buildWorkflowContext,
} from "../workflow-engine";
import type { WorkflowTrigger, WorkflowStep } from "../workflow-types";

const COMPANY_ID = "company-1";

function makeWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: (overrides.id as string) ?? "wf-1",
    name: (overrides.name as string) ?? "Test Workflow",
    companyId: COMPANY_ID,
    trigger: overrides.trigger ?? { type: "intent", value: "test_intent" },
    channels: (overrides.channels as string[]) ?? ["WHATSAPP", "EMAIL", "RECLAMEAQUI"],
    priority: (overrides.priority as number) ?? 0,
    enabled: true,
    steps: overrides.steps ?? [
      { id: "step1", nome: "Step 1", tipo: "RESPOND", config: { templatePorCanal: { WHATSAPP: "Oi!" } } },
      { id: "step2", nome: "Step 2", tipo: "SET_TAG", config: { alvo: "ticket", acao: "adicionar_tag", valor: "done" } },
    ],
    version: 1,
    timeoutMin: 2880,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeExecution(overrides: Partial<Record<string, unknown>> = {}) {
  const wf = overrides.workflow ?? makeWorkflow();
  return {
    id: (overrides.id as string) ?? "exec-1",
    workflowId: "wf-1",
    ticketId: "ticket-1",
    companyId: COMPANY_ID,
    currentStepIndex: (overrides.currentStepIndex as number) ?? 0,
    status: (overrides.status as string) ?? "ACTIVE",
    stepData: (overrides.stepData as Record<string, unknown>) ?? {},
    waitingFor: null,
    waitingCondition: null,
    startedAt: new Date(),
    completedAt: null,
    pausedAt: null,
    timeoutAt: null,
    error: null,
    updatedAt: new Date(),
    workflow: wf,
  };
}

describe("matchWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no workflows", async () => {
    mockWorkflowFindMany.mockResolvedValue([]);
    expect(await matchWorkflow(COMPANY_ID, "WHATSAPP", "hello", [])).toBeNull();
  });

  it("matches by keyword (case insensitive)", async () => {
    mockWorkflowFindMany.mockResolvedValue([makeWorkflow({ trigger: { type: "keyword", value: "segunda via" } })]);
    const r = await matchWorkflow(COMPANY_ID, "WHATSAPP", "Preciso da SEGUNDA VIA", []);
    expect(r).not.toBeNull();
    expect(r!.id).toBe("wf-1");
  });

  it("matches by intent", async () => {
    mockWorkflowFindMany.mockResolvedValue([makeWorkflow({ trigger: { type: "intent", value: "reembolso" } })]);
    const r = await matchWorkflow(COMPANY_ID, "WHATSAPP", "msg", [], "reembolso");
    expect(r).not.toBeNull();
  });

  it("matches by tag", async () => {
    mockWorkflowFindMany.mockResolvedValue([makeWorkflow({ trigger: { type: "tag", value: "urgente" } })]);
    const r = await matchWorkflow(COMPANY_ID, "EMAIL", "msg", ["urgente"]);
    expect(r).not.toBeNull();
  });

  it("does not match manual trigger", async () => {
    mockWorkflowFindMany.mockResolvedValue([makeWorkflow({ trigger: { type: "manual", value: "x" } })]);
    expect(await matchWorkflow(COMPANY_ID, "WHATSAPP", "x", [], "x")).toBeNull();
  });

  it("keyword has priority over intent", async () => {
    mockWorkflowFindMany.mockResolvedValue([
      makeWorkflow({ id: "wf-intent", trigger: { type: "intent", value: "cancel" }, priority: 10 }),
      makeWorkflow({ id: "wf-kw", trigger: { type: "keyword", value: "cancelar" } }),
    ]);
    const r = await matchWorkflow(COMPANY_ID, "WHATSAPP", "quero cancelar", [], "cancel");
    expect(r!.id).toBe("wf-kw");
  });
});

describe("createExecution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates execution", async () => {
    mockExecCreate.mockResolvedValue(makeExecution());
    const r = await createExecution("wf-1", "ticket-1", COMPANY_ID);
    expect(r).toBeDefined();
    expect(mockExecCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workflowId: "wf-1", status: "ACTIVE" }),
    }));
  });

  it("passes initial data", async () => {
    mockExecCreate.mockResolvedValue(makeExecution());
    await createExecution("wf-1", "t-1", COMPANY_ID, { cnpj: "123" });
    expect(mockExecCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ stepData: { cnpj: "123" } }),
    }));
  });
});

describe("getActiveExecution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns active execution", async () => {
    mockExecFindFirst.mockResolvedValue(makeExecution());
    expect((await getActiveExecution("ticket-1"))!.id).toBe("exec-1");
  });

  it("returns null when none", async () => {
    mockExecFindFirst.mockResolvedValue(null);
    expect(await getActiveExecution("ticket-1")).toBeNull();
  });
});

describe("advanceWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances to next step", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution({ currentStepIndex: 0 }));
    mockExecUpdate.mockResolvedValue({});
    const r = await advanceWorkflow("exec-1");
    expect(r.done).toBe(false);
    expect(r.nextStepIndex).toBe(1);
  });

  it("completes at last step", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution({ currentStepIndex: 1 }));
    mockExecUpdate.mockResolvedValue({});
    const r = await advanceWorkflow("exec-1");
    expect(r.done).toBe(true);
    expect(r.status).toBe("COMPLETED");
  });

  it("jumps to step by ID", async () => {
    const steps = [
      { id: "a", nome: "A", tipo: "RESPOND", config: {} },
      { id: "b", nome: "B", tipo: "RESPOND", config: {} },
      { id: "c", nome: "C", tipo: "RESPOND", config: {} },
    ];
    mockExecFindUnique.mockResolvedValue(makeExecution({ currentStepIndex: 0, workflow: makeWorkflow({ steps }) }));
    mockExecUpdate.mockResolvedValue({});
    const r = await advanceWorkflow("exec-1", "c");
    expect(r.nextStepIndex).toBe(2);
  });

  it("fails on missing jump target", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution());
    mockExecUpdate.mockResolvedValue({});
    const r = await advanceWorkflow("exec-1", "nonexistent");
    expect(r.done).toBe(true);
    expect(r.status).toBe("FAILED");
  });
});

describe("pauseWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets PAUSED status", async () => {
    mockExecUpdate.mockResolvedValue({});
    await pauseWorkflow("exec-1", "humano", "Aprovação");
    expect(mockExecUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PAUSED", waitingFor: "humano" }),
    }));
  });
});

describe("resumeWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes paused execution with more steps", async () => {
    const steps = [
      { id: "a", nome: "A", tipo: "RESPOND", config: {} },
      { id: "b", nome: "B (wait)", tipo: "WAIT", config: {} },
      { id: "c", nome: "C", tipo: "RESPOND", config: {} },
    ];
    mockExecFindUnique.mockResolvedValue(makeExecution({ status: "PAUSED", currentStepIndex: 1, workflow: makeWorkflow({ steps }) }));
    mockExecUpdate.mockResolvedValue({});
    const r = await resumeWorkflow("exec-1", { approved: true });
    expect(r.status).toBe("ACTIVE");
    expect(r.nextStepIndex).toBe(2);
  });

  it("completes if no more steps", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution({ status: "PAUSED", currentStepIndex: 1 }));
    mockExecUpdate.mockResolvedValue({});
    const r = await resumeWorkflow("exec-1");
    expect(r.status).toBe("COMPLETED");
  });

  it("ignores non-paused", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution({ status: "COMPLETED" }));
    const r = await resumeWorkflow("exec-1");
    expect(r.status).toBe("COMPLETED");
    expect(mockExecUpdate).not.toHaveBeenCalled();
  });
});

describe("failWorkflow / timeoutWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets FAILED", async () => {
    mockExecUpdate.mockResolvedValue({});
    await failWorkflow("exec-1", "broke");
    expect(mockExecUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", error: "broke" }),
    }));
  });

  it("sets TIMED_OUT", async () => {
    mockExecUpdate.mockResolvedValue({});
    await timeoutWorkflow("exec-1");
    expect(mockExecUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "TIMED_OUT" }),
    }));
  });
});

describe("buildWorkflowContext", () => {
  it("builds context with step info", () => {
    const steps: WorkflowStep[] = [
      { id: "s1", nome: "Coletar CNPJ", tipo: "COLLECT_INFO", config: {} as any, descricao: "Pega o CNPJ" },
      { id: "s2", nome: "Buscar", tipo: "SEARCH", config: {} as any },
      { id: "s3", nome: "Responder", tipo: "RESPOND", config: {} as any },
    ];
    const ctx = buildWorkflowContext({ currentStepIndex: 0, stepData: {}, workflow: { name: "Test", steps } });
    expect(ctx).toContain("WORKFLOW EM EXECUÇÃO: Test");
    expect(ctx).toContain("Step atual (1/3): Coletar CNPJ");
    expect(ctx).toContain("Buscar → Responder");
  });

  it("shows last step indicator", () => {
    const steps: WorkflowStep[] = [{ id: "s1", nome: "Final", tipo: "RESPOND", config: {} as any }];
    const ctx = buildWorkflowContext({ currentStepIndex: 0, stepData: {}, workflow: { name: "Short", steps } });
    expect(ctx).toContain("Último step do workflow.");
  });
});
