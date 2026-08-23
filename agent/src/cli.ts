#!/usr/bin/env node
import minimist from "minimist";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST, DEFAULT_REFERENCE_FRAMEWORK_PATH } from "./config.js";
import { runJob } from "./pipeline.js";
import { runGeneratedTests } from "./runPipeline.js";
import type { HarnessKind, RunOptions, RunOptionsForTests } from "./types.js";

function parseHarness(value: unknown): HarnessKind | undefined {
  if (value === undefined) return undefined;
  if (value === "bundled" || value === "target") return value;
  console.error(`Invalid --harness "${String(value)}". Expected "bundled" or "target".`);
  process.exit(1);
}

function parseProvider(value: unknown): "ollama" | "openai" | "openrouter" | undefined {
  if (value === undefined) return undefined;
  if (value === "ollama" || value === "openai" || value === "openrouter") return value;
  console.error(`Invalid --provider "${String(value)}". Expected "ollama", "openai", or "openrouter".`);
  process.exit(1);
}

function printUsage(): void {
  console.log(`
TestPilot — read-only AI test generation agent (Ollama)

Analyzes an already-implemented repository (read-only) and a reference test-automation
framework's conventions, then generates Playwright and/or Cucumber test artifacts for a
plain-English requirement. Generation never launches the app, opens a browser, or executes tests.

Usage (generate):
  npm run qa -- --repo <local-path-or-git-url> --requirement "<free text>" [options]

Options:
  --repo <path|url>            Local repo path, or a git URL to clone. Required.
  --requirement <text>         Plain-English testing requirement. Required.
  --branch <name>               Branch to check out / clone. Default: repo's current branch.
  --model <name>                 Ollama model to use. Default: ${DEFAULT_MODEL}
  --ollama-host <url>            Ollama host. Default: ${DEFAULT_OLLAMA_HOST}
  --provider <ollama|openai|openrouter>  Which LLM backend to use. Default: ollama
                                  openai/openrouter need an API key - see below, or connect
                                  one from the web UI's Settings page instead.
  --openai-token <key>            OpenAI API key for --provider openai. Also read from
                                  OPENAI_API_KEY if not passed.
  --openai-model <id>             OpenAI model id, e.g. gpt-4o-mini (default).
  --openrouter-token <key>        OpenRouter API key for --provider openrouter. Also read from
                                  OPENROUTER_API_KEY if not passed.
  --openrouter-model <id>         OpenRouter model id, e.g. openai/gpt-4o-mini (default).
  --reference-framework <path>   Local reference test framework to study conventions from.
                                  Default: ${DEFAULT_REFERENCE_FRAMEWORK_PATH}
  --harness <bundled|target>     Which framework runs the tests. Default: bundled
                                  bundled = this repo's own Playwright + Cucumber framework
                                            (target repo only needs to be an app at a URL)
                                  target  = the target repo's own test framework

Usage (run a previously generated job against a live URL - explicit, opt-in, separate step):
  npm run qa -- --run <job-id> --base-url <url> [--headed] [--harness <bundled|target>]

For a browser UI with GitHub sign-in instead of this CLI, run the Next.js app:
  npm run web
`);
}

function step(msg: string, status: "done" | "active" | "failed" = "done"): void {
  const marker = status === "done" ? "[✓]" : status === "active" ? "[●]" : "[!]";
  console.log(`${marker} ${msg}`);
}

async function runGenerate(argv: minimist.ParsedArgs): Promise<void> {
  const opts: RunOptions = {
    repo: argv.repo,
    requirement: argv.requirement,
    branch: argv.branch,
    model: argv.model ?? DEFAULT_MODEL,
    ollamaHost: argv["ollama-host"] ?? DEFAULT_OLLAMA_HOST,
    referenceFrameworkPath: argv["reference-framework"] ?? DEFAULT_REFERENCE_FRAMEWORK_PATH,
    harness: parseHarness(argv.harness),
    provider: parseProvider(argv.provider),
    openaiToken: argv["openai-token"] ?? process.env.OPENAI_API_KEY,
    openaiModel: argv["openai-model"],
    openrouterToken: argv["openrouter-token"] ?? process.env.OPENROUTER_API_KEY,
    openrouterModel: argv["openrouter-model"],
  };

  const { paths, job } = await runJob(
    opts,
    (event) => step(event.label, event.status),
    (line) => process.stdout.write(line)
  );

  console.log("");
  console.log("Test Generation Complete");
  console.log("");
  console.log(`Repository: ${job.repo}`);
  console.log(`Branch: ${job.branch}`);
  console.log(`Requirement: ${job.feature}`);
  console.log(`Job id: ${job.jobId}`);
  console.log("");
  console.log(`Repository analyzed: ${job.report.filesAnalyzedCount} files`);
  console.log(`Relevant files: ${job.report.relevantFilesCount}`);
  console.log(`Existing test files: ${job.report.existingTestFilesCount}`);
  console.log(`Generated test scenarios: ${job.report.scenarioCount}`);
  console.log("");
  console.log("Generated artifacts:");
  for (const a of job.generatedArtifacts) console.log(`  ✓ ${a.relativePath}`);
  console.log("");
  console.log(`Reused existing steps: ${job.report.reusedStepsCount}`);
  console.log(`New steps generated: ${job.report.newStepsCount}`);
  console.log(`Requirements covered: ${job.report.requirementsCoveredCount}/${job.report.requirementsTotalCount}`);
  console.log("");
  console.log("Application source modified: NO");
  console.log("Tests executed: NO");
  console.log("");
  console.log(`Full report: ${paths.reports}/report.md`);
  console.log("");
  console.log(`To run these tests against a live app: npm run qa -- --run ${job.jobId} --base-url <url>`);
}

async function runExecute(argv: minimist.ParsedArgs): Promise<void> {
  if (!argv["base-url"]) {
    console.error("--base-url is required with --run");
    process.exit(1);
  }
  const opts: RunOptionsForTests = {
    jobId: argv.run,
    baseUrl: argv["base-url"],
    headed: Boolean(argv.headed),
    harness: parseHarness(argv.harness),
  };

  const { result, reportPath } = await runGeneratedTests(
    opts,
    (event) => step(event.label, event.status),
    (line) => process.stdout.write(line)
  );

  console.log("");
  console.log("Test Run Complete");
  console.log("");
  console.log(`Passed: ${result.passed}`);
  console.log(`Failed: ${result.failed}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log("");
  for (const t of result.tests) {
    console.log(`  [${t.status.toUpperCase()}] ${t.title}`);
  }
  console.log("");
  console.log(`Full report: ${reportPath}`);
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    boolean: ["help", "headed"],
    string: [
      "repo",
      "requirement",
      "branch",
      "model",
      "ollama-host",
      "reference-framework",
      "run",
      "base-url",
      "harness",
      "provider",
      "openai-token",
      "openai-model",
      "openrouter-token",
      "openrouter-model",
    ],
  });

  if (argv.help) {
    printUsage();
    process.exit(0);
  }

  if (argv.run) {
    await runExecute(argv);
    // The run spawns cucumber, which launches a browser; Playwright's
    // launcher can leave handles open that keep this process alive long
    // after every result has been printed. All work is finished here, so
    // exit explicitly rather than leaving the user at a hung prompt.
    process.exit(0);
  }

  if (!argv.repo || !argv.requirement) {
    printUsage();
    process.exit(1);
  }

  await runGenerate(argv);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nTestPilot job failed:");
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
