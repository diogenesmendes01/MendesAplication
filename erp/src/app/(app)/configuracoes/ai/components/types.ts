import type { AiConfigData, UsageSummary, ModelSuggestionData, SimulationResult } from "../actions";

export type { AiConfigData, UsageSummary, ModelSuggestionData, SimulationResult };

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
};
