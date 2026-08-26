import { NextRequest, NextResponse } from "next/server";
import { PROMPT_DEFS, resetPrompt, savePrompt } from "../../../../src/promptStore.js";

/** Overwrites one prompt's on-disk override with the given content - takes effect on the very next agent run. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PROMPT_DEFS.some((d) => d.id === id)) {
    return NextResponse.json({ error: `Unknown prompt id: ${id}` }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { content?: string } | null;
  if (typeof body?.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  savePrompt(id, body.content);
  return NextResponse.json({ id, content: body.content });
}

/** Restores one prompt to its shipped default, discarding any edit. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PROMPT_DEFS.some((d) => d.id === id)) {
    return NextResponse.json({ error: `Unknown prompt id: ${id}` }, { status: 404 });
  }
  const content = resetPrompt(id);
  return NextResponse.json({ id, content });
}
