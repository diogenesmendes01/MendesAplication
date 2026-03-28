import { prisma } from "@/lib/prisma";
import type {
  WorkflowTrigger,
  WorkflowStep,
  ExecutionStatus,
  ChannelName,
  StepResult,
} from "./workflow-types";
import { executeBlock } from "./workflow-blocks";
import type { BlockContext } from "./workflow-blocks";
import { logger } from "@/lib/logger";

// ─── Match workflow by trigger ───────────────────────────────────────────────

export async function matchWorkflow(
  companyId: string,
  channel: ChannelName,
  message: string,
  ticketTags: string[],
  detectedIntent?: string,
): Promise<{ id: string; name: string; trigger: WorkflowTrigger; steps: WorkflowStep[] } | null> {
  const workflows = await prisma.workflow.findMany({
    where: { companyId, enabled: true, channels: { has: channel } },
    orderBy: { priority: "desc" },
  });

  if (workflows.length === 0) return null;

  const lowerMessage = message.toLowerCase();

  // 1. Keyword match (fast-path)
  for (const wf of workflows) {
    const trigger = wf.trigger as unknown as WorkflowTrigger;
    if (trigger.type === "keyword" && lowerMessage.includes(trigger.value.toLowerCase())) {
      return { id: wf.id, name: wf.name, trigger, steps: wf.steps as unknown as WorkflowStep[] };
    }
  }

  // 2. Intent match
  if (detectedIntent) {
    for (const wf of workflows) {
      const trigger = wf.trigger as unknown as WorkflowTrigger;
      if (trigger.type === "intent" && trigger.value === detectedIntent) {
        return { id: wf.id, name: wf.name, trigger, steps: wf.steps as unknown as WorkflowStep[] };
      }
    }
  }

  // 3. Tag match
  if (ticketTags.length > 0) {
    for (const wf of workflows) {
      const trigger = wf.trigger as unknown as WorkflowTrigger;
      if (trigger.type === "tag" && ticketTags.includes(trigger.value)) {
        return { id: wf.id, name: wf.name, trigger, steps: wf.steps as unknown as WorkflowStep[] };
      }
    }
  }

  return null;
}

// ─── Create execution ────────────────────────────────────────────────────────

export async function createExecution(
  workflowId: string,
  ticketId: string,
  companyId: string,
  initialData?: Record<string, unknown>,
  timeoutMin?: number,
) {
  const timeoutAt = timeoutMin
    ? new Date(Date.now() + timeoutMin * 60 * 1000)
    : new Date(Date.now() + 48 * 60 * 60 * 1000);

  return prisma.workflowExecution.create({
    data: {
      workflowId,
      ticketId,
      companyId,
      currentStepIndex: 0,
      status: "ACTIVE",
      stepData: initialData ?? {},
      timeoutAt,
    },
    include: { workflow: true },
  });
}

// ─── Get active execution for ticket ─────────────────────────────────────────

export async function getActiveExecution(ticketId: string) {
  return prisma.workflowExecution.findFirst({
    where: { ticketId, status: { in: ["ACTIVE", "PAUSED"] } },
    include: { workflow: true },
    orderBy: { startedAt: "desc" },
  });
}

// ─── Execute step ────────────────────────────────────────────────────────────

export async function executeStep(
  executionId: string,
  stepIndex: number,
): Promise<StepResult> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: { workflow: true },
  });

  if (!execution) return { success: false, error: "Execution not found" };
  if (execution.status !== "ACTIVE") return { success: false, error: `Execution is ${execution.status}` };

  const steps = execution.workflow.steps as unknown as WorkflowStep[];
  if (stepIndex < 0 || stepIndex >= steps.length) return { success: false, error: `Step index ${stepIndex} out of range` };

  const step = steps[stepIndex];
  const stepData = execution.stepData as Record<string, unknown>;

  const ctx: BlockContext = {
    companyId: execution.companyId,
    ticketId: execution.ticketId,
    channel: "WHATSAPP",
    stepData,
  };

  logger.info({ executionId, stepIndex, stepType: step.tipo, stepId: step.id }, "Executing workflow step");

  const result = await executeBlock(step.tipo, step.config, ctx);

  if (result.data) {
    const updatedStepData = { ...stepData, [step.id]: result.data };
    for (const [key, value] of Object.entries(result.data)) {
      if (!key.startsWith("_")) updatedStepData[key] = value;
    }
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { stepData: updatedStepData },
    });
  }

  return result;
}

// ─── Advance workflow ────────────────────────────────────────────────────────

export async function advanceWorkflow(
  executionId: string,
  overrideNextStepId?: string,
): Promise<{ done: boolean; nextStepIndex: number; status: ExecutionStatus }> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: { workflow: true },
  });

  if (!execution || execution.status !== "ACTIVE") {
    return { done: true, nextStepIndex: -1, status: (execution?.status ?? "FAILED") as ExecutionStatus };
  }

  const steps = execution.workflow.steps as unknown as WorkflowStep[];

  let nextIndex: number;

  if (overrideNextStepId) {
    nextIndex = steps.findIndex((s) => s.id === overrideNextStepId);
    if (nextIndex === -1) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: "FAILED", error: `Step "${overrideNextStepId}" not found`, completedAt: new Date() },
      });
      return { done: true, nextStepIndex: -1, status: "FAILED" };
    }
  } else {
    const currentStep = steps[execution.currentStepIndex];
    if (currentStep?.proximoStep) {
      nextIndex = steps.findIndex((s) => s.id === currentStep.proximoStep);
      if (nextIndex === -1) nextIndex = execution.currentStepIndex + 1;
    } else {
      nextIndex = execution.currentStepIndex + 1;
    }
  }

  if (nextIndex >= steps.length) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: "COMPLETED", completedAt: new Date(), currentStepIndex: nextIndex },
    });
    return { done: true, nextStepIndex: nextIndex, status: "COMPLETED" };
  }

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { currentStepIndex: nextIndex },
  });

  return { done: false, nextStepIndex: nextIndex, status: "ACTIVE" };
}

