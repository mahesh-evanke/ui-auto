/**
 * Ollama client — supports both local Ollama and cloud-hosted Ollama endpoints.
 *
 * Local (default):  OLLAMA_HOST=http://127.0.0.1:11434   (no key needed)
 * Cloud:            OLLAMA_HOST=https://...               + OLLAMA_API_KEY=<key>
 *
 * Config is loaded from .env automatically (via dotenv).
 */
import * as fs from 'fs';
import * as path from 'path';

// ── Lightweight dotenv loader (no extra dependency) ─────────────────────────
function loadDotenv(): void {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // ignore parse errors
  }
}

loadDotenv();

// ── Types ────────────────────────────────────────────────────────────────────
export type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: Record<string, unknown>;
};

export type OllamaGenerateResponse = {
  response: string;
  done: boolean;
};

// ── Config helpers ───────────────────────────────────────────────────────────
function baseUrl(): string {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (raw) return raw.replace(/\/+$/, '');
  return 'http://127.0.0.1:11434';
}

function apiKey(): string {
  return process.env.OLLAMA_API_KEY?.trim() || '';
}

export function ollamaModel(): string {
  return process.env.AI_FIX_OLLAMA_MODEL?.trim() || 'gpt-oss:20b-cloud';
}

export function isCloudMode(): boolean {
  return !!apiKey();
}

// ── Core generate call ───────────────────────────────────────────────────────
export async function ollamaGenerate(req: OllamaGenerateRequest): Promise<string> {
  const url = `${baseUrl()}/api/generate`;
  const key = apiKey();

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...req, stream: false }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Ollama${isCloudMode() ? ' Cloud' : ''} generate failed: ${res.status} ${res.statusText}\n${body}`.trim(),
    );
  }

  const data = (await res.json()) as Partial<OllamaGenerateResponse>;
  return String(data.response ?? '');
}
