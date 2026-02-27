/**
 * DEPRECATED: Viewport is now driven by e2e/config/config.yaml viewportDevice.
 * Use "wdio" with viewportDevice set (e.g. "Pixel 7") instead of this config.
 * Run the same feature files as the base config, but with the browser window
 * set to a mobile viewport (412x915) so the test runs in "mobile view" on desktop Chrome.
 * No Appium or emulator required.
 */
import type { Options } from '@wdio/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { config: baseConfig } = require('./wdio.conf');

const MOBILE_VIEWPORT = { width: 412, height: 915 };

export const config: Options.Testrunner = {
    ...(baseConfig as object),
    before: async function (this: any, capabilities: any, specs: string[]) {
        const b = (typeof globalThis !== 'undefined' ? globalThis : (global as any)) as any;
        try {
            if (b.browser && typeof b.browser.setWindowSize === 'function') {
                await b.browser.setWindowSize(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
                console.log('[wdio:mobile-view] Viewport set to ' + MOBILE_VIEWPORT.width + 'x' + MOBILE_VIEWPORT.height);
            }
        } catch (e) {
            console.warn('[wdio:mobile-view] setWindowSize failed:', (e as Error).message);
        }
        if (typeof (baseConfig as any).before === 'function') {
            await (baseConfig as any).before.call(this, capabilities, specs);
        }
    },
};
