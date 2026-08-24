import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../lib/serverToken.js";
import { getModelSettingsForJob } from "../../../lib/modelSettings.js";
import { startTask } from "../../../lib/taskRegistry.js";
import { runRequirementsAnalysis } from "../../../src/analysisPipeline.js";
import { createJobWorkspace } from "../../../src/workspace/jobWorkspace.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST } from "../../../src/config.js";
import type { RequirementSourceInputs } from "../../../src/types.js";

interface AnalysisBody {
  repo?: string;
  branch?: string;
  sources?: RequirementSourceInputs;
}

/** Starts Stage 1 of the staged workflow (Requirements tab -> Analyze): resolves the repo(s), merges every requirement source given, generates requirements, runs gap analysis. */
export async function POST(req: NextRequest) {
  const token = await getGithubAccessToken(req);
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as AnalysisBody | null;
  if (!body?.repo) return NextResponse.json({ error: "repo is required" }, { status: 400 });

  const sources = body.sources ?? {};
  if (!sources.documentText?.trim() && !(sources.links?.length) && !sources.notes?.trim()) {
    return NextResponse.json({ error: "Provide at least one requirement source: a document, a link, or notes" }, { status: 400 });
  }
  if (sources.isModernization && !sources.legacyRepo?.trim()) {
    return NextResponse.json({ error: "Legacy modernization is on but no legacy repository was given" }, { status: 400 });
  }

  // Create the job workspace synchronously so the client gets a real jobId
  // back immediately (not a placeholder) - simpler than jobRegistry.ts's
  // placeholder-id re-keying, since nothing else here needs one.
  const paths = createJobWorkspace();
  const modelSettings = getModelSettingsForJob();

  const taskId = startTask("analysis", (onProgress, onLog) =>
    runRequirementsAnalysis(
      {
        repo: body.repo!,
        branch: body.branch,
        githubToken: token,
        sources,
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
      paths.jobId
    )
  );

  return NextResponse.json({ jobId: paths.jobId, taskId });
}
