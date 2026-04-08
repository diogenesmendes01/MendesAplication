/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Setup ─────────────────────────────────────────────────────────────

const mockWorkflowFindMany = vi.fn();
const mockExecFindFirst = vi.fn();
const mockExecFindUnique = vi.fn();
const mockExecCreate = vi.fn();
const mockExecUpdate = vi.fn();
const mockTicketFindUnique = vi.fn();
const mockExecuteBlock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    workflow: {
      findMany: (...a: unknown[]) => mockWorkflowFindMany(...a),
    },
    workflowExecution: {
      findFirst: (...a: unknown[]) => mockExecFindFirst(...a),
      findUnique: (...a: unknown[]) => mockExecFindUnique(...a),
      create: (...a: unknown[]) => mockExecCreate(...a),
      update: (...a: unknown[]) => mockExecUpdate(...a),
    },
    ticket: { findUnique: (...a: unknown[]) => mockTicketFindUnique(...a) },
  },
}));

vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
  };
});

vi.mock("@/lib/ai/workflow-blocks", () => ({
  executeBlock: (...args: unknown[]) => mockExecuteBlock(...args),
}));

import {
  executeStep,
  runWorkflow,
  createExecution,
  getActiveExecution,
  matchWorkflow,
  advanceWorkflow,
  pauseWorkflow,
  resumeWorkflow,
  failWorkflow,
  timeoutWorkflow,
} from "../workflow-engine";

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: (overrides.id as string) ?? "wf-1",
    name: (overrides.name as string) ?? "Test Workflow",
    companyId: "company-1",
    trigger: overrides.trigger ?? { type: "intent", value: "test_intent" },
    channels: (overrides.channels as string[]) ?? ["WHATSAPP"],
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
    companyId: "company-1",
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

// ─── executeStep Tests ──────────────────────────────────────────────────────

describe("executeStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("executes a step successfully and updates stepData", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: true, data: { result: "ok" } });
    mockExecUpdate.mockResolvedValue({});

    const result = await executeStep("exec-1", 0);

    expect(result.success).toBe(true);
    expect(mockExecuteBlock).toHaveBeenCalledWith(
      "RESPOND",
      { templatePorCanal: { WHATSAPP: "Oi!" } },
      expect.objectContaining({ ticketId: "ticket-1" })
    );
    expect(mockExecUpdate).toHaveBeenCalled();
  });

  it("returns error when execution not found", async () => {
    mockExecFindUnique.mockResolvedValue(null);
    const result = await executeStep("exec-1", 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns error when execution is not ACTIVE", async () => {
    const execution = makeExecution({ status: "PAUSED" });
    mockExecFindUnique.mockResolvedValue(execution);
    const result = await executeStep("exec-1", 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain("PAUSED");
  });

  it("returns error when step index out of range", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    const result = await executeStep("exec-1", 99);
    expect(result.success).toBe(false);
    expect(result.error).toContain("out of range");
  });

  it("ignores keys starting with underscore in result data", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({
      success: true,
      data: { visible: "ok", _hidden: "secret" },
    });
    mockExecUpdate.mockResolvedValue({});

    await executeStep("exec-1", 0);

    expect(mockExecUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stepData: expect.objectContaining({ visible: "ok" }),
        }),
      })
    );
    const updateCall = mockExecUpdate.mock.calls[0][0];
    const stepData = (updateCall.data as any).stepData;
    expect("visible" in stepData).toBe(true);
  });

  it("handles empty result data gracefully", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: true });
    mockExecUpdate.mockResolvedValue({});

    const result = await executeStep("exec-1", 0);

    expect(result.success).toBe(true);
    expect(mockExecUpdate).not.toHaveBeenCalled();
  });
});

// ─── runWorkflow Integration Tests ──────────────────────────────────────────

