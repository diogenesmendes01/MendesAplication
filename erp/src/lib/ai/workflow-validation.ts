/**
 * Zod schemas for workflow step data validation.
 * Ensures type safety at runtime for untrusted inputs from Prisma JSON columns.
 */

import { z } from "zod";
import { logger } from "@/lib/logger";

// ─── Prisma Model Access Validation ──────────────────────────────────────────

/** Allowed Prisma model names for dynamic access in workflows */
const ALLOWED_PRISMA_MODELS = ["accountReceivable", "client", "ticket", "refund"] as const;

export const PrismaModelNameSchema = z.enum(ALLOWED_PRISMA_MODELS).describe("Allowed Prisma model for dynamic access");

export type AllowedPrismaModel = z.infer<typeof PrismaModelNameSchema>;

/**
 * Validate and cast modelName to allowed Prisma model.
 * Throws ZodError if model is not in whitelist.
 */
export function validatePrismaModelName(modelName: unknown): AllowedPrismaModel {
  return PrismaModelNameSchema.parse(modelName);
}

// ─── Workflow Step Data Validation ──────────────────────────────────────────

export const StepDataSchema = z.record(z.string(), z.unknown()).describe("Step execution context data");

export type StepData = z.infer<typeof StepDataSchema>;

/**
 * Safely parse untrusted step data.
 * Returns null if invalid, preventing silent failures.
 */
export function parseStepData(data: unknown): StepData | null {
  const result = StepDataSchema.safeParse(data);
  if (!result.success) {
    logger.error({ err: result.error }, "Invalid step data");
    return null;
  }
  return result.data;
}

// ─── Search Config Validation ───────────────────────────────────────────────

export const SearchConfigSchema = z.object({
  entidade: z.string().describe("Entity name (boleto, cliente, titulo, ticket, refund)"),
  filtro: z.record(z.string(), z.string()).describe("Filter conditions"),
  limiteResultados: z.number().int().positive().optional().default(10),
  ordenacao: z.string().optional().describe("Format: 'field:asc|desc'"),
});

export type SearchConfig = z.infer<typeof SearchConfigSchema>;

// ─── Update Config Validation ───────────────────────────────────────────────

export const UpdateConfigSchema = z.object({
  entidade: z.string(),
  filtro: z.record(z.string(), z.string()),
  campos: z.record(z.string(), z.unknown()),
  requireConfirmation: z.boolean().optional().default(false),
  auditLog: z.boolean().optional().default(true),
});

export type UpdateConfig = z.infer<typeof UpdateConfigSchema>;

// ─── Helpers for workflow-blocks.ts ─────────────────────────────────────────

/**
 * Get Prisma model from entity name with validation.
 * Prevents unsafe dynamic access to unvalidated model names.
 *
 * @param entityName - Entity name from config
 * @param modelMap - Map of entity → model names
 * @returns Validated model name
 * @throws Error if entity not in allowed map
 */
export function getValidatedModelName(
  entityName: string,
  modelMap: Record<string, string>,
): AllowedPrismaModel {
  const modelName = modelMap[entityName];
  if (!modelName) {
    throw new Error(`Entidade desconhecida: ${entityName}`);
  }
  return validatePrismaModelName(modelName);
}
