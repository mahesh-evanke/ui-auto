import type { RetrievedFile } from "./codeSearch.js";

/**
 * Concrete, interactable things found in the application's own source -
 * button labels, input ids, link text, headings.
 *
 * The scenario planner already sees raw source excerpts, but the step planner
 * did not, so it invented element names ("More Info link", "notice message")
 * that exist nowhere in the app. A short, explicit list of the REAL labels is
 * far easier for a small local model to use correctly than raw JSX, and it is
 * what makes a generated step like `User clicks on "Count Me" button` line up
 * with something that actually exists on the page.
 */
export interface ExtractedUiElement {
  kind: "button" | "link" | "input" | "heading" | "text";
  label: string;
  id?: string;
}

const MAX_ELEMENTS = 25;

/**
 * A tag's attribute section: any run of characters that are neither `>` nor
 * `{`, plus balanced `{...}` blocks (one level of nesting) so JSX expression
 * attributes containing `>` don't terminate the match early.
 */
const ATTRS = "(?:[^>{]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*";

function cleanLabel(raw: string): string {
  const plain = raw
    .replace(/\{[^}]*\}/g, " ") // drop JSX expressions like {saving ? ... : ...}
    .replace(/<[^>]*>/g, " ") // drop nested tags
    .replace(/\s+/g, " ")
    .trim();
  if (plain) return plain;

  // The label was entirely a JSX expression, e.g.
  //   <button>{saving ? "Saving..." : "Save"}</button>
  // Fall back to the last string literal in it, which for a ternary is the
  // idle-state label ("Save") - the one a test should be clicking.
  const literals = [...raw.matchAll(/["']([^"']{2,40})["']/g)].map((m) => m[1]);
  return literals.length > 0 ? literals[literals.length - 1] : "";
}

function attr(tagSource: string, name: string): string | undefined {
  const m = tagSource.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`));
  return m?.[1];
}

/**
 * Regex-based extraction over JSX/HTML/Vue templates. Deliberately
 * dependency-free and lenient: a missed element just means slightly weaker
 * grounding, never a crash, so no parser is worth pulling in here.
 */
export function extractUiElements(files: RetrievedFile[]): ExtractedUiElement[] {
  const out: ExtractedUiElement[] = [];
  const seen = new Set<string>();

  const push = (el: ExtractedUiElement) => {
    const label = cleanLabel(el.label);
    if (!label || label.length > 60) return;
    const key = `${el.kind}:${label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...el, label });
  };

  for (const file of files) {
    const src = file.excerpt;

    // <button ...>Label</button>, <a ...>Label</a>, <h1..h3>, <label>
    //
    // Attributes are matched as "anything that isn't > or {, or a balanced
    // {...} block" rather than [^>]*, because JSX handlers routinely contain
    // a > inside them (`onClick={() => setCount(c + 1)}`) and a naive [^>]*
    // ends the tag early, dragging handler code into the extracted label.
    const paired = new RegExp(
      `<(button|a|h1|h2|h3|label)\\b(${ATTRS})>([\\s\\S]{0,120}?)<\\/\\1>`,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = paired.exec(src)) !== null) {
      const [, tag, attrs, inner] = m;
      const lower = tag.toLowerCase();
      const kind: ExtractedUiElement["kind"] =
        lower === "button" ? "button" : lower === "a" ? "link" : lower === "label" ? "text" : "heading";
      push({ kind, label: inner, id: attr(attrs, "id") });
    }

    // Self-closing inputs: prefer placeholder/aria-label/name/id as the label.
    const inputs = new RegExp(`<(input|textarea|select)\\b(${ATTRS})\\/?>`, "gi");
    while ((m = inputs.exec(src)) !== null) {
      const attrs = m[2];
      const label = attr(attrs, "placeholder") ?? attr(attrs, "aria-label") ?? attr(attrs, "name") ?? attr(attrs, "id");
      if (label) push({ kind: "input", label, id: attr(attrs, "id") });
    }
  }

  return out.slice(0, MAX_ELEMENTS);
}

/** Renders the elements as prompt lines the model can copy labels out of. */
export function renderUiElements(elements: ExtractedUiElement[]): string {
  if (elements.length === 0) return "";
  return elements.map((e) => `- ${e.kind}: "${e.label}"${e.id ? ` (id="${e.id}")` : ""}`).join("\n");
}
