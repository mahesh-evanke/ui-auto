import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva("inline-flex items-center gap-xs rounded border px-xs py-[2px] font-label-caps text-label-caps uppercase tracking-wider", {
  variants: {
    variant: {
      default: "border-outline-variant bg-surface text-on-surface-variant",
      primary: "border-primary/30 bg-primary/5 text-primary",
      secondary: "border-transparent bg-secondary-container text-on-secondary-container",
      destructive: "border-error/30 bg-error/10 text-error",
      success: "border-log-success/30 bg-log-success/10 text-log-success",
      warning: "border-tertiary/30 bg-tertiary/10 text-tertiary",
      outline: "border-outline-variant text-on-surface",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