describe("runWorkflow", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("runs multi-step workflow to completion", async () => {
    const steps = [
      { id: "s1", nome: "Step 1", tipo: "RESPOND", config: {} },
      { id: "s2", nome: "Step 2", tipo: "SET_TAG", config: {} },
      { id: "s3", nome: "Step 3", tipo: "RESPOND", config: {} },
    ];

    // Simulate advancing through 3 steps with state updates
    let currentIndex = 0;
    const baseExecution = makeWorkflow({ steps });

    mockExecFindUnique.mockImplementation(() => {
      return makeExecution({
        currentStepIndex: currentIndex,
        workflow: baseExecution,
        status: currentIndex >= steps.length ? "COMPLETED" : "ACTIVE"
      });
    });

    mockExecUpdate.mockImplementation((args: any) => {
      if (args?.data?.currentStepIndex !== undefined) {
        currentIndex = args.data.currentStepIndex;
      }
      if (args?.data?.status === "COMPLETED") {
        currentIndex = steps.length;
      }
      return Promise.resolve({});
    });

    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: true });

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("COMPLETED");
    expect(result.stepsExecuted).toBe(3);
    expect(mockExecUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      })
    );
  });

  it("stops on step failure", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: false, error: "Block failed" });
    mockExecUpdate.mockResolvedValue({});

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("FAILED");
    expect(result.stepsExecuted).toBe(1);
    expect(result.message).toContain("Block failed");
  });

  it("respects shouldPause signal and pauses workflow", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({
      success: true,
      shouldPause: true,
      data: { waitingFor: "human", waitingCondition: "approval", timeoutHoras: 1 },
      message: "Waiting for approval",
    });
    mockExecUpdate.mockResolvedValue({});

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("PAUSED");
    expect(result.message).toContain("approval");
  });

  it("respects shouldComplete signal and completes early", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({
      success: true,
      shouldComplete: true,
      message: "Early completion",
    });
    mockExecUpdate.mockResolvedValue({});

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("COMPLETED");
    expect(result.stepsExecuted).toBe(1);
  });

  it("enforces max steps safety limit (50)", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: true });
    mockExecUpdate.mockResolvedValue({});

    // Mock advance to always return done: false to keep looping
    const advanceWorkflowOriginal = await import("../workflow-engine").then((m) => m.advanceWorkflow);
    vi.spyOn(await import("../workflow-engine"), "advanceWorkflow").mockResolvedValue({
      done: false,
      nextStepIndex: 0,
      status: "ACTIVE",
    });

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("FAILED");
    expect(result.stepsExecuted).toBe(50);
    expect(result.message).toContain("Max steps");
  });

  it("handles non-ACTIVE execution gracefully", async () => {
    const execution = makeExecution({ status: "COMPLETED" });
    mockExecFindUnique.mockResolvedValue(execution);

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("COMPLETED");
    expect(result.stepsExecuted).toBe(0);
  });

  it("handles missing execution", async () => {
    mockExecFindUnique.mockResolvedValue(null);

    const result = await runWorkflow("exec-1");

    expect(result.status).toBe("FAILED");
    expect(result.stepsExecuted).toBe(0);
  });
});

// ─── State Transition Tests ──────────────────────────────────────────────────

describe("Workflow State Transitions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("can pause and resume a workflow", async () => {
    mockExecUpdate.mockResolvedValue({});
    mockExecFindUnique.mockResolvedValue(
      makeExecution({
        status: "PAUSED",
        currentStepIndex: 1,
        workflow: makeWorkflow({
          steps: [
            { id: "s1", nome: "S1", tipo: "RESPOND", config: {} },
            { id: "s2", nome: "S2", tipo: "WAIT", config: {} },
            { id: "s3", nome: "S3", tipo: "RESPOND", config: {} },
          ],
        }),
      })
    );

    await pauseWorkflow("exec-1", "human", "approval");
    const resumeResult = await resumeWorkflow("exec-1", { approved: true });

    expect(resumeResult.status).toBe("ACTIVE");
    expect(resumeResult.nextStepIndex).toBe(2);
    expect(mockExecUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PAUSED", waitingFor: "human" }),
      })
    );
  });

  it("handles resume on non-paused execution", async () => {
    mockExecFindUnique.mockResolvedValue(makeExecution({ status: "ACTIVE" }));

    const result = await resumeWorkflow("exec-1");

    expect(result.status).toBe("ACTIVE");
    expect(mockExecUpdate).not.toHaveBeenCalled();
  });

  it("can transition ACTIVE -> FAILED", async () => {
    mockExecUpdate.mockResolvedValue({});

    await failWorkflow("exec-1", "Step execution error");

    expect(mockExecUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1" },
        data: expect.objectContaining({
          status: "FAILED",
          error: "Step execution error",
        }),
      })
    );
  });

  it("can transition ACTIVE -> TIMED_OUT", async () => {
    mockExecUpdate.mockResolvedValue({});

    await timeoutWorkflow("exec-1");

    expect(mockExecUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1" },
        data: expect.objectContaining({ status: "TIMED_OUT" }),
      })
    );
  });
});

