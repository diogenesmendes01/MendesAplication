import type { AiConfigData, UsageSummary, ModelSuggestionData, SimulationResult } from "../actions";

export type { AiConfigData, UsageSummary, ModelSuggestionData, SimulationResult };

/**
 * Frontend provider selector options.
 * Must stay in sync with VALID_PROVIDERS in actions.ts (backend).
 * See issue #80 for context on the consistency requirement.
 */
export const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "grok", label: "Grok (xAI)" },
  { value: "qwen", label: "Qwen (Alibaba)" },
  { value: "deepseek", label: "DeepSeek" },
] as const;

export const DEFAULT_CONFIG: AiConfigData = {
  enabled: false,
  persona: "",
  welcomeMessage: "",
  escalationKeywords: [],
  maxIterations: 5,
  provider: "openai",
  apiKey: "",
  model: "",
  whatsappEnabled: true,
  emailEnabled: false,
  emailPersona: "",
  emailSignature: "",
  dailySpendLimitBrl: null,
  temperature: 0.7,
  raEnabled: false,
  raMode: "suggest",
  raPrivateBeforePublic: true,
  raAutoRequestEvaluation: false,
  raEscalationKeywords: ["processo", "advogado", "procon", "judicial", "indenização"],
  operationMode: "auto",
  hybridThreshold: 0.8,
  alwaysRequireApproval: [] as string[],
};
