import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/utils.js";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-outline-variant focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-on-primary",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <span className="material-symbols-outlined text-[14px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
        check
      </span>
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

/** The pill-shaped toggle switch the reference uses for "Legacy Modernization" / "Auto-fix Selectors" - distinct from the plain square Checkbox above. */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-5 w-9 shrink-0 rounded-full bg-surface-container-highest transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-[2px] rounded-full bg-white transition-transform data-[state=checked]:translate-x-[18px]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
