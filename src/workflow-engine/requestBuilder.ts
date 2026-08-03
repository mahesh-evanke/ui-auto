/**
 * "Final Request Builder" - takes a step's templates (url/headers/body/
 * queryParams/pathParams) plus its already-resolved mapping values, and
 * assembles the concrete HTTP request the executor will send. Never resolves
 * anything itself (that's the Mapping/Expression Engine's job) - purely
 * structural assembly.
 */
import type { FieldMapping, JsonValue, WorkflowStep } from './types';
import { setByPath } from './pathResolver';

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: JsonValue;
}

function deepClone<T extends JsonValue | undefined>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function substituteUrlParams(url: string, params: Record<string, string>): string {
  let out = url;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(new RegExp(`:${key}\\b`), value).replace(new RegExp(`\\{${key}\\}`), value);
  }
  return out;
}

function appendQueryString(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return url;
  const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

export function buildRequest(
  step: WorkflowStep,
  resolved: Array<{ mapping: FieldMapping; value: JsonValue | undefined }>,
): BuiltRequest {
  const headers: Record<string, string> = { ...(step.headers ?? {}) };
  let body: JsonValue = deepClone(step.body) ?? {};
  const queryParams: Record<string, string> = { ...(step.queryParams ?? {}) };
  const pathParams: Record<string, string> = { ...(step.pathParams ?? {}) };

  for (const { mapping, value } of resolved) {
    if (value === undefined) continue; // optional/unresolved mapping - leave the template value as-is
    const stringValue = () => (typeof value === 'string' ? value : JSON.stringify(value));

    switch (mapping.target) {
      case 'headers':
        headers[mapping.targetPath] = stringValue();
        break;
      case 'body':
        body = setByPath(body ?? {}, mapping.targetPath, value);
        break;
      case 'queryParams':
        queryParams[mapping.targetPath] = stringValue();
        break;
      case 'pathParams':
        pathParams[mapping.targetPath] = stringValue();
        break;
    }
  }

  const urlWithPath = substituteUrlParams(step.url, pathParams);
  const url = appendQueryString(urlWithPath, queryParams);

  return { method: step.method, url, headers, body: step.body !== undefined || Object.keys(body as object).length > 0 ? body : undefined };
}
