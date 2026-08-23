import { NextRequest, NextResponse } from "next/server";
import { connectCopilot, disconnectCopilot, getModelSettingsStatus, setProvider } from "../../../../lib/modelSettings.js";

/** Connects (or reconnects) GitHub Copilot: validates the token, persists it, and switches the active provider to it. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string; model?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  try {
    await connectCopilot(body.token, body.model);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json(getModelSettingsStatus());
}

/** Disconnects Copilot and falls back to the local Ollama provider. */
export async function DELETE() {
  disconnectCopilot();
  return NextResponse.json(getModelSettingsStatus());
}

/** Toggles the active provider between "ollama" and "copilot" without discarding a stored token. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { provider?: "ollama" | "copilot" } | null;
  if (body?.provider !== "ollama" && body?.provider !== "copilot") {
    return NextResponse.json({ error: 'provider must be "ollama" or "copilot"' }, { status: 400 });
  }
  try {
    setProvider(body.provider);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json(getModelSettingsStatus());
}
