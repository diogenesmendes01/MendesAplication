// Alert action types — exported separately to avoid "use server" export constraints.
// This file has NO "use server" directive and can be safely imported by both
// server and client components.

export const METRIC_TYPES = [
  { value: "cost_daily", label: "Custo diário (BRL)", defaultThreshold: 10, defaultOp: "gt" },
  { value: "escalation_rate", label: "Taxa de escalação", defaultThreshold: 0.3, defaultOp: "gt" },
  { value: "confidence_avg", label: "Confidence média", defaultThreshold: 0.5, defaultOp: "lt" },
  { value: "rejection_rate", label: "Taxa de rejeição", defaultThreshold: 0.3, defaultOp: "gt" },
] as const;

export type MetricType = (typeof METRIC_TYPES)[number]["value"];
