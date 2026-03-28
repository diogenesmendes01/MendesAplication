-- CreateTable: workflows
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['WHATSAPP', 'EMAIL', 'RECLAMEAQUI']::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "timeoutMin" INTEGER NOT NULL DEFAULT 2880,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable: workflow_executions
CREATE TABLE "workflow_executions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stepData" JSONB NOT NULL DEFAULT '{}',
    "waitingFor" TEXT,
    "waitingCondition" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "timeoutAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- Indexes: workflows
CREATE UNIQUE INDEX "workflows_companyId_name_key" ON "workflows"("companyId", "name");
CREATE INDEX "workflows_companyId_enabled_idx" ON "workflows"("companyId", "enabled");

-- Indexes: workflow_executions
CREATE INDEX "workflow_executions_ticketId_idx" ON "workflow_executions"("ticketId");
CREATE INDEX "workflow_executions_workflowId_idx" ON "workflow_executions"("workflowId");
CREATE INDEX "workflow_executions_companyId_status_idx" ON "workflow_executions"("companyId", "status");
CREATE INDEX "workflow_executions_status_timeoutAt_idx" ON "workflow_executions"("status", "timeoutAt");

-- Foreign Keys: workflows
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign Keys: workflow_executions
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
