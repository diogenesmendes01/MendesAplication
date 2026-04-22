"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type StepStatus = "completed" | "current" | "future";

interface Step {
  label: string;
  status: StepStatus;
}

interface ProposalStepperProps {
  proposalStatus: string;
  hasBoletos: boolean;
  hasBoletoPaid: boolean;
  /** True only when ALL boletos are PAID and each has a corresponding ISSUED invoice */
  allBoletosComplete: boolean;
}

function resolveSteps({
  proposalStatus,
  hasBoletos,
  hasBoletoPaid,
  allBoletosComplete,
}: ProposalStepperProps): Step[] {
  const steps: Step[] = [
    { label: "Criada", status: "future" },
    { label: "Enviada", status: "future" },
    { label: "Aceita", status: "future" },
    { label: "Boleto", status: "future" },
    { label: "Pago", status: "future" },
    { label: "NFS-e", status: "future" },
  ];

  // If cancelled/rejected/expired, mark only "Criada" as completed and stop
  if (["CANCELLED", "REJECTED", "EXPIRED"].includes(proposalStatus)) {
    steps[0].status = "completed";
    return steps;
  }

  // Determine the current level
  let currentLevel = 0;

  if (hasBoletoPaid && allBoletosComplete) {
    currentLevel = 6; // all done
  } else if (hasBoletoPaid) {
    currentLevel = 5; // waiting NFS-e for some paid boletos
  } else if (hasBoletos) {
    currentLevel = 4; // waiting payment
  } else if (proposalStatus === "ACCEPTED") {
    currentLevel = 3; // waiting boleto gen
  } else if (proposalStatus === "SENT") {
    currentLevel = 2; // waiting acceptance
  } else if (proposalStatus === "DRAFT") {
    currentLevel = 1; // waiting send
  }

  for (let i = 0; i < steps.length; i++) {
    if (i < currentLevel) {
      steps[i].status = "completed";
    } else if (i === currentLevel && currentLevel < 6) {
      steps[i].status = "current";
    }
  }

  // If all done, last one is also completed
  if (currentLevel >= 6) {
    steps[5].status = "completed";
  }

  return steps;
}

export function ProposalStepper(props: ProposalStepperProps) {
  const steps = resolveSteps(props);

  return (
    <div className="flex items-center justify-between w-full max-w-2xl mx-auto">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center flex-1 last:flex-none">
          {/* Step circle + label */}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200",
                step.status === "completed" &&
                  "border-success bg-success text-white",
                step.status === "current" &&
                  "border-accent bg-accent text-white shadow-md",
                step.status === "future" &&
                  "border-border bg-surface text-text-tertiary"
              )}
            >
              {step.status === "completed" ? (
                <Check className="h-4 w-4" />
              ) : step.status === "current" ? (
                <div className="h-2 w-2 rounded-full bg-white" />
              ) : (
                <div className="h-2 w-2 rounded-full bg-text-tertiary/40" />
              )}
            </div>
            <span
              className={cn(
                "text-[11px] font-medium whitespace-nowrap",
                step.status === "completed" && "text-success",
                step.status === "current" && "text-accent font-semibold",
                step.status === "future" && "text-text-tertiary"
              )}
            >
              {step.label}
            </span>
          </div>

          {/* Connector line */}
          {i < steps.length - 1 && (
            <div className="flex-1 mx-2 mt-[-18px]">
              <div
                className={cn(
                  "h-0.5 w-full rounded-full transition-colors duration-200",
                  step.status === "completed" ? "bg-success" : "bg-border"
                )}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
