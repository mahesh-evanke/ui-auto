/**
 * Injects a small automation overlay into the current page.
 *
 * This runs in the browser context via `browser.execute`. It must be idempotent
 * (safe to call multiple times across navigations and SPA route changes).
 */
export interface OverlayState {
    scenarioName?: string;
    status?: string;
}
export declare function injectAutomationOverlay(state?: OverlayState): Promise<void>;
//# sourceMappingURL=injectAutomationOverlay.d.ts.map