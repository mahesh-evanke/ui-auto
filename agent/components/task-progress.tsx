import { Check, X, Loader2 } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface ProgressEvent {
  label: string;
  status: "done" | "active" | "failed";
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function linkify(text: string) {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function TaskProgress({ events }: { events: ProgressEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-4 space-y-1.5 rounded-lg border border-border bg-muted/40 p-3">
      {events.map((e, i) => (
        <div key={i} className={cn("flex items-start gap-2 text-sm animate-fade-in", i === events.length - 1 && e.status === "active" && "text-primary")}>
          <span className="mt-0.5 shrink-0">
            {e.status === "done" && <Check className="h-3.5 w-3.5 text-success" />}
            {e.status === "failed" && <X className="h-3.5 w-3.5 text-destructive" />}
            {e.status === "active" && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          </span>
          <span className="text-muted-foreground">{linkify(e.label)}</span>
        </div>
      ))}
    </div>
  );
}
