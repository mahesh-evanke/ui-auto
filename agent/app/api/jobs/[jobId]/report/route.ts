import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getJob } from "../../../../../lib/jobRegistry.js";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job?.paths) {
    return NextResponse.json({ error: "Report not available yet" }, { status: 404 });
  }
  const mdPath = path.join(job.paths.reports, "report.md");
  if (!fs.existsSync(mdPath)) {
    return NextResponse.json({ error: "Report file not found" }, { status: 404 });
  }
  const content = fs.readFileSync(mdPath, "utf-8");
  return new NextResponse(content, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
