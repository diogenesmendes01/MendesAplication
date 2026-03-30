"use server";

import { prisma } from "@/lib/prisma";
import { requireCompanyAccess } from "@/lib/rbac";
import { logAuditEvent } from "@/lib/audit";
import type { WorkflowTrigger, WorkflowStep } from "@/lib/ai/workflow-types";
import { withLogging } from "@/lib/with-logging";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WorkflowData {
  id: string;
  name: string;
  description: string | null;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  channels: string[];
  enabled: boolean;
  priority: number;
  version: number;
  timeoutMin: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { executions: number };
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  channels?: string[];
  priority?: number;
  timeoutMin?: number;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  trigger?: WorkflowTrigger;
  steps?: WorkflowStep[];
  channels?: string[];
  enabled?: boolean;
  priority?: number;
  timeoutMin?: number;
}

// ─── List workflows ──────────────────────────────────────────────────────────

async function _listWorkflows(companyId: string): Promise<WorkflowData[]> {
  await requireCompanyAccess(companyId);

  const workflows = await prisma.workflow.findMany({
    where: { companyId },
    orderBy: [{ priority: "desc" }, { name: "asc" }],
    include: { _count: { select: { executions: true } } },
  });

  return workflows.map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    trigger: w.trigger as unknown as WorkflowTrigger,
    steps: w.steps as unknown as WorkflowStep[],
    channels: w.channels,
    enabled: w.enabled,
    priority: w.priority,
    version: w.version,
    timeoutMin: w.timeoutMin,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    _count: w._count,
  }));
}

// ─── Create workflow ─────────────────────────────────────────────────────────

async function _createWorkflow(companyId: string, input: CreateWorkflowInput): Promise<WorkflowData> {
  const { userId } = await requireCompanyAccess(companyId);

  const workflow = await prisma.workflow.create({
    data: {
      companyId,
      name: input.name,
      description: input.description,
      trigger: input.trigger as unknown as import("@prisma/client").Prisma.InputJsonValue,
      steps: input.steps as unknown as import("@prisma/client").Prisma.InputJsonValue,
      channels: input.channels ?? ["WHATSAPP", "EMAIL", "RECLAMEAQUI"],
      priority: input.priority ?? 0,
      timeoutMin: input.timeoutMin ?? 2880,
      createdById: userId,
    },
  });

  await logAuditEvent({
    userId,
    action: "CREATE",
    entity: "Workflow",
    entityId: workflow.id,
    dataAfter: { name: workflow.name, trigger: workflow.trigger },
    companyId,
  });

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger as unknown as WorkflowTrigger,
    steps: workflow.steps as unknown as WorkflowStep[],
    channels: workflow.channels,
    enabled: workflow.enabled,
    priority: workflow.priority,
    version: workflow.version,
    timeoutMin: workflow.timeoutMin,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

// ─── Update workflow ─────────────────────────────────────────────────────────

async function _updateWorkflow(companyId: string, workflowId: string, input: UpdateWorkflowInput): Promise<WorkflowData> {
  const { userId } = await requireCompanyAccess(companyId);

  const existing = await prisma.workflow.findFirst({ where: { id: workflowId, companyId } });
  if (!existing) throw new Error("Workflow not found");

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.trigger !== undefined) data.trigger = input.trigger as unknown as import("@prisma/client").Prisma.InputJsonValue;
  if (input.steps !== undefined) { data.steps = input.steps as unknown as import("@prisma/client").Prisma.InputJsonValue; data.version = existing.version + 1; }
  if (input.channels !== undefined) data.channels = input.channels;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.timeoutMin !== undefined) data.timeoutMin = input.timeoutMin;

  const workflow = await prisma.workflow.update({ where: { id: workflowId }, data });

  await logAuditEvent({
    userId,
    action: "UPDATE",
    entity: "Workflow",
    entityId: workflow.id,
    dataBefore: { name: existing.name, enabled: existing.enabled, version: existing.version },
    dataAfter: { name: workflow.name, enabled: workflow.enabled, version: workflow.version },
    companyId,
  });

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger as unknown as WorkflowTrigger,
    steps: workflow.steps as unknown as WorkflowStep[],
    channels: workflow.channels,
    enabled: workflow.enabled,
    priority: workflow.priority,
    version: workflow.version,
    timeoutMin: workflow.timeoutMin,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

// ─── Get execution status ────────────────────────────────────────────────────

export interface ExecutionStatusData {
  id: string;
  workflowName: string;
  ticketId: string;
  status: string;
  currentStepIndex: number;
  totalSteps: number;
  stepData: Record<string, unknown>;
  waitingFor: string | null;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

async function _getExecutionStatus(companyId: string, executionId: string): Promise<ExecutionStatusData | null> {
  await requireCompanyAccess(companyId);

  const execution = await prisma.workflowExecution.findFirst({
    where: { id: executionId, companyId },
    include: { workflow: { select: { name: true, steps: true } } },
  });

  if (!execution) return null;
  const steps = execution.workflow.steps as unknown as WorkflowStep[];

  return {
    id: execution.id,
    workflowName: execution.workflow.name,
    ticketId: execution.ticketId,
    status: execution.status,
    currentStepIndex: execution.currentStepIndex,
    totalSteps: steps.length,
    stepData: execution.stepData as Record<string, unknown>,
    waitingFor: execution.waitingFor,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
    error: execution.error,
  };
}

// ─── List executions ─────────────────────────────────────────────────────────

async function _listExecutions(companyId: string, workflowId?: string, status?: string, limit = 50): Promise<ExecutionStatusData[]> {
  await requireCompanyAccess(companyId);

  const where: Record<string, unknown> = { companyId };
  if (workflowId) where.workflowId = workflowId;
  if (status) where.status = status;

  const executions = await prisma.workflowExecution.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { workflow: { select: { name: true, steps: true } } },
  });

  return executions.map((e) => {
    const steps = e.workflow.steps as unknown as WorkflowStep[];
    return {
      id: e.id,
      workflowName: e.workflow.name,
      ticketId: e.ticketId,
      status: e.status,
      currentStepIndex: e.currentStepIndex,
      totalSteps: steps.length,
      stepData: e.stepData as Record<string, unknown>,
      waitingFor: e.waitingFor,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      error: e.error,
    };
  });
}

// ---------------------------------------------------------------------------
// Wrapped exports with logging
// ---------------------------------------------------------------------------
export const listWorkflows = withLogging('workflows.listWorkflows', _listWorkflows);
export const createWorkflow = withLogging('workflows.createWorkflow', _createWorkflow);
export const updateWorkflow = withLogging('workflows.updateWorkflow', _updateWorkflow);
export const getExecutionStatus = withLogging('workflows.getExecutionStatus', _getExecutionStatus);
export const listExecutions = withLogging('workflows.listExecutions', _listExecutions);
