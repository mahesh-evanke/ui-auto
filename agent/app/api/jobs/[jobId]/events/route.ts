import type { NextRequest } from "next/server";
import { getJob } from "../../../../../lib/jobRegistry.js";
import type { ProgressEvent } from "../../../../../src/types.js";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    start(controller) {
      // Replay what already happened before this client connected.
      for (const e of job.events) controller.enqueue(frame("progress", e));
      if (job.status !== "running") {
        controller.enqueue(frame(job.status, job.status === "done" ? job.result : job.error));
        controller.close();
        return;
      }

      const onProgress = (e: ProgressEvent) => controller.enqueue(frame("progress", e));
      const onLog = (line: string) => controller.enqueue(frame("log", line));
      const onDone = (result: unknown) => {
        controller.enqueue(frame("done", result));
        cleanup();
        controller.close();
      };
      const onFailed = (error: unknown) => {
        controller.enqueue(frame("failed", error));
        cleanup();
        controller.close();
      };

      const cleanup = () => {
        job.emitter.off("progress", onProgress);
        job.emitter.off("log", onLog);
        job.emitter.off("done", onDone);
        job.emitter.off("failed", onFailed);
      };

      job.emitter.on("progress", onProgress);
      job.emitter.on("log", onLog);
      job.emitter.on("done", onDone);
      job.emitter.on("failed", onFailed);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
