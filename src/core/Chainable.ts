/**
 * Base class giving WebActions/ApiActions a fluent, chainable API - inspired
 * by playwright-fluent (https://github.com/hdorgeval/playwright-fluent):
 * each action method queues a closure and returns `this` synchronously
 * instead of awaiting immediately, so a spec file can chain several actions
 * into one statement:
 *
 *   await webActions
 *     .navigate(url)
 *     .fill('Username Field', 'tomsmith')
 *     .fill('Password Field', 'secret')
 *     .click('Login Button')
 *     .verifyTextPresent('You logged into a secure area');
 *
 * The class implements PromiseLike<void>, so `await` on the chain (or on any
 * single call) drains and runs the queue in order - awaiting after every
 * single call still works exactly as before, since each `await` just flushes
 * whatever is queued at that point.
 */
export abstract class Chainable<TSelf> implements PromiseLike<void> {
  private queue: Array<() => Promise<void>> = [];
  private _lastError?: Error;

  /** Queues an action and returns `this` for chaining. */
  protected enqueue(action: () => Promise<void>): TSelf {
    this.queue.push(action);
    return this as unknown as TSelf;
  }

  /** The error from the last chain that threw, if any (queue is cleared either way). */
  lastError(): Error | undefined {
    return this._lastError;
  }

  private async drain(): Promise<void> {
    try {
      this._lastError = undefined;
      while (this.queue.length > 0) {
        const action = this.queue.shift();
        if (action) await action();
      }
    } catch (error) {
      this._lastError = error as Error;
      this.queue = [];
      throw error;
    } finally {
      this.queue = [];
    }
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.drain().then(onfulfilled, onrejected);
  }
}
