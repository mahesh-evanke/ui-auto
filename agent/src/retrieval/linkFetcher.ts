/**
 * Best-effort text extraction from a URL a user pastes in as a requirement
 * source (a spec page, a public doc, etc). This is a plain unauthenticated
 * GET - it cannot and does not try to log into Confluence/PolicyNet/any
 * internal wiki, so an auth-walled link will fail here. That failure is
 * returned as a reason string, not swallowed - the caller surfaces it as an
 * "unreadable link" rather than silently treating the source as empty.
 */
export interface FetchedLink {
  url: string;
  text: string;
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_LINK_CHARS = 20_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchLinkText(url: string): Promise<FetchedLink | { url: string; error: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/html,text/plain" },
    });
    if (!res.ok) {
      return { url, error: `HTTP ${res.status} - likely requires sign-in or doesn't exist` };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)/i.test(contentType)) {
      return { url, error: `Unsupported content-type "${contentType}" - only HTML/plain text pages are read` };
    }
    const raw = await res.text();
    const text = stripHtml(raw).slice(0, MAX_LINK_CHARS);
    if (!text) return { url, error: "Page had no readable text content" };
    return { url, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { url, error: `Could not fetch: ${message}` };
  }
}

export async function fetchLinks(urls: string[]): Promise<{ fetched: FetchedLink[]; failed: string[] }> {
  const fetched: FetchedLink[] = [];
  const failed: string[] = [];
  const results = await Promise.all(urls.map((u) => fetchLinkText(u)));
  for (const r of results) {
    if ("text" in r) fetched.push(r);
    else failed.push(`${r.url} (${r.error})`);
  }
  return { fetched, failed };
}
