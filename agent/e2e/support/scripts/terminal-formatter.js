/**
 * terminal-formatter.js
 * Custom Cucumber formatter — prints clear, readable test output to the terminal.
 *
 * Shows:
 *   ✔ Scenario name and status (PASSED / FAILED / SKIPPED)
 *   ✔ Each step with ✓ pass  ✗ fail  - skip
 *   ✔ Error message + trimmed stack trace for failed steps
 *   ✔ Final summary: X passed, Y failed
 *
 * Used by run.js as: --format ./e2e/support/scripts/terminal-formatter.js
 */

'use strict';

const Formatter = require('@cucumber/cucumber').Formatter;

// ANSI colour helpers ─────────────────────────────────────────────────────────
const USE_COLOR = process.stdout.isTTY !== false;
const c = {
  reset:  (s) => USE_COLOR ? `\x1b[0m${s}\x1b[0m`  : s,
  bold:   (s) => USE_COLOR ? `\x1b[1m${s}\x1b[0m`  : s,
  red:    (s) => USE_COLOR ? `\x1b[31m${s}\x1b[0m` : s,
  green:  (s) => USE_COLOR ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s) => USE_COLOR ? `\x1b[33m${s}\x1b[0m` : s,
  cyan:   (s) => USE_COLOR ? `\x1b[36m${s}\x1b[0m` : s,
  gray:   (s) => USE_COLOR ? `\x1b[90m${s}\x1b[0m` : s,
  dim:    (s) => USE_COLOR ? `\x1b[2m${s}\x1b[0m`  : s,
};

// Strip internal node / cucumber / ts-node frames from a stack trace
function trimStack(stack) {
  if (!stack) return '';
  const lines = stack.split('\n');
  const keep = lines.filter((l, i) => {
    if (i === 0) return true; // error message line
    if (l.includes('node_modules')) return false;
    if (l.includes('node:internal')) return false;
    if (l.includes('node:')) return false;
    return true;
  });
  // Always keep at least the first "at" line so the user has something to go on
  if (keep.length === 1 && lines.length > 1) {
    const firstAt = lines.find((l, i) => i > 0 && l.trim().startsWith('at '));
    if (firstAt) keep.push(firstAt);
  }
  return keep.join('\n');
}

// Wrap long text at word boundaries
function wrap(text, width, indent) {
  const words = text.split(' ');
  const rows = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) { rows.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) rows.push(line);
  return rows.join('\n' + indent);
}

class TerminalFormatter extends Formatter {
  constructor(options) {
    super(options);

    // Maps for lookup during run
    this._pickleById   = new Map();  // pickleId → pickle envelope
    this._stepById     = new Map();  // stepId   → step (text + keyword)
    this._astNodeById  = new Map();  // astNodeId → gherkin node
    this._testCaseById = new Map();  // testCaseId → { pickleId, stepMap }

    // Accumulate for summary
    this._passed  = 0;
    this._failed  = 0;
    this._skipped = 0;

    options.eventBroadcaster.on('envelope', (e) => this._onEnvelope(e));
  }

