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
import { WebActions } from '../web/WebActions';
import { ApiActions } from '../api/ApiActions';
import type { TableRows } from '../web/tableHelper';

export class CombinedActions extends Chainable<CombinedActions> {
  constructor(readonly web: WebActions, readonly api: ApiActions) {
    super();
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

  fill(name: string, text: string): CombinedActions {
    return this.enqueue(async () => {
      await this.web.fill(name, text);
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

  sendRequest(method: string, url: string, body?: unknown): CombinedActions {
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

  /** The full body of the last API response - read after awaiting the chain. */
  get lastResponseBody(): unknown {
    return this.api.lastResponseBody;
  }
}
