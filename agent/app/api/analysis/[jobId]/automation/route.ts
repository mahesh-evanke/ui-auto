import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getModelSettingsForJob } from "../../../../../lib/modelSettings.js";
import { startTask } from "../../../../../lib/taskRegistry.js";
import { generateAutomationFromScenarios, loadManualScenarios } from "../../../../../src/scenarioPipeline.js";
import { getJobPaths } from "../../../../../src/workspace/jobWorkspace.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST } from "../../../../../src/config.js";
import type { OutputFormat, TestPlan, TestScope } from "../../../../../src/types.js";

/**
 * Stage 2b (Automated sub-tab): generates Gherkin/spec artifacts from the
 * approved scenario list. Body may include an edited `testPlan` (the user
 * reviewed/tweaked scenario text in Manual before approving) - falls back to
 * the persisted manual-scenarios.json if omitted.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as
    | { testPlan?: TestPlan; outputFormat?: OutputFormat; testScope?: TestScope }
    | null;

  let testPlan: TestPlan;
  try {
    testPlan = body?.testPlan ?? loadManualScenarios(jobId);
  } catch {
    return NextResponse.json({ error: "No manual scenarios found - build and approve them first" }, { status: 404 });
  }

  const modelSettings = getModelSettingsForJob();

  const taskId = startTask("automation", (onProgress) =>
    generateAutomationFromScenarios(
      jobId,
      testPlan,
      {
        outputFormat: body?.outputFormat,
        testScope: body?.testScope,
        provider: modelSettings.provider,
        model: process.env.TESTPILOT_MODEL ?? DEFAULT_MODEL,
        ollamaHost: process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
        openaiToken: modelSettings.openaiToken,
        openaiModel: modelSettings.openaiModel,
        openrouterToken: modelSettings.openrouterToken,
        openrouterModel: modelSettings.openrouterModel,
      },
      onProgress
    )
  );

  return NextResponse.json({ taskId });
}

/** Persisted report.json (artifacts + coverage) from the last automation generation - used on page reload. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const paths = getJobPaths(jobId);
    const reportPath = paths.reports + "/report.json";
    if (!fs.existsSync(reportPath)) throw new Error("not found");
    return NextResponse.json({ report: JSON.parse(fs.readFileSync(reportPath, "utf-8")) });
  } catch {
    return NextResponse.json({ error: "Automation not generated yet" }, { status: 404 });
  }
}
