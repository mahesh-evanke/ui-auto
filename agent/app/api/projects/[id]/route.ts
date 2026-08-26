import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, renameProject } from "../../../../src/workspace/projectStore.js";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(getProject(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}

/** Renames a project. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(renameProject(id, body.name));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** Removes the project record only - it never touches the underlying job/analysis data on disk (see deleteProject's doc comment). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
