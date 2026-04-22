// ─── Workflow Engine Types ────────────────────────────────────────────────────

export type TriggerType = "intent" | "tag" | "keyword" | "manual";

export interface WorkflowTrigger {
  type: TriggerType;
  value: string;
}

export type StepType =
  | "COLLECT_INFO"
  | "SEARCH"
  | "UPDATE"
  | "RESPOND"
  | "WAIT"
  | "SEND_ATTACHMENT"
  | "SET_TAG"
  | "CONDITION"
  | "ESCALATE";

export type ChannelName = "WHATSAPP" | "EMAIL" | "RECLAMEAQUI";

export type ExecutionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED" | "TIMED_OUT";

// ─── Step config interfaces ──────────────────────────────────────────────────

export interface CollectInfoConfig {
  campo: string;
  obrigatorio: boolean;
  validacao?: "cnpj" | "cpf" | "email" | "telefone" | "data" | "numero" | "texto" | null;
  promptPorCanal?: Record<string, string>;
  maxTentativas?: number;
}

export interface SearchConfig {
  entidade: string;
  filtro: Record<string, string>;
  retornarCampos?: string[];
  limiteResultados?: number;
  ordenacao?: string;
}

export interface UpdateConfig {
  entidade: string;
  filtro: Record<string, string>;
  campos: Record<string, unknown>;
  requireConfirmation?: boolean;
  auditLog?: boolean;
}

export interface RespondConfig {
  templatePorCanal?: Record<string, string | { publico: string; privado: string }>;
  variaveis?: string[];
}

export interface WaitConfig {
  quem: "humano" | "cliente";
  condicao: string;
  timeoutHoras?: number;
  acaoTimeout?: "escalar" | "cancelar" | "notificar";
  notificarResponsavel?: boolean;
}

export interface SendAttachmentConfig {
  source: "busca" | "estatico" | "gerado";
  attachmentId?: string;
  referenciaStep?: string;
  porCanal?: Record<string, boolean>;
  fallbackTexto?: string;
}

export interface SetTagConfig {
  alvo: "ticket" | "cliente";
  acao: "adicionar_tag" | "remover_tag" | "alterar_status";
  valor: string;
}

export interface ConditionConfig {
  se: {
    campo: string;
    operador: "igual" | "diferente" | "maior" | "menor" | "contem" | "existe" | "nao_existe";
    valor: unknown;
  };
  entao: string;
  senao: string;
}

export interface EscalateConfig {
  motivo: string;
  prioridade?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assigneePara?: string;
  incluirContexto?: boolean;
}

export type StepConfig =
  | CollectInfoConfig
  | SearchConfig
  | UpdateConfig
  | RespondConfig
  | WaitConfig
  | SendAttachmentConfig
  | SetTagConfig
  | ConditionConfig
  | EscalateConfig;

// ─── Workflow step definition ────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  nome: string;
  tipo: StepType;
  config: StepConfig;
  proximoStep?: string;
  opcional?: boolean;
  descricao?: string;
}

// ─── Step execution result ───────────────────────────────────────────────────

export interface StepResult {
  success: boolean;
  data?: Record<string, unknown>;
  nextStepId?: string;
  shouldPause?: boolean;
  shouldComplete?: boolean;
  message?: string;
  error?: string;
}
