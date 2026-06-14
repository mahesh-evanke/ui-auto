# Using the AI Scenario CLI inside GitHub Copilot CLI

There are two ways to drive this tool from GitHub Copilot CLI.

---

## Option A — One-shot command (simplest)

Copilot CLI can run shell commands. Ask it to run the tool non-interactively:

```bash
# generate scenarios
node "e2e/support/scripts/ai-cli.js" --url https://example.com/login --prompt "test the login form thoroughly" --notes e2e/notes/ssa-eligibility-quiz.docx

# fix a generated feature (replays it live, then corrects feature + yaml)
node "e2e/support/scripts/ai-cli.js" --fix 18_re-submit-after-failed-attempt --error "Dashboard text never appears"
```

Flags: `--url --prompt --notes (repeatable) --fix --error --name --copilot`.
No `--prompt`/`--fix` → it falls back to the interactive REPL.

> The LLM backend IS the Copilot CLI — there are no API keys. Set the command it
> shells out to with `--copilot "copilot -p {prompt}"` (or `/copilot` in the REPL),
> and verify it with the REPL command `/testllm`.

In Copilot CLI you can simply say:
> "Run `node e2e/support/scripts/ai-cli.js --url <url> --prompt "<what to test>"` and show me the generated files."

---

## Option B — Native MCP tools (recommended)

Register the bundled MCP server so Copilot CLI can call the tools directly:
`generate_scenarios`, `fix_feature`, `scrape_page`.

### 1. Add the server to Copilot CLI's MCP config

Edit `~/.copilot/mcp-config.json` (create it if missing):

```json
{
  "mcpServers": {
    "ai-scenario": {
      "type": "local",
      "command": "node",
      "args": [
        "C:/Users/Surya/OneDrive - Evanke/Documents/projects/playwright/playwright-cucumber-framework/e2e/support/scripts/ai-mcp.js"
      ],
      "tools": ["*"]
    }
  }
}
```

(You can also add it from inside the Copilot CLI with its `/mcp` command and point it at the same `node ai-mcp.js` command.)

### 2. Restart Copilot CLI, then just ask in natural language

> "Use the ai-scenario tool to generate login tests for https://example.com/login"
> "Fix the feature 18_re-submit-after-failed-attempt — the Dashboard assertion is wrong"
> "Scrape https://example.com/login and list the elements"

Copilot CLI will call `generate_scenarios` / `fix_feature` / `scrape_page`. Generated
`.feature` + `.yaml` files land in `e2e/features/generated/ai/` and
`e2e/locators/generated/ai/`.

### Run the generated tests
```bash
npm run test:ai                      # all AI features
npm run test:ai <feature-name>       # just one
```

---

## Backend / no credentials

The LLM backend is the **GitHub Copilot CLI** — ai-cli.js makes no direct HTTP/API
calls and stores no API keys. `e2e/config/llm.json` (gitignored) only holds the
Copilot command template and the last URL:

```json
{ "copilot": "copilot -p {prompt} --allow-all-tools", "url": "" }
```

`{prompt}` is replaced with the prompt as a single argument; omit it to pipe the
prompt via stdin. Adjust the template to whatever your Copilot CLI accepts and
verify with `/testllm` (REPL) before generating. On Windows, if `copilot` is a
`.cmd` shim and won't launch, set e.g. `/copilot cmd /c copilot -p {prompt}`.
