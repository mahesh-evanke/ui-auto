import Link from "next/link";
import { cn } from "../lib/utils.js";

export interface ProgressEvent {
  label: string;
  status: "done" | "active" | "failed";
  /** Set only on the event announcing an LLM call is about to fire - which prompt (from the Prompts page) is being sent. */
  promptId?: string;
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

// Mirrors promptStore.ts's PROMPT_DEFS agent field - kept as a small local
// display-name map rather than fetching the full registry just to label a
// badge, since this only needs the human-readable agent name per id.
const PROMPT_AGENT_LABEL: Record<string, string> = {
  "requirement-agent.system": "Requirement Agent",
  "gap-analysis.system": "Gap Analysis Agent",
  "gap-analysis.legacy-addendum": "Gap Analysis Agent",
  "test-planning.template": "Test Planning Agent",
  "spec-generator.system": "Spec Generator Agent",
  "step-definition-generator.system": "Step Definition Generator Agent",
  "test-fixer.system": "Test Fixer Agent",
};

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
        <div key={i} className="flex flex-col gap-1">
          <div
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
          {e.promptId && (
            <Link
              href={`/prompts?id=${encodeURIComponent(e.promptId)}`}
              className="ml-[24px] flex w-fit items-center gap-1 rounded border border-outline-variant bg-surface-container-high px-1.5 py-0.5 font-body-sm text-body-sm text-primary no-underline hover:border-primary"
              title="Open this prompt in the Prompts editor"
            >
              <span className="material-symbols-outlined text-[13px]">psychology</span>
              {PROMPT_AGENT_LABEL[e.promptId] ?? e.promptId}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
