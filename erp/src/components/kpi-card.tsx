"use client";

import { useEffect, useRef, useState } from "react";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface KPICardProps {
  icon: React.ReactNode;
  iconBg: string;
  value: number;
  label: string;
  format?: "currency" | "number";
  /** Previous period value for comparison — omit to hide badge */
  previousValue?: number;
  /** Override badge text (e.g. "5 com SLA crítico") */
  badgeOverride?: {
    text: string;
    variant: "up" | "down" | "neutral" | "danger";
  };
  className?: string;
}

function formatCurrencyCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function useCountUp(target: number, duration = 600): number {
  const [current, setCurrent] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const startTime = performance.now();
    const startValue = 0;

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(startValue + (target - startValue) * eased);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return current;
}

export function KPICard({
  icon,
  iconBg,
  value,
  label,
  format = "currency",
  previousValue,
  badgeOverride,
  className,
}: KPICardProps) {
  const animatedValue = useCountUp(value);

  const formattedValue =
    format === "currency"
      ? formatCurrencyCompact(Math.round(animatedValue))
      : Math.round(animatedValue).toLocaleString("pt-BR");

  // Compute variation
  let variationPercent: number | null = null;
  let variationDirection: "up" | "down" | "neutral" = "neutral";

  if (previousValue !== undefined && previousValue !== 0) {
    variationPercent = ((value - previousValue) / Math.abs(previousValue)) * 100;
    variationDirection = variationPercent > 0 ? "up" : variationPercent < 0 ? "down" : "neutral";
  } else if (previousValue === 0 && value > 0) {
    variationDirection = "up";
  }

  const badgeStyles = {
    up: "bg-success-subtle text-success",
    down: "bg-danger-subtle text-danger",
    neutral: "bg-background-subtle text-text-secondary",
    danger: "bg-danger-subtle text-danger",
  };

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-px cursor-default",
        className
      )}
    >
      {/* Icon */}
      <div
        className="mb-4 flex h-10 w-10 items-center justify-center rounded-[10px]"
        style={{ background: iconBg }}
      >
        {icon}
      </div>

      {/* Value */}
      <div
        className="text-[28px] font-bold leading-tight tracking-tight text-text-primary mb-1"
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" }}
      >
        {formattedValue}
      </div>

      {/* Label */}
      <div className="text-caption font-medium text-text-secondary mb-3">
        {label}
      </div>

      {/* Badge */}
      {badgeOverride ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
            badgeStyles[badgeOverride.variant]
          )}
        >
          {badgeOverride.variant === "danger" && <AlertCircle className="h-[11px] w-[11px]" />}
          {badgeOverride.variant === "up" && <TrendingUp className="h-[11px] w-[11px]" />}
          {badgeOverride.variant === "down" && <TrendingDown className="h-[11px] w-[11px]" />}
          {badgeOverride.text}
        </span>
      ) : variationPercent !== null ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
            badgeStyles[variationDirection]
          )}
        >
          {variationDirection === "up" && <TrendingUp className="h-[11px] w-[11px]" />}
          {variationDirection === "down" && <TrendingDown className="h-[11px] w-[11px]" />}
          {variationPercent > 0 ? "+" : ""}
          {variationPercent.toFixed(0)}% vs anterior
        </span>
      ) : null}
    </div>
  );
}
