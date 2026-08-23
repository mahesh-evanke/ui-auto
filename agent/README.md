# TestPilot Agent (bundled with this framework)

A local AI agent that turns a plain-English testing requirement into runnable
Gherkin, **reusing the step definitions this repository already ships**, and
then executes them against a running application URL.

The key difference from running TestPilot standalone: this agent carries its
own copy of the step definitions - `agent/e2e/` - so it's self-contained. A
copy of just the `agent/` folder is runnable on its own; nobody using it
needs to know or care that the framework's own `e2e/` lives one level up.
`agent/e2e/` is both

- the **step vocabulary** the generated tests are written in
  (`stepdefinitions/` — 76 UI steps + 4 API steps), and
- the **harness** that actually runs them (its own `cucumber.cjs`).

A target repository therefore only has to be an application reachable at a
URL. It does **not** need Playwright, Cucumber, or any tests of its own.

`agent/e2e/` is a synced copy, not a fork: the framework repo's own `e2e/`
(one level up) stays the single place to actually edit step definitions.
After changing anything there, resync:

```bash
cd agent
npm run sync-framework
```

This overwrites `agent/e2e/` and `agent/cucumber.cjs` from the framework
root and re-commits cleanly as a normal file change - there's no ongoing
process to keep running, just re-run it after editing step definitions.

---

## How it works

```
Requirement (plain English)  +  Target repo (read-only)
        |
        v
  Analyze repo  ->  find relevant source files
        |
        v
  Read this repo's step definitions  ->  step catalog (80 steps)
        |
        v
  LLM plans scenarios, PICKING FROM the catalog
        |
        v
  .feature written to agent-workspace/<job-id>/generated-tests/
        |
        v  (separate, explicit step — you supply the URL)
  Run with THIS repo's Cucumber + step definitions against that URL
```

The target repository is strictly read-only during generation; every
generated file is written to `agent/agent-workspace/<job-id>/`, never into the
target repo or into `e2e/`.

## Setup

Both packages install separately — the framework is CommonJS + Cucumber, the
agent is ESM + Next.js, so they intentionally keep their own `package.json`.
Cucumber, Playwright, and ts-node are also installed directly in
`agent/package.json` (not just at the repo root), since `agent/e2e/` runs on
`agent/`'s own `node_modules` — that's what makes it self-contained.

```bash
# 1. the framework (repo root) — its e2e/ is the source of truth agent/e2e/ is synced from
npm install

# 2. the agent — installs its own copy of cucumber/playwright/ts-node too
cd agent
npm install
```

Playwright's browsers are cached globally per version
(`~/.cache/ms-playwright` / `%LOCALAPPDATA%\ms-playwright`), so installing
the agent's own `playwright` package does not re-download them if the
framework's `npm install` already did, as long as the versions match.

