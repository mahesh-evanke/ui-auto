/**
 * Combines WebActions and ApiActions into a single fluent chain, for tests
 * that interleave UI steps and direct API calls and want one `await` instead
 * of two separate chains (compare tests/web-api.spec.ts, which uses two).
 * Each method here delegates to - and immediately drains - a single action on
 * the underlying WebActions/ApiActions instance, so ordering across web and
 * api calls is preserved exactly as written:
 *
 *   await actions
 *     .navigate('https://example.com')
 *     .verifyTextPresent('Welcome')
 *     .sendRequest('GET', '/api/users/1')
 *     .expectStatus(200)
 *     .validateResponseFields({ id: 1 });
 */
import { Chainable } from '../core/Chainable';
import { ScenarioCache } from '../cache/ScenarioCache';
import { WebActions } from '../web/WebActions';
import { ApiActions } from '../api/ApiActions';
import type { TableRows } from '../web/tableHelper';

export class CombinedActions extends Chainable<CombinedActions> {
  constructor(readonly web: WebActions, readonly api: ApiActions) {
    super();
  }

  /** Shared per-test key/value store (same instance as web.context/api.context) - see ScenarioCache. */
  get context(): ScenarioCache {
    return this.api.context;
  }

  navigate(url: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.navigate(url);
    });
  }

  usePage(pageKey: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.usePage(pageKey);
    });
  }

  click(name: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.click(name);
    });
  }

  fill(name: string, text: string | (() => string)): CombinedActions {
    return this.enqueue(async () => {
      await this.web.fill(name, text);
    });
  }

  /** Reads a named field's value/text and saves it under `key`, for reuse in a later step. */
  extractText(name: string, key: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.extractText(name, key);
    });
  }

  /** Reads several named fields at once (e.g. a login/password form) and saves them as one object under `key`. */
  extractFields(fields: Record<string, string>, key: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.extractFields(fields, key);
    });
  }

  /** Reads several named fields and writes them straight to e2e/data/<fileName>.json - one call, no cache key needed. */
  saveFieldsToFile(fields: Record<string, string>, fileName: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.saveFieldsToFile(fields, fileName);
    });
  }

  /** Reads a table's actual current rows and saves them under `key` - the capture counterpart to verifyWebTable(). */
  readWebTable(name: string, key: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.readWebTable(name, key);
    });
  }

  verifyTextPresent(text: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.verifyTextPresent(text);
    });
  }

  verifyFieldText(name: string, expected: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.verifyFieldText(name, expected);
    });
  }

  verifyWebTable(name: string, rows: TableRows): CombinedActions {
    return this.enqueue(async () => {
      await this.web.verifyWebTable(name, rows);
    });
  }

  sendRequest(method: string, url: string | (() => string), body?: unknown | (() => unknown)): CombinedActions {
    return this.enqueue(async () => {
      await this.api.sendRequest(method, url, body);
    });
  }

  expectStatus(expectedStatusCode: number): CombinedActions {
    return this.enqueue(async () => {
      await this.api.expectStatus(expectedStatusCode);
    });
  }

  validateResponseFields(expected: unknown): CombinedActions {
    return this.enqueue(async () => {
      await this.api.validateResponseFields(expected);
    });
  }

  /** Saves a field from the last API response body (dot-path) under `key`, for reuse in a later step. */
  saveResponseField(path: string, key: string): CombinedActions {
    return this.enqueue(async () => {
      await this.api.saveResponseField(path, key);
    });
  }

  /** Saves the entire last API response body under `key`, for reuse in a later step. */
  saveResponseBody(key: string): CombinedActions {
    return this.enqueue(async () => {
      await this.api.saveResponseBody(key);
    });
  }

  /** The full body of the last API response - read after awaiting the chain. */
  get lastResponseBody(): unknown {
    return this.api.lastResponseBody;
  }

  /** The body that was actually sent on the last API request - read after awaiting the chain. */
  get lastRequestBody(): unknown {
    return this.api.lastRequestBody;
  }

  /** Reads a previously-received API response body by method+URL - every response is cached automatically, no explicit save call needed. Immediate (not queued). */
  getCachedResponse<T = unknown>(method: string, url: string): T {
    return this.api.getCachedResponse<T>(method, url);
  }
}
