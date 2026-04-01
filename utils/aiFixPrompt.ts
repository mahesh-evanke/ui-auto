/**
 * Builds a markdown "Fix with AI" bundle for failed UI scenarios: Gherkin feature,
 * YAML locators, error output, and a Playwright aria snapshot of the current page.
 *
 * Enable with AI_FIX_ENABLED=true. Optional: AI_FIX_USER_PROBLEM="button moved to header"
 * Optional: AI_FIX_SCREENSHOT=true saves a PNG next to the .md under test-results/ai-fix/
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ITestCaseHookParameter } from '@cucumber/cucumber';
import type { AutomationWorld } from '../steps-def/world';

const FRAMEWORK_ROOT = path.join(__dirname, '..');

export function isAiFixEnabled(): boolean {
  const v = process.env.AI_FIX_ENABLED?.toLowerCase();
  if (v === undefined || v === '') return false;
  return v === 'true' || v === '1' || v === 'yes';
}

export function isAiFixLlmEnabled(): boolean {
  const v = process.env.AI_FIX_LLM_ENABLED?.toLowerCase();
  if (v === undefined || v === '') return false;
  return v === 'true' || v === '1' || v === 'yes';
}

function resolveFeaturePath(uri: string): string {
  if (path.isAbsolute(uri)) return uri;
  const candidates = [path.join(process.cwd(), uri), path.join(FRAMEWORK_ROOT, uri)];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), uri);
}

function safeRead(p: string): string | null {
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  } catch {
    /* ignore */
  }
  return null;
}

function pickleStepsText(pickle: ITestCaseHookParameter['pickle']): string {
  return pickle.steps.map((s) => s.text).join('\n');
}

