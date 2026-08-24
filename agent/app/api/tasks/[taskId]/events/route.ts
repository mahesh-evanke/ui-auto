import type { NextRequest } from "next/server";
import { getTask } from "../../../../../lib/taskRegistry.js";
import type { ProgressEvent } from "../../../../../src/types.js";

export const dynamic = "force-dynamic";

/** SSE stream for any background task started via lib/taskRegistry.ts - shared by the Requirements analysis, re-analyze, manual-scenario build, and automation-generation actions. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) {
    return new Response("Task not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    start(controller) {
      for (const e of task.events) controller.enqueue(frame("progress", e));
      if (task.status !== "running") {
        controller.enqueue(frame(task.status, task.status === "done" ? task.result : task.error));
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
        task.emitter.off("progress", onProgress);
        task.emitter.off("log", onLog);
        task.emitter.off("done", onDone);
        task.emitter.off("failed", onFailed);
      };

      task.emitter.on("progress", onProgress);
      task.emitter.on("log", onLog);
      task.emitter.on("done", onDone);
      task.emitter.on("failed", onFailed);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
