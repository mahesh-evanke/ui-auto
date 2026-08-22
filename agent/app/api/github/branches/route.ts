import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../../lib/serverToken.js";
import { listBranches } from "../../../../lib/githubClient.js";

export async function GET(req: NextRequest) {
  const token = await getGithubAccessToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const owner = req.nextUrl.searchParams.get("owner");
  const repo = req.nextUrl.searchParams.get("repo");
  if (!owner || !repo) {
    return NextResponse.json({ error: "owner and repo query params are required" }, { status: 400 });
  }
  try {
    const branches = await listBranches(token, owner, repo);
    return NextResponse.json({ branches });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
