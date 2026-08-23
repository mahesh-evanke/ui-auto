import { NextRequest, NextResponse } from "next/server";
import { connectOpenAi, disconnect, getModelSettingsStatus } from "../../../../lib/modelSettings.js";

/** Connects (or reconnects) OpenAI: validates the key, persists it, and switches the active provider to it. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string; model?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  try {
    await connectOpenAi(body.token, body.model);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json(getModelSettingsStatus());
}

/** Disconnects OpenAI. Falls back to local Ollama if it was the active provider. */
export async function DELETE() {
  disconnect("openai");
  return NextResponse.json(getModelSettingsStatus());
}
