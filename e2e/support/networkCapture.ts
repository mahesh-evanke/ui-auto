/**
 * WebdriverIO + CDP network capture for Web UI + API E2E flow.
 * Captures only XHR/Fetch (API) requests per UI step. Requires @wdio/devtools-service and Chrome.
 * Supports timestamp-based filtering via filterApisByTimestamp() for true E2E step boundaries.
 */

export interface CapturedApi {
    requestId: string;
    url: string;
    method: string;
    status: number;
    responseBody?: unknown;
    /** ISO timestamp when response was received (for filterApisByTimestamp). */
    timestamp?: number;
}

/** In-memory store for APIs captured in the current UI step window. */
let capturedApis: CapturedApi[] = [];
/** Pending requests: requestId -> { method, url }. Filled by requestWillBeSent. */
const pendingByRequestId: Record<string, { method: string; url: string }> = {};
let isCapturing = false;
let responseListener: ((event: { response: { url: string; status: number }; requestId: string }) => void) | null = null;
let requestListener: ((event: { requestId: string; request: { method: string; url: string } }) => void) | null = null;

/**
 * Start capturing network responses. Call before a UI action.
 * Uses CDP Network.enable and listeners; no-op if CDP is not available (e.g. not Chrome).
 */
export async function startNetworkCapture(): Promise<void> {
    capturedApis = [];
    Object.keys(pendingByRequestId).forEach((k) => delete pendingByRequestId[k]);
    const b = (global as any).browser;
    if (!b || typeof b.cdp !== 'function') {
        isCapturing = false;
        return;
    }
    try {
        await b.cdp('Network', 'enable');
    } catch {
        isCapturing = false;
        return;
    }
    isCapturing = true;

    requestListener = (event: { requestId: string; request: { method: string; url: string } }) => {
        if (!isCapturing) return;
        const url = event.request?.url || '';
        const method = (event.request?.method || 'GET').toUpperCase();
        if (isApiRequest(url, method)) {
            pendingByRequestId[event.requestId] = { method, url };
        }
    };
    responseListener = (event: { response: { url: string; status: number }; requestId: string }) => {
        if (!isCapturing) return;
        const pending = pendingByRequestId[event.requestId];
        const method = pending?.method || 'GET';
        const url = event.response?.url || pending?.url || '';
        const status = event.response?.status ?? 0;
        if (isApiRequest(url, method)) {
            const entry: CapturedApi = {
                requestId: event.requestId,
                url,
                method,
                status,
                timestamp: Date.now(),
            };
            capturedApis.push(entry);
            (async () => {
                try {
                    const r = await b.cdp('Network', 'getResponseBody', { requestId: event.requestId });
                    const body = (r as { body?: string })?.body;
                    if (body != null) {
                        let parsed: unknown = body;
                        if (typeof body === 'string' && body.trim().startsWith('{')) {
                            try {
                                parsed = JSON.parse(body);
                            } catch {
                                parsed = body;
                            }
                        }
                        entry.responseBody = parsed;
                    }
                } catch {
                    // ignore
                }
            })();
        }
        delete pendingByRequestId[event.requestId];
    };

    b.on('Network.requestWillBeSent', requestListener);
    b.on('Network.responseReceived', responseListener);
}

/**
 * Stop capturing and return APIs captured since startNetworkCapture.
 * Removes CDP listeners and disables Network domain.
 */
export async function stopNetworkCapture(): Promise<void> {
    const b = (global as any).browser;
    if (b && requestListener) {
        b.off?.('Network.requestWillBeSent', requestListener);
        requestListener = null;
    }
    if (b && responseListener) {
        b.off?.('Network.responseReceived', responseListener);
        responseListener = null;
    }
    isCapturing = false;
    try {
        if (b && typeof b.cdp === 'function') {
            await b.cdp('Network', 'disable');
        }
    } catch {
        // ignore
    }
}

/**
 * Return APIs captured in the last start → stop window. Does not stop capture.
 */
export function getCapturedApis(): CapturedApi[] {
    return [...capturedApis];
}

/**
 * Filter out non-API noise (static assets, analytics, etc.). Keep XHR/Fetch to app backends.
 */
function isApiRequest(url: string, method: string): boolean {
    if (!url) return false;
    const u = url.toLowerCase();
    if (u.includes('.js') || u.includes('.css') || u.includes('.woff') || u.includes('.ico') || u.includes('.png') || u.includes('.jpg') || u.includes('.gif') || u.includes('.svg')) {
        return false;
    }
    if (method === 'GET' && (u.includes('google-analytics') || u.includes('googletagmanager') || u.includes('analytics'))) {
        return false;
    }
    return true;
}

/**
 * Wait a short time for in-flight API responses after a UI action.
 */
export function waitForNetworkIdle(ms: number = 1500): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Filter captured APIs to only those within [startTime, endTime] (ms).
 * Use when step boundaries are timestamp-based (e.g. startStep() / endStep()).
 */
export function filterApisByTimestamp(apis: CapturedApi[], startTime: number, endTime: number): CapturedApi[] {
    return apis.filter((a) => {
        const t = a.timestamp ?? 0;
        return t >= startTime && t <= endTime;
    });
}