export async function buildAiFixMarkdown(
  world: AutomationWorld,
  scenario: ITestCaseHookParameter
): Promise<{ markdown: string; screenshotPath?: string }> {
  const pickle = scenario.pickle;
  const featureUri = pickle.uri;
  const featurePath = resolveFeaturePath(featureUri);
  const featureContent = safeRead(featurePath) ?? '(could not read feature file)';

  const locatorsRoot = path.join(FRAMEWORK_ROOT, 'locators');
  const pagesYaml = safeRead(path.join(locatorsRoot, 'pages.yaml'));
  const commonYaml = safeRead(path.join(locatorsRoot, 'common.yaml'));

  let pageYaml: string | null = null;
  let pageYamlRel = '';
  if (world.currentPageKey) {
    pageYamlRel = path.join('locators', 'pages', `${world.currentPageKey}.yaml`);
    pageYaml = safeRead(path.join(locatorsRoot, 'pages', `${world.currentPageKey}.yaml`));
  }

  let ariaSnapshot = '(no browser page — snapshot skipped)';
  let pageUrl = '';
  if (world.page) {
    try {
      pageUrl = world.page.url();
      ariaSnapshot = await world.page.locator('body').ariaSnapshot({ timeout: 15000 });
    } catch (e) {
      ariaSnapshot = `(aria snapshot failed: ${e instanceof Error ? e.message : String(e)})`;
    }
  }

  const errMsg = scenario.result?.message ?? '';
  const ex = scenario.result?.exception;
  let errExtra = '';
  if (ex && typeof ex === 'object') {
    const m = 'message' in ex && typeof (ex as { message?: string }).message === 'string' ? (ex as { message: string }).message : '';
    const st = 'stackTrace' in ex && typeof (ex as { stackTrace?: string }).stackTrace === 'string' ? (ex as { stackTrace: string }).stackTrace : '';
    errExtra = [m, st].filter(Boolean).join('\n');
  }

  const userNote =
    process.env.AI_FIX_USER_PROBLEM?.trim() ||
    '(none — add context, e.g. set AI_FIX_USER_PROBLEM="Submit moved to the dialog footer")';

  const instructions = `## Fix with AI — Playwright + Cucumber

You are updating **Gherkin** and **YAML locators** so tests match the **current page structure**.

### What to do
1. Use the **page accessibility snapshot** (and optional screenshot path below) as the source of truth for visible roles/names.
2. Prefer fixing **locators** (\`locators/pages/<pageKey>.yaml\`, or \`common.yaml\`) using Playwright selectors: each entry is \`[kind, expression]\` where \`kind\` is \`css\` or \`xpath\`.
3. Change the **.feature** file only if step text must match new visible labels; keep step wording aligned with existing step definitions in \`steps-def/\`.
4. Return **complete** updated YAML sections and, if needed, the corrected scenario lines ready to paste into files.

### Locator shape (YAML)
\`\`\`yaml
MyButton:
  - css
  - 'button[data-testid="submit"]'
\`\`\`
or \`xpath\` with an XPath string in the second element.

`;

  const parts: string[] = [
    instructions,
    `### Tester notes / what changed`,
    userNote,
    '',
    `### Failed scenario: ${pickle.name}`,
    `- Feature URI: ${featureUri}`,
    `- Resolved path: ${featurePath}`,
    '',
    `### Scenario steps`,
    '```text',
    pickleStepsText(pickle),
    '```',
    '',
    `### Error`,
    '```',
    [errMsg, errExtra].filter(Boolean).join('\n\n') || '(no message)',
    '```',
    '',
    `### Page URL`,
    pageUrl || '(n/a)',
    '',
    `### Feature file`,
    '```gherkin',
    featureContent,
    '```',
    '',
    `### locators/pages.yaml`,
    '```yaml',
    pagesYaml ?? '(missing)',
    '```',
    '',
  ];

  if (commonYaml) {
    parts.push(`### locators/common.yaml`, '```yaml', commonYaml, '```', '');
  }

  if (world.currentPageKey) {
    parts.push(
      `### locators/pages/${world.currentPageKey}.yaml`,
      `File: ${pageYamlRel}`,
      '```yaml',
      pageYaml ?? '(missing or empty)',
      '```',
      ''
    );
  } else {
    parts.push(`### Active screen (currentPageKey)`, '(none — the failing step may run before `User is on "<screen>" screen`)', '');
  }

  parts.push('### Page accessibility snapshot (aria)', '```yaml', ariaSnapshot, '```');

  const markdown = parts.join('\n');

  let screenshotPath: string | undefined;
  if (process.env.AI_FIX_SCREENSHOT?.toLowerCase() === 'true' && world.page) {
    try {
      const dir = path.join(FRAMEWORK_ROOT, 'test-results', 'ai-fix');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      screenshotPath = path.join(dir, `snapshot-${stamp}.png`);
      await world.page.screenshot({ path: screenshotPath, fullPage: false });
    } catch {
      screenshotPath = undefined;
    }
  }

  if (screenshotPath) {
    return {
      markdown:
        markdown +
        '\n\n### Screenshot file (for visual context)\n' +
        `Saved on disk: ${screenshotPath}\n`,
      screenshotPath,
    };
  }

  return { markdown };
}

export function buildAiFixLlmPromptBundle(markdown: string): string {
  // Keep it simple and deterministic: ask for exact file patches, no extra prose.
  return [
    'You are a senior test automation engineer.',
    'Given the context below, generate updated contents for the files that need changes.',
    '',
    'Rules:',
    '- Output MUST contain ONLY these sections, in this order:',
    '  1) <FEATURE_FILE> ... </FEATURE_FILE>',
    '  2) <PAGE_LOCATORS_YAML> ... </PAGE_LOCATORS_YAML> (if a page yaml exists in the bundle)',
    '  3) <COMMON_LOCATORS_YAML> ... </COMMON_LOCATORS_YAML> (only if needed)',
    '- Keep existing step definition phrases unless strictly required.',
    '- Prefer fixing locators (selectors) over changing step text.',
    '- Use Playwright-friendly selectors. For YAML, keep the [kind, expression] tuple format.',
    '',
    'Context bundle:',
    markdown,
  ].join('\n');
}
