import { NextRequest, NextResponse } from "next/server";
import { getModelSettingsForJob } from "../../../../../lib/modelSettings.js";
import { startTask } from "../../../../../lib/taskRegistry.js";
import { buildManualScenarios, loadManualScenarios } from "../../../../../src/scenarioPipeline.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST } from "../../../../../src/config.js";
import type { TestScope } from "../../../../../src/types.js";

/** Stage 2a (Manual sub-tab): builds/regenerates the reviewable scenario list from an already-analyzed job. `notes` is the "regenerate with more detail" input. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as { notes?: string; testScope?: TestScope } | null;
  const modelSettings = getModelSettingsForJob();

  const taskId = startTask("scenarios", (onProgress) =>
    buildManualScenarios(
      jobId,
      {
        notes: body?.notes,
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

/** Persisted manual-scenarios.json - used on page reload; live progress comes from the task's SSE stream instead. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    return NextResponse.json({ testPlan: loadManualScenarios(jobId) });
  } catch {
    return NextResponse.json({ error: "Manual scenarios not built yet" }, { status: 404 });
  }
}
