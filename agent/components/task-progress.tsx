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
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
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
    <div className="mt-md flex flex-col gap-xs rounded-lg border border-outline-variant bg-surface-container p-sm font-code-sm text-code-sm">
      {events.map((e, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start gap-sm animate-fade-in",
            i === events.length - 1 && e.status === "active" && "text-primary"
          )}
        >
          <span className="mt-0.5 shrink-0">
            {e.status === "done" && (
              <span className="material-symbols-outlined text-[16px] text-log-success">check</span>
            )}
            {e.status === "failed" && <span className="material-symbols-outlined text-[16px] text-error">close</span>}
            {e.status === "active" && (
              <span className="material-symbols-outlined animate-spin text-[16px] text-primary">progress_activity</span>
            )}
          </span>
          <span className="text-on-surface-variant">{linkify(e.label)}</span>
        </div>
      ))}
    </div>
  );
}
