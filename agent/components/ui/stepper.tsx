import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils.js";

export interface StepDef {
  id: number;
  label: string;
  description: string;
  icon: React.ReactNode;
}

export function Stepper({ steps, current, onSelect }: { steps: StepDef[]; current: number; onSelect: (id: number) => void }) {
  return (
    <ol className="flex w-full items-start">
      {steps.map((step, i) => {
        const state = step.id < current ? "done" : step.id === current ? "active" : "upcoming";
        const clickable = step.id <= current;
        return (
          <li key={step.id} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect(step.id)}
                className={cn(
                  "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all",
                  state === "done" && "border-primary bg-primary/15 text-primary hud-glow",
                  state === "active" && "border-primary bg-primary text-primary-foreground hud-glow scale-110",
                  state === "upcoming" && "border-border bg-secondary/40 text-muted-foreground",
                  clickable && state !== "active" && "cursor-pointer hover:border-primary/60"
                )}
              >
                {state === "done" ? <Check className="h-5 w-5" /> : step.icon}
              </button>
              <div className="mt-3 max-w-[9rem] text-center">
                <div className={cn("text-sm font-medium", state === "upcoming" ? "text-muted-foreground" : "text-foreground")}>{step.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{step.description}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="relative mt-5 h-[2px] flex-1 mx-2 overflow-hidden rounded-full bg-border">
                <div
                  className="absolute inset-y-0 left-0 bg-primary transition-all duration-500 ease-out"
                  style={{ width: step.id < current ? "100%" : "0%" }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