// ─── Pause / Resume / Fail / Timeout ─────────────────────────────────────────

export async function pauseWorkflow(
  executionId: string,
  waitingFor: string,
  waitingCondition: string,
  timeoutHoras?: number,
): Promise<void> {
  const timeoutAt = timeoutHoras ? new Date(Date.now() + timeoutHoras * 60 * 60 * 1000) : undefined;
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: "PAUSED", waitingFor, waitingCondition, pausedAt: new Date(), ...(timeoutAt && { timeoutAt }) },
  });
  logger.info({ executionId, waitingFor, waitingCondition }, "Workflow paused");
}

export async function resumeWorkflow(
  executionId: string,
  eventData?: Record<string, unknown>,
): Promise<{ nextStepIndex: number; status: ExecutionStatus }> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    include: { workflow: true },
  });

  if (!execution || execution.status !== "PAUSED") {
    return { nextStepIndex: -1, status: (execution?.status ?? "FAILED") as ExecutionStatus };
  }

  const stepData = execution.stepData as Record<string, unknown>;
  const updatedStepData = eventData ? { ...stepData, ...eventData } : stepData;
  const steps = execution.workflow.steps as unknown as WorkflowStep[];
  const nextIndex = execution.currentStepIndex + 1;

  if (nextIndex >= steps.length) {
    await prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: "COMPLETED", completedAt: new Date(), currentStepIndex: nextIndex, stepData: updatedStepData, waitingFor: null, waitingCondition: null, pausedAt: null },
    });
    return { nextStepIndex: nextIndex, status: "COMPLETED" };
  }

  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: "ACTIVE", currentStepIndex: nextIndex, stepData: updatedStepData, waitingFor: null, waitingCondition: null, pausedAt: null },
  });
  logger.info({ executionId, nextStepIndex: nextIndex }, "Workflow resumed");
  return { nextStepIndex: nextIndex, status: "ACTIVE" };
}

export async function failWorkflow(executionId: string, error: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: "FAILED", error, completedAt: new Date() },
  });
}

export async function timeoutWorkflow(executionId: string): Promise<void> {
  await prisma.workflowExecution.update({
    where: { id: executionId },
    data: { status: "TIMED_OUT", completedAt: new Date() },
  });
}

// ─── Run workflow (orchestrate all steps) ────────────────────────────────────

export async function runWorkflow(
  executionId: string,
): Promise<{ status: ExecutionStatus; stepsExecuted: number; message?: string }> {
  let stepsExecuted = 0;
  const maxSteps = 50;

  while (stepsExecuted < maxSteps) {
    const execution = await prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });

    if (!execution || execution.status !== "ACTIVE") {
      return { status: (execution?.status ?? "FAILED") as ExecutionStatus, stepsExecuted };
    }

    const steps = execution.workflow.steps as unknown as WorkflowStep[];
    if (execution.currentStepIndex >= steps.length) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return { status: "COMPLETED", stepsExecuted };
    }

    const result = await executeStep(executionId, execution.currentStepIndex);
    stepsExecuted++;

    if (!result.success) {
      await failWorkflow(executionId, result.error ?? "Step failed");
      return { status: "FAILED", stepsExecuted, message: result.error };
    }

    if (result.shouldPause) {
      const d = result.data as { waitingFor: string; waitingCondition: string; timeoutHoras?: number };
      await pauseWorkflow(executionId, d.waitingFor, d.waitingCondition, d.timeoutHoras);
      return { status: "PAUSED", stepsExecuted, message: result.message };
    }

    if (result.shouldComplete) {
      await prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      return { status: "COMPLETED", stepsExecuted, message: result.message };
    }

    const advance = await advanceWorkflow(executionId, result.nextStepId);
    if (advance.done) return { status: advance.status, stepsExecuted };
  }

  await failWorkflow(executionId, "Max steps safety limit reached");
  return { status: "FAILED", stepsExecuted, message: "Max steps limit" };
}

// ─── Build workflow context for agent system prompt ──────────────────────────

export function buildWorkflowContext(
  execution: { currentStepIndex: number; stepData: unknown; workflow: { name: string; steps: unknown } },
): string {
  const steps = execution.workflow.steps as unknown as WorkflowStep[];
  const currentStep = steps[execution.currentStepIndex];
  const stepData = execution.stepData as Record<string, unknown>;

  if (!currentStep) return "";

  const nextSteps = steps.slice(execution.currentStepIndex + 1, execution.currentStepIndex + 4).map((s) => s.nome).join(" → ");

  return `
## WORKFLOW EM EXECUÇÃO: ${execution.workflow.name}
Step atual (${execution.currentStepIndex + 1}/${steps.length}): ${currentStep.nome}
Tipo: ${currentStep.tipo}
${currentStep.descricao ? `Instrução: ${currentStep.descricao}` : ""}
Dados coletados: ${JSON.stringify(stepData, null, 2)}
${nextSteps ? `Próximos steps: ${nextSteps}` : "Último step do workflow."}

Execute este step e use ADVANCE_WORKFLOW para prosseguir.
`.trim();
}
