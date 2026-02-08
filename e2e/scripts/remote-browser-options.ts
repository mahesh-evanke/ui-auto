/**
 * Builds WebdriverIO remote() options using the same driver path logic as wdio.conf.
 * Use this so standalone scripts do not trigger EdgeDriver/ChromeDriver download and use the exe from config.
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';

const CONFIG_PATH = 'e2e/config/config.yaml';

/** Options suitable for webdriverio remote() - use same driver path logic as wdio.conf. */
export interface RemoteBrowserOptions {
    capabilities: Record<string, unknown>;
}

function loadConfig(): Record<string, unknown> {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return (yaml.load(raw) as Record<string, unknown>) || {};
}

/**
 * Returns remote() options with capabilities that use the driver binary from config when set.
 * - Edge: uses edgedriverpath -> wdio:edgedriverOptions.binary (no EdgeDriver download).
 * - Chrome: uses chromedriverpath -> wdio:chromedriverOptions.binary (no ChromeDriver download).
 * Omit hostname/port so WebdriverIO starts the driver locally using the specified binary.
 */
export function getRemoteOptions(browser: 'edge' | 'chrome' = 'edge'): RemoteBrowserOptions {
    const config = loadConfig();
    const capabilities: Record<string, unknown> = {
        browserName: browser === 'edge' ? 'msedge' : 'chrome',
    };

    if (browser === 'edge') {
        const path = config.edgedriverpath && String(config.edgedriverpath).trim() !== '' && String(config.edgedriverpath) !== '<path>';
        if (path) {
            capabilities['wdio:edgedriverOptions'] = { binary: String(config.edgedriverpath).trim() };
        }
    } else {
        const path = config.chromedriverpath && String(config.chromedriverpath).trim() !== '' && String(config.chromedriverpath) !== '<path>';
        if (path) {
            capabilities['wdio:chromedriverOptions'] = { binary: String(config.chromedriverpath).trim() };
        }
    }

    return {
        capabilities,
        // Omit hostname/port so WDIO starts the driver locally and uses the binary from capabilities.
    };
}
