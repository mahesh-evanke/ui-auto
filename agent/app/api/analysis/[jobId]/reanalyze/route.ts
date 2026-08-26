import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../../../lib/serverToken.js";
import { getModelSettingsForJob } from "../../../../../lib/modelSettings.js";
import { startTask } from "../../../../../lib/taskRegistry.js";
import { runRequirementsAnalysis, loadAnalysisInputs } from "../../../../../src/analysisPipeline.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST } from "../../../../../src/config.js";
import type { RequirementSourceInputs } from "../../../../../src/types.js";

/** Re-runs Stage 1 for an existing job with updated sources (typically the same sources plus more notes) - reuses the already-resolved repo, no re-clone. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  // Optional, same rationale as POST /api/analysis - a token is only needed
  // for private-repo cloning, not for public repos or local paths.
  const token = await getGithubAccessToken(req);

  const body = (await req.json().catch(() => null)) as { sources?: RequirementSourceInputs } | null;
  if (!body?.sources) return NextResponse.json({ error: "sources is required" }, { status: 400 });

  let priorInputs;
  try {
    priorInputs = loadAnalysisInputs(jobId);
  } catch {
    return NextResponse.json({ error: `No prior analysis found for job ${jobId}` }, { status: 404 });
  }

  const modelSettings = getModelSettingsForJob();

  const taskId = startTask("reanalysis", (onProgress, onLog) =>
    runRequirementsAnalysis(
      {
        repo: priorInputs.repo,
        branch: priorInputs.branch,
        githubToken: token ?? undefined,
        sources: body.sources!,
        provider: modelSettings.provider,
        model: process.env.TESTPILOT_MODEL ?? DEFAULT_MODEL,
        ollamaHost: process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
        openaiToken: modelSettings.openaiToken,
        openaiModel: modelSettings.openaiModel,
        openrouterToken: modelSettings.openrouterToken,
        openrouterModel: modelSettings.openrouterModel,
      },
      onProgress,
      onLog,
      jobId
    )
  );

  return NextResponse.json({ taskId });
}
