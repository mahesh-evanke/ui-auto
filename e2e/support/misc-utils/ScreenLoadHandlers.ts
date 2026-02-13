/**
 * Registry for app-specific screen load handlers.
 * Apps can register handlers; generic "User is on screen" step invokes them.
 * Keeps app-specific logic out of generic step definitions.
 */
export type ScreenLoadHandler = (screenName: string) => Promise<void>;

const handlers: ScreenLoadHandler[] = [];

export function registerScreenLoadHandler(h: ScreenLoadHandler): void {
    handlers.push(h);
}

export async function invokeScreenLoadHandlers(screenName: string): Promise<void> {
    for (const h of handlers) {
        await h(screenName);
    }
}
