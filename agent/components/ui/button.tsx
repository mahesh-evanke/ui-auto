import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-sm whitespace-nowrap rounded-lg font-body-md text-body-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 [&_.material-symbols-outlined]:text-[18px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary-fixed",
        destructive: "bg-transparent border border-error text-error hover:bg-error/10",
        outline: "bg-transparent border border-outline-variant text-on-surface hover:border-primary hover:bg-surface-container-high",
        secondary: "bg-secondary-container text-on-secondary-container hover:bg-surface-container-high",
        ghost: "text-on-surface-variant hover:text-primary hover:bg-surface-container-high",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-md py-sm",
        sm: "h-8 px-sm text-body-sm",
        lg: "h-11 px-lg",
        icon: "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";
