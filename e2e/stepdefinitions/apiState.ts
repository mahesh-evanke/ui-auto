/**
 * Central API execution/capture state shared across step definitions.
 */
import type { CapturedApi } from '../support/capture';

export type SyntheticApiResponse = {
  status: () => number;
  json: () => Promise<unknown>;
};

export type PendingApiRequest = {
  method: string;
  url: string;
  normalizedUrl: string;
  body?: unknown;
};

export type ApiLastResponse = {
  status: number;
  body: unknown;
};

export type ApiState = {
  /**
   * Captured APIs stored as pure JSON (no DataTable).
   * Used for synthetic response replay.
   */
  capturedApis: CapturedApi[];
  /** Track which captured entries have already been consumed for replay. */
  consumedCapturedApiIndices: Set<number>;

  /** Auth token discovered in API responses, used for subsequent direct requests. */
  authToken?: string;

  /** The "Given User sends ... request ..." payload awaiting execution/lookup. */
  pendingRequest?: PendingApiRequest;

  /** Last response produced by execution or replay. */
  lastResponse?: ApiLastResponse;

  /** Optional synthetic response (only meaningful for replay). */
  lastSyntheticResponse?: SyntheticApiResponse;
};

export function createEmptyApiState(): ApiState {
  return {
    capturedApis: [],
    consumedCapturedApiIndices: new Set<number>(),
    authToken: undefined,
    pendingRequest: undefined,
    lastResponse: undefined,
    lastSyntheticResponse: undefined,
  };
}
