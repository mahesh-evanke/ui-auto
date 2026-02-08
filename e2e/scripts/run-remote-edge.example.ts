/**
 * Example: run a browser via WebdriverIO remote() using the same driver exe as wdio.conf (no download).
 * Run from project root: npx tsx e2e/scripts/run-remote-edge.example.ts
 */
import { remote } from 'webdriverio';
import { getRemoteOptions } from './remote-browser-options';

async function main() {
    const browser = await remote(getRemoteOptions('edge'));

    try {
        await browser.navigateTo('https://example.com');
        console.log(await browser.getTitle());
    } finally {
        await browser.deleteSession();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
