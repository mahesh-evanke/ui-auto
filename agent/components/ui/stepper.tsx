import * as React from "react";
import { cn } from "../../lib/utils.js";

export interface StepDef {
  id: number;
  label: string;
  icon: string;
}

export function Stepper({ steps, current, onSelect }: { steps: StepDef[]; current: number; onSelect: (id: number) => void }) {
  return (
    <div className="relative flex items-center justify-between">
      <div className="absolute left-0 top-4 h-px w-full bg-outline-variant" />
      <div
        className="absolute left-0 top-4 h-px bg-primary transition-all duration-500"
        style={{ width: `${((Math.max(current, 1) - 1) / (steps.length - 1)) * 100}%` }}
      />
      {steps.map((step) => {
        const state = step.id < current ? "done" : step.id === current ? "active" : "upcoming";
        const clickable = step.id <= current;
        return (
          <div key={step.id} className="relative z-10 flex flex-col items-center gap-xs bg-surface-container-low px-sm">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelect(step.id)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all",
                state === "done" && "border-primary bg-primary text-background",
                state === "active" && "border-primary bg-surface-container-high text-primary shadow-[0_0_8px_rgba(192,193,255,0.4)]",
                state === "upcoming" && "border-outline-variant bg-surface-container-low text-on-surface-variant",
                clickable && "cursor-pointer"
              )}
            >
              {state === "done" ? (
                <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  check
                </span>
              ) : (
                <span className="font-body-sm text-body-sm font-semibold">{step.id}</span>
              )}
            </button>
            <span
              className={cn(
                "font-label-caps text-label-caps whitespace-nowrap normal-case",
                state === "active" ? "text-primary font-medium" : state === "upcoming" ? "text-on-surface-variant" : "text-on-surface"
              )}
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