  _onEnvelope(e) {
    // ── Gherkin document — index ast nodes ──────────────────────────────────
    if (e.gherkinDocument) {
      const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.id) this._astNodeById.set(node.id, node);
        for (const v of Object.values(node)) {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(e.gherkinDocument);
      return;
    }

    // ── Pickle — index by id ─────────────────────────────────────────────────
    if (e.pickle) {
      this._pickleById.set(e.pickle.id, e.pickle);
      return;
    }

    // ── TestCase — build step map ────────────────────────────────────────────
    if (e.testCase) {
      const tc = e.testCase;
      const stepMap = new Map(); // testStepId → { text, keyword }
      for (const ts of (tc.testSteps || [])) {
        if (ts.pickleStepId) {
          const pickle = this._pickleById.get(tc.pickleId);
          if (pickle) {
            const ps = (pickle.steps || []).find(s => s.id === ts.pickleStepId);
            if (ps) {
              // Get keyword from ast node
              const astId = (ps.astNodeIds || [])[0];
              const astNode = this._astNodeById.get(astId);
              const kw = (astNode && astNode.keyword) ? astNode.keyword.trim() : '';
              stepMap.set(ts.id, { text: ps.text || '', keyword: kw });
            }
          }
        }
      }
      this._testCaseById.set(tc.id, { pickleId: tc.pickleId, stepMap });
      return;
    }

    // ── TestCaseStarted — print scenario header ──────────────────────────────
    if (e.testCaseStarted) {
      this._currentTcs = e.testCaseStarted;
      this._currentSteps = [];
      const tc = this._testCaseById.get(e.testCaseStarted.testCaseId);
      const pickle = tc ? this._pickleById.get(tc.pickleId) : null;
      const name = pickle ? pickle.name : 'Scenario';
      this.log(`\n${c.bold(c.cyan('Scenario:'))} ${c.bold(name)}\n`);
      return;
    }

    // ── TestStepFinished — print each step ───────────────────────────────────
    if (e.testStepFinished) {
      const tsf = e.testStepFinished;
      const tc  = this._testCaseById.get(this._currentTcs && this._currentTcs.testCaseId);
      const stepInfo = tc ? tc.stepMap.get(tsf.testStepId) : null;
      const stepText = stepInfo ? `${stepInfo.keyword} ${stepInfo.text}` : null;
      const status   = tsf.testStepResult && tsf.testStepResult.status;

      if (!stepText) return; // skip hook steps (Before/After)

      if (status === 'PASSED') {
        this.log(`  ${c.green('✓')} ${c.dim(stepText)}\n`);
      } else if (status === 'FAILED') {
        this.log(`  ${c.red('✗')} ${c.bold(stepText)}\n`);
        const msg = tsf.testStepResult.message || '';
        if (msg) {
          const cleaned = trimStack(msg);
          const lines = cleaned.split('\n');
          // First line: the actual error message
          this.log(`    ${c.red(c.bold(lines[0]))}\n`);
          // Remaining stack lines in dim
          for (let i = 1; i < lines.length; i++) {
            const l = lines[i].trim();
            if (l) this.log(`    ${c.gray(l)}\n`);
          }
        }
      } else if (status === 'SKIPPED' || status === 'PENDING') {
        this.log(`  ${c.yellow('-')} ${c.dim(stepText)} ${c.yellow(`(${status.toLowerCase()})`)}\n`);
      } else if (status === 'UNDEFINED') {
        this.log(`  ${c.yellow('?')} ${stepText} ${c.yellow('(no step definition)')}\n`);
      }
      return;
    }

    // ── TestCaseFinished — scenario result line ──────────────────────────────
    if (e.testCaseFinished) {
      const result = e.testCaseFinished.testCaseStartedId;
      // Determine overall status from collected steps
      // The "willBeRetried" flag tells us if this attempt is not final
      const willRetry = e.testCaseFinished.willBeRetried;
      if (!willRetry) {
        const tc = this._testCaseById.get(this._currentTcs && this._currentTcs.testCaseId);
        const pickle = tc ? this._pickleById.get(tc.pickleId) : null;
        const name = pickle ? pickle.name : 'Scenario';
        // Determine status via eventDataCollector
        const attempts = this.eventDataCollector.getTestCaseAttempts();
        const attempt = attempts.find(a =>
          a.testCaseStartedId === e.testCaseFinished.testCaseStartedId
        );
        if (attempt) {
          const worst = attempt.worstTestStepResult;
          if (worst && worst.status === 'FAILED') {
            this.log(`  ${c.red(c.bold('FAILED'))}\n`);
            this._failed++;
          } else if (worst && (worst.status === 'SKIPPED' || worst.status === 'PENDING')) {
            this.log(`  ${c.yellow('SKIPPED')}\n`);
            this._skipped++;
          } else {
            this.log(`  ${c.green(c.bold('PASSED'))}\n`);
            this._passed++;
          }
        }
      }
      return;
    }

    // ── TestRunFinished — print summary ──────────────────────────────────────
    if (e.testRunFinished) {
      const total = this._passed + this._failed + this._skipped;
      const line = '\n' + '─'.repeat(60) + '\n';
      this.log(line);
      this.log(c.bold('Test Summary\n'));

      if (this._passed)  this.log(`  ${c.green('✓')} ${c.green(c.bold(String(this._passed)))} passed\n`);
      if (this._failed)  this.log(`  ${c.red('✗')} ${c.red(c.bold(String(this._failed)))} failed\n`);
      if (this._skipped) this.log(`  ${c.yellow('-')} ${c.yellow(String(this._skipped))} skipped\n`);
      this.log(`  Total: ${total} scenario(s)\n`);

      // Reprint all failures at the very end for easy copy-paste
      if (this._failed > 0) {
        this.log(c.red(c.bold('\nFailed scenarios:\n')));
        const attempts = this.eventDataCollector.getTestCaseAttempts();
        for (const attempt of attempts) {
          const worst = attempt.worstTestStepResult;
          if (!worst || worst.status !== 'FAILED') continue;
          const pickle = this._pickleById.get(attempt.pickle.id);
          const name   = pickle ? pickle.name : 'Unknown scenario';
          this.log(`  ${c.red('✗')} ${name}\n`);
          // Find the failed step
          for (const [, sr] of Object.entries(attempt.stepResults || {})) {
            if (sr.status === 'FAILED' && sr.message) {
              const firstLine = sr.message.split('\n')[0];
              this.log(`    ${c.gray(firstLine)}\n`);
              break;
            }
          }
        }
      }

      this.log(line);
    }
  }
}

module.exports = TerminalFormatter;
module.exports.default = TerminalFormatter;
