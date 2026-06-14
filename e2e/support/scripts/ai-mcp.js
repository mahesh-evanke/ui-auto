#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════════════
 *  AI Scenario CLI — MCP server (stdio, zero-dependency)
 * ────────────────────────────────────────────────────────────────────────────
 *  Exposes the ai-cli tooling as MCP tools so GitHub Copilot CLI (or any MCP
 *  client) can call them natively:
 *    • generate_scenarios { url, prompt, notes?, model? }
 *    • fix_feature        { feature, error? }
 *    • scrape_page        { url }
 *
 *  Protocol: JSON-RPC 2.0 over stdio (newline-delimited). STDOUT carries ONLY
 *  protocol messages; all human logs from ai-cli go to STDERR (AI_MCP=1).
 *
 *  Register in GitHub Copilot CLI's MCP config, e.g. ~/.copilot/mcp-config.json:
 *    {
 *      "mcpServers": {
 *        "ai-scenario": {
 *          "command": "node",
 *          "args": ["<abs-path>/e2e/support/scripts/ai-mcp.js"]
 *        }
 *      }
 *    }
 * ════════════════════════════════════════════════════════════════════════════
 */
'use strict';

process.env.AI_MCP = '1'; // route ai-cli logs to stderr BEFORE requiring it
const fs = require('fs');
const path = require('path');
const api = require('./ai-cli');

const SERVER_INFO = { name: 'ai-scenario-cli', version: '1.0.0' };

const TOOLS = [
  {
    name: 'generate_scenarios',
    description: 'Crawl a URL and generate Cucumber .feature + .yaml test files (happy/negative/boundary/validation). Optionally guided by requirements notes (.txt/.md/.docx).',
    inputSchema: {
      type: 'object',
      required: ['url', 'prompt'],
      properties: {
        url: { type: 'string', description: 'Target page URL to analyze.' },
        prompt: { type: 'string', description: 'What to test, in plain English.' },
        notes: { type: 'array', items: { type: 'string' }, description: 'Paths to requirements files (.txt/.md/.docx).' },
        name: { type: 'string', description: 'Optional filename prefix.' },
        copilot: { type: 'string', description: 'Override the Copilot CLI command template (uses {prompt}).' },
      },
    },
  },
  {
    name: 'fix_feature',
    description: 'Replay an existing generated feature live, observe real page state, and auto-correct its steps + related .yaml locators.',
    inputSchema: {
      type: 'object',
      required: ['feature'],
      properties: {
        feature: { type: 'string', description: 'Feature file name/slug (in generated/ai) or path.' },
        error: { type: 'string', description: 'Optional description of the problem.' },
      },
    },
  },
  {
    name: 'scrape_page',
    description: 'List the interactive elements (with kind + xpath) detected on a URL.',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', description: 'URL to scrape.' } },
    },
  },
];

// ── stdio JSON-RPC plumbing ─────────────────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function result(id, res) { send({ jsonrpc: '2.0', id, result: res }); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function textContent(text) { return { content: [{ type: 'text', text }], isError: false }; }
function errContent(text) { return { content: [{ type: 'text', text }], isError: true }; }

function listFeatureFiles() {
  try { return new Set(fs.readdirSync(api.FEATURE_DIR).filter((f) => f.endsWith('.feature'))); }
  catch { return new Set(); }
}

async function callTool(name, args) {
  const cfg = api.loadConfig();
  if (args && args.model) cfg.model = args.model;

  if (name === 'generate_scenarios') {
    if (!args.url || !args.prompt) return errContent('url and prompt are required.');
    cfg.url = args.url;
    if (args.name) cfg.fileName = String(args.name);
    api.notes.length = 0;
    for (const np of args.notes || []) {
      try {
        const abs = path.isAbsolute(np) ? np : path.join(api.ROOT, np);
        api.notes.push({ name: path.basename(abs), text: await api.extractFileText(abs) });
      } catch (e) { /* skip unreadable note */ }
    }
    const before = listFeatureFiles();
    await api.generate(cfg, args.prompt);
    const after = listFeatureFiles();
    const created = [...after].filter((f) => !before.has(f));
    return textContent(
      created.length
        ? `Generated ${created.length} feature file(s) in e2e/features/generated/ai/:\n` + created.map((f) => '  - ' + f).join('\n')
        : 'Generation finished (no new files detected — see e2e/features/generated/ai/).'
    );
  }

  if (name === 'fix_feature') {
    if (!args.feature) return errContent('feature is required.');
    await api.runFix(cfg, [args.feature, args.error].filter(Boolean).join(' '));
    return textContent(`Fixed "${args.feature}" — see the updated .feature and .yaml in generated/ai/.`);
  }

  if (name === 'scrape_page') {
    if (!args.url) return errContent('url is required.');
    const s = await api.scrapePage(args.url);
    const lines = s.elements.map((e) => `[${e.kind}] "${e.name}"  ${e.xpath}`);
    return textContent(`"${s.title}" — ${s.elements.length} element(s):\n` + lines.join('\n'));
  }

  return errContent(`Unknown tool: ${name}`);
}

// ── Request dispatch ────────────────────────────────────────────────────────
async function handle(req) {
  const { id, method, params } = req;
  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'notifications/initialized':
      return; // notification, no response
    case 'tools/list':
      return result(id, { tools: TOOLS });
    case 'tools/call': {
      const nm = params && params.name;
      const args = (params && params.arguments) || {};
      try { return result(id, await callTool(nm, args)); }
      catch (e) { return result(id, errContent(`Error: ${e.message}`)); }
    }
    case 'ping':
      return result(id, {});
    default:
      if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
  }
}

// ── Read newline-delimited JSON-RPC from stdin ──────────────────────────────
let buf = '';
let pending = 0;     // in-flight tool calls
let stdinEnded = false;
const maybeExit = () => { if (stdinEnded && pending === 0) process.exit(0); };

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    pending++;
    Promise.resolve(handle(req))
      .catch((e) => { if (req && req.id !== undefined) error(req.id, -32603, e.message); })
      .finally(() => { pending--; maybeExit(); });
  }
});
// Real MCP clients keep stdin open; only exit once input ends AND work is done
// (so piped/scripted invocations finish their async tool calls first).
process.stdin.on('end', () => { stdinEnded = true; maybeExit(); });
process.stderr.write('[ai-mcp] AI Scenario MCP server ready (stdio)\n');
