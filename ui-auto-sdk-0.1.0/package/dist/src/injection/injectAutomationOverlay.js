"use strict";
/**
 * Injects a small automation overlay into the current page.
 *
 * This runs in the browser context via `browser.execute`. It must be idempotent
 * (safe to call multiple times across navigations and SPA route changes).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectAutomationOverlay = injectAutomationOverlay;
async function injectAutomationOverlay(state = {}) {
    const scenarioName = state.scenarioName ?? '';
    const status = state.status ?? 'running';
    // Note: function body runs in browser context; it must not reference Node globals.
    await browser.execute((sName, sStatus) => {
        const overlayId = '__ui_auto_overlay__';
        const styleId = '__ui_auto_overlay_style__';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
          #${overlayId} {
            position: fixed;
            z-index: 2147483647;
            right: 12px;
            bottom: 12px;
            max-width: 360px;
            font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
            font-size: 12px;
            line-height: 1.25;
            color: #fff;
            background: rgba(17, 24, 39, 0.88);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 10px;
            padding: 10px 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
            backdrop-filter: blur(6px);
          }
          #${overlayId} .title { font-weight: 700; margin-bottom: 2px; }
          #${overlayId} .meta { opacity: 0.9; word-break: break-word; }
          #${overlayId} .badge {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 6px;
            border-radius: 999px;
            background: rgba(59, 130, 246, 0.95);
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            font-size: 10px;
          }
        `;
            document.head.appendChild(style);
        }
        let overlay = document.getElementById(overlayId);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.setAttribute('aria-live', 'polite');
            overlay.setAttribute('role', 'status');
            document.body.appendChild(overlay);
        }
        const title = 'UI-AUTO';
        overlay.innerHTML = `
        <div class="title">${title}<span class="badge">${String(sStatus)}</span></div>
        <div class="meta">${sName ? `Scenario: ${String(sName)}` : ''}</div>
      `;
    }, scenarioName, status);
}
//# sourceMappingURL=injectAutomationOverlay.js.map