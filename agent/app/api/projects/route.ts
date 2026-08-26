import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "../../../src/workspace/projectStore.js";

export async function GET() {
  return NextResponse.json({ projects: listProjects() });
}

interface CreateProjectBody {
  name?: string;
  owner?: string;
  repo?: string;
  cloneUrl?: string;
  defaultBranch?: string;
}

/** Creates a project - the entry point for "no extra ceremony": picking a repo (or pasting a URL) always creates one, then the caller navigates straight into the wizard with its id. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateProjectBody | null;
  if (!body?.repo || !body?.cloneUrl) {
    return NextResponse.json({ error: "repo and cloneUrl are required" }, { status: 400 });
  }
  const project = createProject({
    name: body.name,
    owner: body.owner ?? "",
    repo: body.repo,
    cloneUrl: body.cloneUrl,
    defaultBranch: body.defaultBranch || "main",
  });
  return NextResponse.json(project);
}
