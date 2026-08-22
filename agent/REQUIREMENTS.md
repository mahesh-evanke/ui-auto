# TestPilot — Requirements

## 1. Product Summary

TestPilot is a local AI agent that connects to a user's GitHub account, lets them pick a
repository and branch, takes a plain-English testing requirement, and generates test artifacts
(Playwright specs and/or Gherkin features + step definitions) for an **already-implemented**
feature. It is a **test generation agent, not a coding agent** — it never implements features,
fixes bugs, or modifies application source code.

Test **execution** is a separate, explicit, opt-in step the user triggers afterward by pointing at
an already-running instance of the app.

## 2. Primary User Flow

```
User
  |
  v
Sign in with GitHub
  |
  v
Load authorized repositories (public, private, org, collaborator)
  |
  v
Select repository
  |
  v
Load branches
  |
  v
Select branch
  |
  v
Enter testing requirement (plain English)
  |
  v
Clone repository + branch (read-only from this point on)
  |
  v
Analyze the codebase (framework, files, existing tests)
  |
  v
Detect the repo's existing test framework (Playwright / Playwright+Cucumber / other / none)
  |
  v
Study a reference test framework's conventions (step vocabulary, locator style)
  |
  v
Turn the requirement into structured REQ-00x requirements + acceptance criteria
  |
  v
Find relevant implementation files + existing tests already covering the requirement
  |
  v
Generate a test scenario matrix per requirement
  |
  v
For each scenario, resolve steps: reuse an existing step definition when one already
matches (from the reference framework or the repo's own tests), else generate a new one
  |
  v
Generate test files (.spec.ts and/or .feature)
  |
  v
Write a coverage matrix + test generation report
  |
  v
User reviews the generated files and report
  |
  v
(Optional, separate step) User provides the URL of an already-running instance of the
app and runs the generated tests against it
  |
  v
DONE
```

There is no automatic execution during generation. The agent never starts the application and
never opens a browser on its own.

## 3. GitHub Integration

- Sign-in via GitHub OAuth (no pasted personal access tokens, no pasted repo URLs).
- After sign-in, the user browses repositories they're authorized to access: owned, private,
organization, and collaborator repos.
- Repository list supports search and filter by owner, visibility (public/private), and language,
and sort by recently-updated or alphabetical.
- Once a repository is selected, its branches are loaded and the user picks one.
- The GitHub access token is used only server-side to list repos/branches and to clone the
selected repository/branch; it is never sent to the browser.



## 4. Requirement Input

The user provides the testing requirement as free-form plain English — a feature description,
business rule, or acceptance criteria. Example:

```
Add a Save button to the profile page. It should save the user's changes, show a loading
state, and show a success message after saving.
```



## 5. Repository Handling — Read-Only

The cloned repository is treated as strictly read-only for the entire generation pipeline:

- The agent may read: source files, components, pages, routes, services, APIs, configuration,
existing tests, existing step definitions, existing locators/page objects.
- The agent may never write to, modify, or delete anything inside the cloned repository during
generation.
- All generated artifacts are written to a separate output directory
(`agent-workspace/<job-id>/generated-tests/`), a sibling of the read-only clone — never nested
inside it.
- This is enforced in code (not just by prompting): every generated-file write is checked against
an allow-listed output directory before it's permitted.



## 6. Codebase Understanding

Before generating anything, the agent builds an understanding of the repository:

- Repository map: framework, language, package manager, file tree.
- Which existing test framework the repo already uses (Playwright only, Playwright + Cucumber,
another framework, or none), and where its existing spec files, feature files, step
definitions, and locator files live.
- Existing tests that may already cover part of the requirement (coverage-gap awareness).
- The files most relevant to the requirement (routes, components, services), found via targeted
keyword/filename search rather than sending the whole repository to the model.



## 7. Reference Test Framework

A local reference test-automation framework is studied (path configurable, defaults to a known
local framework) purely to learn testing conventions:

- Its existing step-definition text (the literal `Given`/`When`/`Then` phrases already
registered) — extracted deterministically, not guessed by the model.
- Its locator file conventions (naming, structure).

This reference framework is also treated as strictly read-only.

## 8. Requirement Analysis

The free-text requirement is converted into structured requirements, each with:

- A unique id (`REQ-001`, `REQ-002`, ...)
- A description
- Priority
- Acceptance criteria
- Related UI elements



## 9. Test Scenario Generation

For each requirement, a scenario matrix is generated, drawing from the relevant categories:
happy path, validation, boundary cases, empty/loading/error states, user interaction, API
behavior, navigation, and regression — only the categories that genuinely apply, not a fixed
checklist applied blindly.

## 10. Step Reuse

For every scenario, before writing any new test code, the agent checks whether an equivalent
step already exists — in the reference framework's step vocabulary or in the target repository's
own existing step definitions:

- If an equivalent step exists, it is reused verbatim (with its literal values filled in).
- If not, a new step is generated, scoped narrowly (a small batch per generation call) and written
as a **new, standalone file** — existing step-definition files are never edited.



## 11. Generated Artifacts

Depending on the detected test framework:

- **Playwright + Cucumber repos**: a `.feature` file (Gherkin) plus a new step-definitions file for
any steps that had no reusable match.
- **Playwright-only repos** (or repos with no existing test framework): a single `.spec.ts` file.

All artifacts are written under `agent-workspace/<job-id>/generated-tests/`.

## 12. Test Generation Report

After generation, the agent produces:

- A requirement → scenario → artifact coverage matrix.
- Counts: files analyzed, relevant files found, existing tests found, scenarios generated,
reused steps, new steps, requirements covered.
- An explicit statement: **Application source modified: NO**, **Tests executed: NO**.
- Assumptions made and any known gaps (e.g. reused steps that came from the reference framework
rather than the target repo's own tests, which may need a matching step definition there to
actually run).



## 13. Running the Generated Tests (explicit, opt-in, separate step)

After a generation job completes, the user may optionally trigger a **Run** step against an
already-running instance of the application, by providing its URL:

- This is the only point at which TestPilot executes anything or installs dependencies into the
target repository (it installs `@playwright/test` or `@cucumber/cucumber` there only if
missing, since running requires them).
- For Playwright-only jobs: the generated spec is executed with a Playwright config whose
`baseURL` is the provided URL.
- For Playwright+Cucumber jobs: cucumber is run using the target repo's own existing
step-definition files (which already provide browser/World setup) together with the generated
feature and step-definitions files — nothing is copied into the target repo permanently, and any
temporary files created to make execution possible are cleaned up afterward.
- Results (pass/fail per scenario) are shown to the user; this does not modify the generated test
files or the application source.



## 14. Local-Only, Local LLM

- Everything runs on the user's own machine.
- The LLM is a local [Ollama](https://ollama.com) model (default `llama3.2`), never a hosted API.
- The model is used only for narrowly-scoped generative steps (structuring the requirement,
breaking a scenario into step intents, writing a handful of new step definitions/spec code).
Framework detection, reference-framework analysis, and step-reuse matching are deterministic,
not LLM-based.



## 15. Interfaces

- **CLI**: `npm run qa -- --repo <path|url> --requirement "<text>"` to generate;
`npm run qa -- --run <job-id> --base-url <url>` to run a previously generated job.
- **Web UI** (Next.js): GitHub sign-in → repository browser → branch selector → requirement editor
→ live generation progress → generated artifacts, coverage matrix, and report → optional
"Run Tests" panel with live progress and pass/fail results.

