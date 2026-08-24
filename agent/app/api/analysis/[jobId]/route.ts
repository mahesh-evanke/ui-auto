import { NextResponse } from "next/server";
import { loadAnalysisResult, loadAnalysisInputs } from "../../../../src/analysisPipeline.js";

/** Persisted analysis-result.json for a job - used on page reload/direct navigation; live progress comes from the task's SSE stream instead. */
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  try {
    const result = loadAnalysisResult(jobId);
    const inputs = loadAnalysisInputs(jobId);
    return NextResponse.json({ jobId, result, repo: inputs.repo, branch: inputs.branch, sources: inputs.sources });
  } catch {
    return NextResponse.json({ error: "Analysis not found or not finished yet" }, { status: 404 });
  }
}
