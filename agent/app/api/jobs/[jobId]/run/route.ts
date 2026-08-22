import { NextRequest, NextResponse } from "next/server";
import { startRun } from "../../../../../lib/runRegistry.js";
import { getJob } from "../../../../../lib/jobRegistry.js";

export async function POST(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const body = (await req.json().catch(() => null)) as { baseUrl?: string; headed?: boolean } | null;

  if (!body?.baseUrl) {
    return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
  }

  // The job page's URL keeps whatever id it was first given, which is the
  // "pending-..." placeholder assigned before generation finishes (see
  // lib/jobRegistry.ts) - the actual on-disk directory the Run step needs
  // is only known once generation completes, under job.result.jobId. The
  // in-memory registry maps both keys to the same record, so resolve
  // through it here rather than trusting the raw route param.
  const record = getJob(jobId);
  const resolvedJobId = record?.result?.jobId ?? jobId;

  const runId = startRun({ jobId: resolvedJobId, baseUrl: body.baseUrl, headed: Boolean(body.headed) });
  return NextResponse.json({ runId });
}
