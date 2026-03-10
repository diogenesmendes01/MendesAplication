"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  /** Lucide icon component — rendered at 48px with stroke 1.5 */
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional action button label */
  actionLabel?: string;
  /** If provided, renders button as a link */
  actionHref?: string;
  /** Click handler for action button (ignored if actionHref is set) */
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
}: EmptyStateProps) {
  const actionButton = actionLabel ? (
    actionHref ? (
      <a href={actionHref}>
        <Button className="mt-4" size="sm">
          {actionLabel}
        </Button>
      </a>
    ) : onAction ? (
      <Button className="mt-4" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : null
  ) : null;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-4 text-center",
        className
      )}
    >
      {/* Icon: 48px, stroke 1.5, text-tertiary */}
      <Icon
        className="mb-4 text-text-tertiary"
        size={48}
        strokeWidth={1.5}
      />

      {/* Title: 16px medium */}
      <h3 className="text-[16px] font-medium leading-snug text-text-primary mb-1">
        {title}
      </h3>

      {/* Description: 14px secondary */}
      <p className="text-[14px] leading-relaxed text-text-secondary max-w-sm">
        {description}
      </p>

      {actionButton}
    </div>
  );
}
