"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { cn } from "../lib/utils.js";

const OPTIONS = [
  { value: "light", icon: "light_mode", label: "Light" },
  { value: "dark", icon: "dark_mode", label: "Dark" },
  { value: "system", icon: "computer", label: "System" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Avoids a hydration mismatch: the server has no way to know the user's
  // stored preference (or OS preference for "system"), so the real value is
  // only rendered once mounted on the client - before that, all three
  // options render unselected.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center rounded-full border border-outline-variant bg-surface-container p-[2px]">
      {OPTIONS.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={`${opt.label} theme`}
            onClick={() => setTheme(opt.value)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
              active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">{opt.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
