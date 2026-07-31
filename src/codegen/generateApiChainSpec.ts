/**
 * Turns a captured API sequence + its analyzeApiChain() report into a real,
 * runnable spec file - the "generate an API-only end-to-end test, in lines
 * of how the UI spec/feature files are generated" ask.
 *
 * Every STRONG (matchType 'value') link is auto-wired: the source call gets
 * a .saveResponseField(path, key), and every place that value is consumed
 * (a request body field OR a numeric URL path segment) is rewritten to read
 * it back via apiActions.context.get(key) instead of the literal value that
 * happened to be captured - so the generated test doesn't break next run
 * just because the server issues a different id. Genuinely user-supplied
 * fields (nothing detected feeding them) are left as the literal values that
 * were captured, same as any hand-written API test.
 *
 * WEAK (matchType 'name') links are NOT auto-wired - same field name but a
 * different/absent value is too weak a signal to trust blindly. They're
 * listed in a comment at the top of the generated file for manual review.
 */
import type { CapturedApi } from '../api/capture';
import type { ApiChainReport, ApiChainLink } from '../api/chainAnalyzer';

export interface GenerateApiChainSpecOptions {
  /** Test name in the generated file. Default: 'Generated API chain'. */
  testName?: string;
  /** Import path for { test, expect } in the generated file, relative to where it will live. Default: '../src'. */
  importPath?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Serializes `value` to TypeScript source, replacing any leaf whose path is in `linkedPaths` with a live apiActions.context.get(key) read instead of the literal. */
function emitValue(value: unknown, path: string, linkedPaths: Map<string, string>): string {
  const key = linkedPaths.get(path);
  if (key !== undefined) return `apiActions.context.get(${JSON.stringify(key)})`;

  if (Array.isArray(value)) {
    return `[${value.map((v, i) => emitValue(v, `${path}[${i}]`, linkedPaths)).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${emitValue(v, path ? `${path}.${k}` : k, linkedPaths)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

/**
 * Rebuilds a URL as a template literal, substituting each linked numeric path
 * segment AND each linked numeric query parameter with a live
 * apiActions.context.get(key) read. If more than one earlier call could
 * supply the same segment (e.g. both call 0's and call 1's response contain
 * the same "id"), the Map below keeps the LAST one - i.e. the most recently
 * preceding call - which is the most likely intended source for a value that
 * "flows forward" through the chain.
 */
function emitUrlTemplate(url: string, urlLinks: ApiChainLink[], keyOf: (link: ApiChainLink) => string): string {
  const [pathname, query] = url.split('?');
  const segments = pathname.split('/');
  const pathLinks = urlLinks.filter((l) => l.toPath.startsWith('$url:'));
  const queryLinks = urlLinks.filter((l) => l.toPath.startsWith('$query:'));
  const bySegmentIndex = new Map(pathLinks.map((l) => [Number(l.toPath.slice('$url:'.length)), l]));
  const byQueryKey = new Map(queryLinks.map((l) => [l.toPath.slice('$query:'.length), l]));

  const rebuiltPath = segments
    .map((segment, i) => {
      const link = bySegmentIndex.get(i);
      return link ? `\${apiActions.context.get(${JSON.stringify(keyOf(link))})}` : segment;
    })
    .join('/');

  const rebuiltQuery = query
    ? query
        .split('&')
        .map((pair) => {
          const [key, value] = pair.split('=');
          const link = byQueryKey.get(key);
          return link ? `${key}=\${apiActions.context.get(${JSON.stringify(keyOf(link))})}` : `${key}=${value}`;
        })
        .join('&')
    : '';

  return `\`${rebuiltPath}${rebuiltQuery ? `?${rebuiltQuery}` : ''}\``;
}

export function generateApiChainSpec(calls: CapturedApi[], report: ApiChainReport, options: GenerateApiChainSpecOptions = {}): string {
  const testName = options.testName ?? 'Generated API chain';
  const importPath = options.importPath ?? '../src';

  // One stable, human-readable key per SOURCE (fromCall, fromPath) - reused
  // if the same source value feeds more than one later call.
  const keyByLinkSource = new Map<string, string>();
  const usedKeys = new Set<string>();
  const keyOf = (link: ApiChainLink): string => {
    const sourceId = `${link.fromCall}:${link.fromPath}`;
    const existing = keyByLinkSource.get(sourceId);
    if (existing) return existing;
    let key = link.field || 'value';
    let n = 1;
    while (usedKeys.has(key)) key = `${link.field || 'value'}${++n}`;
    usedKeys.add(key);
    keyByLinkSource.set(sourceId, key);
    return key;
  };

  const strongLinks = report.links.filter((l) => l.matchType === 'value');
  const weakLinks = report.links.filter((l) => l.matchType === 'name');

  const linksByToCall = new Map<number, ApiChainLink[]>();
  const linksByFromCall = new Map<number, ApiChainLink[]>();
  for (const link of strongLinks) {
    if (!linksByToCall.has(link.toCall)) linksByToCall.set(link.toCall, []);
    linksByToCall.get(link.toCall)!.push(link);
    if (!linksByFromCall.has(link.fromCall)) linksByFromCall.set(link.fromCall, []);
    linksByFromCall.get(link.fromCall)!.push(link);
  }

  const lines: string[] = [];
  lines.push(`import { test, expect } from '${importPath}';`);
  lines.push('');
  lines.push('/**');
  lines.push(' * AUTO-GENERATED by generateApiChainSpec() from a captured API sequence.');
  lines.push(' * Every saveResponseField()/context.get() pair below was detected');
  lines.push(' * automatically (analyzeApiChain) by matching a later call\'s request');
  lines.push(' * field/URL id against an earlier call\'s response field - not hand-wired.');
  lines.push(' * Fields with no detected source are left as the literal values captured');
  lines.push(' * (genuinely user-supplied input, e.g. login credentials).');
  if (weakLinks.length > 0) {
    lines.push(' *');
    lines.push(' * Weak matches found (same field name, different value) - NOT auto-wired,');
    lines.push(' * review manually if one of these should actually be linked:');
    for (const l of weakLinks) {
      lines.push(` *   call ${l.fromCall} response."${l.fromPath}" -> call ${l.toCall} request."${l.toPath}" (field "${l.field}")`);
    }
  }
  lines.push(' */');
  lines.push(`test(${JSON.stringify(testName)}, async ({ apiActions }) => {`);

  calls.forEach((call, i) => {
    const toLinks = linksByToCall.get(i) ?? [];
    const urlLinks = toLinks.filter((l) => l.toPath.startsWith('$url:') || l.toPath.startsWith('$query:'));
    const bodyLinks = toLinks.filter((l) => !l.toPath.startsWith('$url:') && !l.toPath.startsWith('$query:'));

    const needsLazyUrl = urlLinks.length > 0;
    const urlSource = needsLazyUrl ? emitUrlTemplate(call.url, urlLinks, keyOf) : JSON.stringify(call.url);
    const urlArg = needsLazyUrl ? `() => ${urlSource}` : urlSource;

    let bodyArg = '';
    if (call.requestBody !== undefined && call.requestBody !== null) {
      const bodyLinkMap = new Map(bodyLinks.map((l) => [l.toPath, keyOf(l)]));
      bodyArg = `, ${emitValue(call.requestBody, '', bodyLinkMap)}`;
    }

    lines.push('  await apiActions');
    lines.push(`    .sendRequest(${JSON.stringify(call.method)}, ${urlArg}${bodyArg})`);

    // Several later calls can consume the SAME source value (e.g. every
    // subsequent call here reuses call 0's "id") - saveResponseField() only
    // needs to run once per distinct source, not once per consumer.
    const fromLinks = linksByFromCall.get(i) ?? [];
    const uniqueFromLinks: ApiChainLink[] = [];
    const seenSourcePaths = new Set<string>();
    for (const l of fromLinks) {
      if (seenSourcePaths.has(l.fromPath)) continue;
      seenSourcePaths.add(l.fromPath);
      uniqueFromLinks.push(l);
    }

    const isLast = uniqueFromLinks.length === 0;
    lines.push(`    .expectStatus(${call.status})${isLast ? ';' : ''}`);
    uniqueFromLinks.forEach((l, idx) => {
      const isLastOfCall = idx === uniqueFromLinks.length - 1;
      lines.push(`    .saveResponseField(${JSON.stringify(l.fromPath)}, ${JSON.stringify(keyOf(l))})${isLastOfCall ? ';' : ''}`);
    });
    lines.push('');
  });

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}