You also need [Ollama](https://ollama.com) running locally:

```bash
ollama serve
ollama pull llama3.2
```

For the web UI only, copy `.env.local.example` to `.env.local` and fill in
GitHub OAuth credentials. The CLI needs no `.env` at all — it defaults to the
bundled framework automatically.

## CLI

Generate tests for a requirement:

```bash
cd agent
npm run qa -- --repo <local-path-or-git-url> --requirement "Add a Save button to the profile page. It should save the user's changes and show a success message after saving."
```

Then run them against an already-running app:

```bash
npm run qa -- --run <job-id> --base-url http://localhost:4173
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--harness bundled` | *(default)* run with this repo's framework — target needs no tests of its own |
| `--harness target` | run with the target repo's own Playwright/Cucumber setup instead |
| `--output-format gherkin\|spec\|both` | which artifact(s) to generate. Default: auto (matches the harness) |
| `--test-scope web\|api\|both` | what the scenarios cover. Default: `both` |
| `--no-headed` | run headless instead of the default visible browser window |
| `--browser chromium\|chrome\|edge\|firefox` | run step only; `firefox` falls back to Chromium (see below) |
| `--device "<name>"` | run step only; a Playwright device name, e.g. `"iPhone 12 Pro"` — unset = desktop |
| `--branch <name>` | branch to clone/check out |
| `--model <name>` | Ollama model (default `llama3.2`) |

### Output format

`--output-format` controls which artifact(s) get written for the same generated scenarios:

- `gherkin` — a `.feature` file, run by the bundled Cucumber harness
- `spec` — a Playwright `.spec.ts` file
- `both` — both files, from the same test plan

### Test scope

`--test-scope` controls what the generated scenarios describe and which step definitions the model is even shown:

- `web` — UI only. The step catalog offered to the model is filtered down to `kind: "ui"` steps, so an API step can't be picked even if the model tries.
- `api` — API only. Same filtering, restricted to `kind: "api"` steps (status codes, response fields).
- `both` *(default)* — the planner is explicitly instructed to describe the real navigation sequence: a UI action that would trigger a backend call, followed immediately by the step asserting that call's result, then the UI continuing (e.g. filling a login form → clicking Login → asserting the login request's status → landing on the next screen). Steps interleave `ui`/`api` within one scenario rather than splitting them into separate web and API scenarios.

### Browser and device

`--browser` and `--device` only apply to the bundled harness's run step (`e2e/stepdefinitions/hooks.ts` reading `PW_CHANNEL`/`VIEWPORT_DEVICE`). Worth knowing:

