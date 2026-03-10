import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      <div className="mb-4 text-text-tertiary">{icon}</div>
      <h3 className="text-base font-medium text-text-primary mb-1">{title}</h3>
      <p className="text-body-sm text-text-secondary max-w-sm">{description}</p>
      {actionLabel && (
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
      )}
    </div>
  );
}
