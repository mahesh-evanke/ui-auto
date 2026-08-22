# TestPilot Agent (bundled with this framework)

A local AI agent that turns a plain-English testing requirement into runnable
Gherkin, **reusing the step definitions this repository already ships**, and
then executes them against a running application URL.

The key difference from running TestPilot standalone: here the agent and the
test framework live in the same repository, so the framework is both

- the **step vocabulary** the generated tests are written in
  (`e2e/stepdefinitions/` — 76 UI steps + 4 API steps), and
- the **harness** that actually runs them.

A target repository therefore only has to be an application reachable at a
URL. It does **not** need Playwright, Cucumber, or any tests of its own.

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

```bash
# 1. the framework (repo root) — provides the step definitions AND the harness
npm install

# 2. the agent
cd agent
npm install
```

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
| `--headed` | show the browser during the run |
| `--branch <name>` | branch to clone/check out |
| `--model <name>` | Ollama model (default `llama3.2`) |

## Web UI

```bash
cd agent
npm run web
```

GitHub sign-in → pick a repository and branch → enter the requirement → watch
generation progress → review artifacts and the coverage report → optionally
run against a URL.

## Step reuse

Reuse is what makes the generated tests runnable. Two mechanisms work
together:

1. **Catalog-constrained planning** — before writing any step text, the model
   is shown the framework steps most relevant to the scenario and told to copy
   them verbatim, substituting real values for `{string}` / `{int}`.
2. **Shape matching** — a step the model wrote is normalized (quoted values and
   placeholders collapse to a common marker) and compared against the real
   templates, so `User clicks on "Save" button` is recognized as
   `User clicks on {string} button`.

Anything with no match becomes a newly generated step definition written to a
**new** file — existing step-definition files are never edited.

## Run-time behavior worth knowing

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
