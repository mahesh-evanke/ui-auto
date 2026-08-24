import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";

/**
 * A plain native <select>, styled to match the rest of the kit - not Radix's
 * Select primitive. Native gives free keyboard/mobile/accessibility behavior
 * and this app never needs custom option rendering, so the extra dependency
 * and portal handling Radix's version requires isn't worth it here.
 */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none rounded-md border border-input bg-secondary/50 px-3 py-2 pr-8 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
);
Select.displayName = "Select";
