import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-accent-subtle text-accent",
        secondary:
          "bg-background-subtle text-text-secondary",
        destructive:
          "bg-danger-subtle text-danger",
        success:
          "bg-success-subtle text-success",
        warning:
          "bg-warning-subtle text-warning",
        info:
          "bg-info-subtle text-info",
        outline: "border border-border text-text-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  withDot?: boolean
}

function Badge({ className, variant, withDot, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {withDot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            variant === "default" && "bg-accent",
            variant === "secondary" && "bg-text-secondary",
            variant === "destructive" && "bg-danger",
            variant === "success" && "bg-success",
            variant === "warning" && "bg-warning",
            variant === "info" && "bg-info"
          )}
        />
      )}
      {props.children}
    </div>
  )
}

export { Badge, badgeVariants }
