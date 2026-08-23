import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../lib/serverToken.js";
import { startJob } from "../../../lib/jobRegistry.js";
import { getModelSettingsForJob } from "../../../lib/modelSettings.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST, DEFAULT_REFERENCE_FRAMEWORK_PATH } from "../../../src/config.js";
import type { OutputFormat, RunOptions, TestScope } from "../../../src/types.js";

function isOutputFormat(v: unknown): v is OutputFormat {
  return v === "gherkin" || v === "spec" || v === "both";
}
function isTestScope(v: unknown): v is TestScope {
  return v === "web" || v === "api" || v === "both";
}

export async function POST(req: NextRequest) {
  const token = await getGithubAccessToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { cloneUrl?: string; branch?: string; requirement?: string; outputFormat?: string; testScope?: string }
    | null;

  if (!body?.cloneUrl || !body?.requirement) {
    return NextResponse.json({ error: "cloneUrl and requirement are required" }, { status: 400 });
  }

  const modelSettings = getModelSettingsForJob();

  const opts: RunOptions = {
    repo: body.cloneUrl,
    requirement: body.requirement,
    branch: body.branch,
    model: process.env.TESTPILOT_MODEL ?? DEFAULT_MODEL,
    ollamaHost: process.env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
    referenceFrameworkPath: process.env.TESTPILOT_REFERENCE_FRAMEWORK_PATH ?? DEFAULT_REFERENCE_FRAMEWORK_PATH,
    githubToken: token,
    provider: modelSettings.provider,
    openaiToken: modelSettings.openaiToken,
    openaiModel: modelSettings.openaiModel,
    openrouterToken: modelSettings.openrouterToken,
    openrouterModel: modelSettings.openrouterModel,
    outputFormat: isOutputFormat(body.outputFormat) ? body.outputFormat : undefined,
    testScope: isTestScope(body.testScope) ? body.testScope : undefined,
  };

  const jobId = startJob(opts);
  return NextResponse.json({ jobId });
}
