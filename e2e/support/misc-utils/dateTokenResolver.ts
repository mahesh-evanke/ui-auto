/**
 * <CURRENT_DATE,...>:format token resolution, shared by the Given/When/Then
 * wrapper (web.steps.ts) so every step gets it automatically. Scoped to
 * CURRENT_DATE only - DOB/FRA tokens keep using TimeChanger inside their own
 * step bodies, since those need scenario-specific dob values this resolver
 * doesn't have access to.
 */

type DateUnit = 'Y' | 'M' | 'D';

/** Parses a comma-offset list like ",1Y,-1M,7D" into [{amount:1,unit:'Y'}, ...]. */
function parseDateOffsets(raw: string): Array<{ amount: number; unit: DateUnit }> {
  const out: Array<{ amount: number; unit: DateUnit }> = [];
  const re = /(-?\d+)\s*([YMD])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw || ''))) {
    out.push({ amount: Number(m[1]), unit: m[2].toUpperCase() as DateUnit });
  }
  return out;
}

/**
 * Applies year/month/day offsets to a date. Sums same-unit offsets, then applies
 * in Y -> M -> D order on a single mutating Date so day/month rollover behaves
 * like calendar arithmetic (e.g. +1M on Jan 31 rolls into March, matching
 * native Date.setMonth semantics) rather than three independent calculations.
 */
function applyDateOffsets(base: Date, offsets: Array<{ amount: number; unit: DateUnit }>): Date {
  const d = new Date(base.getTime());
  let dy = 0, dm = 0, dd = 0;
  for (const o of offsets) {
    if (o.unit === 'Y') dy += o.amount;
    else if (o.unit === 'M') dm += o.amount;
    else dd += o.amount;
  }
  if (dy) d.setFullYear(d.getFullYear() + dy);
  if (dm) d.setMonth(d.getMonth() + dm);
  if (dd) d.setDate(d.getDate() + dd);
  return d;
}

/** Renders a date using a dd/mm/yyyy-style pattern (case-insensitive; yy = 2-digit year). */
function formatByPattern(d: Date, format: string | undefined, fallback: string): string {
  const pattern = format && format.trim() ? format.trim() : fallback;
  const yyyy = String(d.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return pattern
    .replace(/yyyy/gi, yyyy)
    .replace(/yy/gi, yy)
    .replace(/mm/gi, mm)
    .replace(/dd/gi, dd);
}

/**
 * Resolves <CURRENT_DATE> style tokens embedded in step/table text:
 *   <CURRENT_DATE>                          today, `defaultFormat` (default "mm/dd/yyyy")
 *   <CURRENT_DATE+N>                        legacy N-days-forward shorthand
 *   <CURRENT_DATE,1Y>                       +1 year
 *   <CURRENT_DATE,-1M>                      -1 month
 *   <CURRENT_DATE,1D>                       +1 day
 *   <CURRENT_DATE,1Y,1M,1D>                 combined (any order, any count)
 *   <CURRENT_DATE,-1Y,-1M,-1D>              combined, past
 *   <CURRENT_DATE,1M>:mm/yyyy                combined, with output format
 * Y/M/D are case-insensitive; CURRENT_DATE itself is case-insensitive too.
 */
export function resolveDynamicTokens(input: string, now: Date = new Date(), defaultFormat: string = 'mm/dd/yyyy'): string {
  let out = String(input ?? '');

  // Legacy shorthand: <CURRENT_DATE+N> - N days forward, fixed default format.
  out = out.replace(/<CURRENT_DATE\s*\+\s*([0-9]+)\s*>/gi, (_m, nRaw) => {
    const n = Number(nRaw);
    const d = new Date(now);
    d.setDate(d.getDate() + (Number.isFinite(n) ? n : 0));
    return formatByPattern(d, undefined, defaultFormat);
  });

  // General form: <CURRENT_DATE[,<±N><Y|M|D>...]>[:<format>]
  out = out.replace(
    /<CURRENT_DATE((?:\s*,\s*-?\d+\s*[YMD])*)\s*>(?:\s*:\s*([A-Za-z0-9/\-.]+))?/gi,
    (_m, offsetsRaw: string, formatRaw?: string) => {
      const d = applyDateOffsets(now, parseDateOffsets(offsetsRaw));
      return formatByPattern(d, formatRaw, defaultFormat);
    },
  );

  return out;
}
