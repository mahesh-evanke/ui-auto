import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../lib/serverToken.js";
import { startJob } from "../../../lib/jobRegistry.js";
import { getModelSettingsForJob } from "../../../lib/modelSettings.js";
import { DEFAULT_MODEL, DEFAULT_OLLAMA_HOST, DEFAULT_REFERENCE_FRAMEWORK_PATH } from "../../../src/config.js";
import type { RunOptions } from "../../../src/types.js";

export async function POST(req: NextRequest) {
  const token = await getGithubAccessToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { cloneUrl?: string; branch?: string; requirement?: string }
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
    copilotToken: modelSettings.copilotToken,
    copilotModel: modelSettings.copilotModel,
  };

  const jobId = startJob(opts);
  return NextResponse.json({ jobId });
}
