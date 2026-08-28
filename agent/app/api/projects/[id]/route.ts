import { NextRequest, NextResponse } from "next/server";
import { deleteProject, getProject, updateProject } from "../../../../src/workspace/projectStore.js";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(getProject(id));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}

interface UpdateProjectBody {
  name?: string;
  owner?: string;
  repo?: string;
  cloneUrl?: string;
  defaultBranch?: string;
}

/** Renames a project and/or repoints it at a different repo/branch - whichever fields are given. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as UpdateProjectBody | null;
  if (!body || Object.keys(body).length === 0) {
    return NextResponse.json({ error: "At least one field to update is required" }, { status: 400 });
  }
  try {
    return NextResponse.json(updateProject(id, body));
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
