import { NextRequest, NextResponse } from "next/server";
import { getGithubAccessToken } from "../../../../lib/serverToken.js";
import { listRepos } from "../../../../lib/githubClient.js";

export async function GET(req: NextRequest) {
  const token = await getGithubAccessToken(req);
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  try {
    const repos = await listRepos(token);
    return NextResponse.json({ repos });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