- `chromium` (default), `chrome`, and `edge` all genuinely work — Playwright launches Chromium with the matching channel.
- `firefox` is listed in `e2e/config/config.yaml`'s own comment as a supported value, but `hooks.ts` only ever calls `chromium.launch(...)` — there's no `firefox.launch()` branch. Selecting it logs a clear note and runs on Chromium instead of silently pretending or crashing. Real Firefox support would need that hook rewritten, which is a framework change outside this agent's scope.
- `--device` accepts any [Playwright device name](https://playwright.dev/docs/emulation#devices) — the web UI's dropdown lists the same set `config.yaml` documents (iPhone SE/XR/12 Pro/14 Pro Max, Pixel 7, Galaxy S8+/S20 Ultra, iPad Mini/Air/Pro, Surface Pro 7/Duo, Galaxy Z Fold 5, Zenbook Fold, Galaxy A51/71, Nest Hub/Max). Leave unset for a full desktop window.

## Web UI

```bash
cd agent
npm run web
```

GitHub sign-in → pick a repository and branch → enter the requirement → watch
generation progress → review artifacts and the coverage report → optionally
run against a URL.

## Model provider (Ollama, OpenAI, or OpenRouter)

By default every job runs on local Ollama. From **Settings** you can also
connect **OpenAI** or **OpenRouter** and switch to either instead - useful
when the local model's small size is producing weak scenarios/steps and you
want a stronger cloud model without changing anything else about the
pipeline.

There is no working third-party API for GitHub Copilot Chat itself - it's
private to GitHub's own official clients - and GitHub Models, which used to
be the closest public equivalent, was fully retired by GitHub in July 2026.
OpenAI and OpenRouter are plain, currently-live, key-authenticated APIs
instead: OpenAI is OpenAI's own models directly; OpenRouter is a single key
that routes to many providers' models, including some free ones.

- Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
  or [openrouter.ai/keys](https://openrouter.ai/keys).
- The key is validated against the provider's real API (a cheap auth check,
  not an inference call) before being saved, so a bad key is rejected
  immediately rather than failing later mid-job.
- Stored server-side only, in `agent-workspace/.model-settings.json` (already
  gitignored, written with `0o600` permissions) - never sent to the browser,
  never logged. `GET /api/settings` only ever reports whether a key is
  connected, not its value.
- Switching back to Local Ollama does not discard a connected key for the
  other providers - toggle back later without reconnecting. Disconnect
  clears a specific provider's key for good.
- The CLI has the same capability: `--provider openai --openai-token <key>`
  (or set `OPENAI_API_KEY`), or `--provider openrouter --openrouter-token <key>`
  (or set `OPENROUTER_API_KEY`), plus `--openai-model`/`--openrouter-model`.

## Step reuse — existing step definitions only

Under the bundled harness the generator uses **only step definitions that
already exist** in `e2e/stepdefinitions/` (UI, API and DB alike — the whole
directory is scanned recursively, so steps you add later are picked up with no
configuration). It never invents a new step definition file.

Three mechanisms make that work:

1. **Catalog-constrained planning** — before writing any step text, the model
   is shown the framework steps most relevant to the scenario and told to copy
   them verbatim, substituting real values for `{string}` / `{int}`.
2. **Shape matching** — a step the model wrote is normalized (quoted values and
   placeholders collapse to a common marker) and compared against the real
   templates, so `User clicks on "Save" button` is recognized as
   `User clicks on {string} button`.
3. **Unsupported steps are dropped, not invented** — anything with no match is
   removed and listed under *Potential Gaps* in the report, telling you exactly
   which step definitions you'd need to add to cover that behavior. A scenario
   left with no steps is dropped too, rather than written out as invalid
   Gherkin.

Steps whose handler takes a Cucumber **DataTable** (e.g.
`User inputs information on {string} screen with following params`,
`verify {string} web table contains`) are excluded from the vocabulary — the
generator has no way to invent a meaningful table, and calling such a step
without one fails at runtime. On this framework that removes 20 of 80 steps,
leaving 60 usable.

With `--harness target` the old behavior returns: new step definitions are
generated for unmatched steps, into a new file (existing files are never
edited).

## Running a generated feature yourself

The agent's Run step is optional. A generated `.feature` uses only step
definitions this framework already implements, so you can run it directly with
the framework's own runner — set the URL first, since the model's guessed URL
is only rewritten automatically by the Run step:

```bash
# from the repo root
cp agent/agent-workspace/<job-id>/generated-tests/cucumber/<name>.feature e2e/features/generated/web/
# edit the `User navigates to "..." URL` step to point at your running app, then:
npx cucumber-js e2e/features/generated/web/<name>.feature
```

## Run-time behavior worth knowing

- A visible browser window opens by default so you can watch the run (both
  CLI and web UI). Pass `--no-headed` on the CLI, or uncheck "Headed" in the
  web UI, to run headless instead.
- The generated `.feature` contains whatever URL the model guessed. At run
  time the `User navigates to "<url>" URL` step is rewritten to the
  `--base-url` you supply, so the guessed value doesn't matter.
- The run uses tighter timeouts than `e2e/config/config.yaml` (which is tuned
  for watching a human demo: `slowMo: 1000`, `verifyTimeoutMs: 200000`).
  Anything you set explicitly in your own environment still wins.
- The feature is copied into a throwaway `.testpilot-run/` directory inside
  the repo for execution and removed afterward; the canonical artifact under
  `agent-workspace/` is never modified.
- Video recording is forced off for agent runs. Besides filling
  `reports/recorded/`, finalizing the video keeps child process handles open,
  which previously left the CLI hanging after the results had already printed.
- A `User is on "X" screen` step for a page that isn't registered makes the
  **framework** write a placeholder `e2e/locators/pages/X.yaml`. That is the
  framework's own long-standing behavior, not the agent writing to the repo —
  but it does mean running generated tests can leave new placeholder locator
  files behind for you to fill in or delete.

## Caveats

- Generation quality depends on the local model. `llama3.2` is small and will
  sometimes produce scenarios whose logic is wrong (e.g. an API assertion with
  no preceding request step). Generated tests are a starting point to review,
  not something to trust unread.
- Scenarios the planner produced no usable steps for are dropped rather than
  written out as empty, invalid Gherkin.
