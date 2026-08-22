import type { NextRequest } from "next/server";
import { getRun } from "../../../../../../../lib/runRegistry.js";
import type { ProgressEvent } from "../../../../../../../src/types.js";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string; runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return new Response("Run not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    start(controller) {
      for (const e of run.events) controller.enqueue(frame("progress", e));
      if (run.status !== "running") {
        controller.enqueue(frame(run.status, run.status === "done" ? run.result : run.error));
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
        run.emitter.off("progress", onProgress);
        run.emitter.off("log", onLog);
        run.emitter.off("done", onDone);
        run.emitter.off("failed", onFailed);
      };

      run.emitter.on("progress", onProgress);
      run.emitter.on("log", onLog);
      run.emitter.on("done", onDone);
      run.emitter.on("failed", onFailed);
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
