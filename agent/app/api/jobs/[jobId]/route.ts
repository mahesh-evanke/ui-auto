import { NextRequest, NextResponse } from "next/server";
import { getJob } from "../../../../lib/jobRegistry.js";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({
    jobId: job.result?.jobId ?? job.jobId,
    status: job.status,
    events: job.events,
    error: job.error,
    result: job.result,
  });
}
