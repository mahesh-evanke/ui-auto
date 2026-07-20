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
type QueueItem = { action: () => Promise<void>; soft: boolean };

export abstract class Chainable<TSelf> implements PromiseLike<void> {
  private queue: QueueItem[] = [];
  private _lastError?: Error;
  private _soft = false;
  private _softFailures: Error[] = [];

  /** Queues an action and returns `this` for chaining. Soft-ness is captured at enqueue time, so only actions queued after softly() are affected. */
  protected enqueue(action: () => Promise<void>): TSelf {
    this.queue.push({ action, soft: this._soft });
    return this as unknown as TSelf;
  }

  /**
   * Switches every action queued *after* this call into soft-assert mode:
   * its failure is collected instead of stopping the chain, so the rest of
   * the chain still runs. The final `await` still throws (summarizing every
   * collected failure) if any soft action failed - inspect them individually
   * beforehand via getSoftFailures(). Resets to hard mode once the chain drains.
   *
   *   await webActions
   *     .softly()
   *     .verifyFieldText('First Name', 'Jane')
   *     .verifyFieldText('Last Name', 'Doe')
   *     .verifyFieldText('Email', 'jane@example.com');
   *   // all three checks run even if the first one fails
   */
  softly(): TSelf {
    this._soft = true;
    return this as unknown as TSelf;
  }

  /** Failures collected while in soft mode during the last drained chain. */
  getSoftFailures(): Error[] {
    return this._softFailures;
  }

  /** The error from the last chain that threw, if any (queue is cleared either way). */
  lastError(): Error | undefined {
    return this._lastError;
  }

  private async drain(): Promise<void> {
    this._lastError = undefined;
    this._softFailures = [];
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        try {
          await item.action();
        } catch (error) {
          if (item.soft) {
            this._softFailures.push(error as Error);
          } else {
            throw error;
          }
        }
      }
      if (this._softFailures.length > 0) {
        const summary = this._softFailures.map((e, i) => `${i + 1}) ${e.message}`).join('\n');
        throw new Error(`${this._softFailures.length} soft assertion(s) failed:\n${summary}`);
      }
    } catch (error) {
      this._lastError = error as Error;
      this.queue = [];
      throw error;
    } finally {
      this.queue = [];
      this._soft = false;
    }
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.drain().then(onfulfilled, onrejected);
  }
}
