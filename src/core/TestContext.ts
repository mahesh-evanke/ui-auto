/**
 * Per-test key/value store shared by WebActions/ApiActions (injected by
 * fixtures.ts as the same instance into both), so a value saved from a UI
 * step or an API response can be reused as input to a later step - even
 * within one fluent chain, via a lazy function argument:
 *
 *   await apiActions
 *     .sendRequest('POST', loginUrl, creds)
 *     .expectStatus(200)
 *     .saveResponseField('token', 'authToken')
 *     .sendRequest('GET', () => `/profile?token=${apiActions.context.get('authToken')}`)
 *     .expectStatus(200);
 *
 * The lazy function only runs when that queued action actually executes, by
 * which point every earlier step in the chain has already completed - so it
 * always sees the freshest saved value, regardless of how many calls were
 * chained under one `await`.
 */
export class TestContext {
  private readonly store = new Map<string, unknown>();

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get<T = unknown>(key: string): T {
    if (!this.store.has(key)) {
      throw new Error(`No value saved under key "${key}". Call saveResponseField()/saveResponseBody()/extractText() first.`);
    }
    return this.store.get(key) as T;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }
}

/** Reads a dot-path (e.g. "user.token") out of a nested object/array. */
export function getByPath(obj: unknown, path: string): unknown {
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  let current: unknown = obj;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot read "${segment}" of ${current} while resolving path "${path}"`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
