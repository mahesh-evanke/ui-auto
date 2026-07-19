/**
 * Token extraction and Authorization header utilities.
 */

export type TokenCandidateKeys = 'token' | 'accessToken' | 'access_token' | 'jwt';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function extractTokenFromJson(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;

  const keys: TokenCandidateKeys[] = ['token', 'accessToken', 'access_token', 'jwt'];
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim().length) return v.trim();
  }
  return undefined;
}

export function buildAuthorizationHeader(authToken?: string): Record<string, string> {
  if (!authToken) return {};
  return { Authorization: `Bearer ${authToken}` };
}
