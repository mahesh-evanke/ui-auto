import { NextRequest, NextResponse } from "next/server";
import { getModelSettingsStatus, setProvider } from "../../../lib/modelSettings.js";

export async function GET() {
  return NextResponse.json(getModelSettingsStatus());
}

/** Switches the active provider without discarding any connected key, so toggling back later doesn't require reconnecting. */
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { provider?: "ollama" | "openai" | "openrouter" } | null;
  if (body?.provider !== "ollama" && body?.provider !== "openai" && body?.provider !== "openrouter") {
    return NextResponse.json({ error: 'provider must be "ollama", "openai", or "openrouter"' }, { status: 400 });
  }
  try {
    setProvider(body.provider);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json(getModelSettingsStatus());
}
