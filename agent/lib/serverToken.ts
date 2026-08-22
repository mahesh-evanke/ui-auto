import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

/**
 * Reads the GitHub access token out of the signed session JWT, server-side
 * only. Never send this value to the client (no API route should echo it
 * back in a JSON response body).
 */
export async function getGithubAccessToken(req: NextRequest): Promise<string | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken;
  return typeof accessToken === "string" ? accessToken : null;
}
