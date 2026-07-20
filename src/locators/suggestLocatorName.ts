/**
 * Suggests the closest known locator name for a typo'd lookup, using
 * Levenshtein edit distance. Used as a "Did you mean ...?" hint when a spec
 * file references a name that isn't in any loaded locator YAML, instead of
 * silently falling through to the broad smartLocator() guess.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/** Closest match to `name` among `candidates`, or undefined if nothing is close enough to be useful. */
export function suggestClosestName(name: string, candidates: string[], maxDistance = 4): string | undefined {
  const target = name.trim().toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshteinDistance(target, candidate.trim().toLowerCase());
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  return best && best.distance <= maxDistance ? best.candidate : undefined;
}