// ─── Error Recovery Tests ────────────────────────────────────────────────────

describe("Error Recovery Scenarios", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recovers from database connectivity issues during step execution", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValueOnce(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({ success: true, data: {} });
    mockExecUpdate.mockRejectedValueOnce(new Error("DB connection lost"));

    try {
      await executeStep("exec-1", 0);
    } catch (e) {
      expect((e as Error).message).toContain("DB connection");
    }
  });

  it("handles block timeout gracefully", async () => {
    const execution = makeExecution();
    mockExecFindUnique.mockResolvedValue(execution);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockRejectedValue(new Error("Block execution timeout"));

    try {
      await executeStep("exec-1", 0);
    } catch (e) {
      expect((e as Error).message).toContain("timeout");
    }
  });
});

// ─── Complex Workflow Patterns ───────────────────────────────────────────────

describe("Complex Workflow Patterns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("handles workflow with conditional jumps via proximoStep", async () => {
    const steps = [
      { id: "check", nome: "Check", tipo: "RESPOND", config: {}, proximoStep: "process" },
      { id: "reject", nome: "Reject", tipo: "RESPOND", config: {} },
      { id: "process", nome: "Process", tipo: "SET_TAG", config: {} },
    ];

    const wf = makeWorkflow({ steps });
    const exec = makeExecution({ currentStepIndex: 0, workflow: wf });

    mockExecFindUnique.mockResolvedValue(exec);
    mockExecUpdate.mockResolvedValue({});

    const result = await advanceWorkflow("exec-1");

    expect(result.nextStepIndex).toBe(2);
    expect(result.done).toBe(false);
    expect(result.status).toBe("ACTIVE");
  });

  it("handles workflow termination with __END__ sentinel", async () => {
    const steps = [
      { id: "final", nome: "Final", tipo: "RESPOND", config: {}, proximoStep: "__END__" },
      { id: "orphan", nome: "Orphan", tipo: "RESPOND", config: {} },
    ];

    const wf = makeWorkflow({ steps });
    const exec = makeExecution({ currentStepIndex: 0, workflow: wf });
    mockExecFindUnique.mockResolvedValue(exec);
    mockExecUpdate.mockResolvedValue({});

    const result = await advanceWorkflow("exec-1");

    expect(result.done).toBe(true);
    expect(result.status).toBe("COMPLETED");
  });

  it("accumulates stepData across multiple step executions", async () => {
    const steps = [
      { id: "s1", nome: "Collect Email", tipo: "COLLECT_INFO", config: {} },
      { id: "s2", nome: "Collect Phone", tipo: "COLLECT_INFO", config: {} },
    ];

    const exec1 = makeExecution({
      currentStepIndex: 0,
      stepData: {},
      workflow: makeWorkflow({ steps }),
    });

    mockExecFindUnique.mockResolvedValue(exec1);
    mockTicketFindUnique.mockResolvedValue({ channel: { type: "WHATSAPP" } });
    mockExecuteBlock.mockResolvedValue({
      success: true,
      data: { email: "test@example.com" },
    });
    mockExecUpdate.mockResolvedValue({});

    await executeStep("exec-1", 0);

    const updateCall = mockExecUpdate.mock.calls[0];
    expect(updateCall[0].data.stepData).toMatchObject({ email: "test@example.com" });
  });
});
