export type RawLocator = unknown;
export interface LocatorProviderOptions {
    consumerRoot?: string;
}
export declare function resolveLocatorsDir(opts?: LocatorProviderOptions): string;
export declare function resolveCommonLocatorsPath(opts?: LocatorProviderOptions): string;
export declare function resolvePagesMapPath(opts?: LocatorProviderOptions): string;
export declare function resolvePageLocatorsPath(pageName: string, opts?: LocatorProviderOptions): string;
export declare function getElementLocator(elementName: string, opts: LocatorProviderOptions & {
    pageName?: string;
    common?: boolean;
}): RawLocator;
export declare function getPageUrlByName(pageName: string, opts?: LocatorProviderOptions): string;
export interface PageMetadata {
    title: string;
    label?: string;
}
/**
 * Read page metadata from pages.json (title/label for "User is on X screen").
 * Expects format: "ScreenName": [{"title": "...", "label": "..."}]
 */
export declare function getPageMetadata(screenName: string, opts?: LocatorProviderOptions): PageMetadata | null;
export declare function clearLocatorCache(): void;
//# sourceMappingURL=locatorProvider.d.ts.map