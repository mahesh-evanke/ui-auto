export interface LocatorOpts {
    consumerRoot?: string;
    common?: boolean;
    pageName?: string;
}
export declare function resolveLocatorsDir(opts?: LocatorOpts): string;
export declare function resolveCommonLocatorsPath(opts?: LocatorOpts): string;
export declare function resolvePagesMapPath(opts?: LocatorOpts): string;
export declare function resolvePageLocatorsPath(pageName: string, opts?: LocatorOpts): string;
export declare function getElementLocator(elementName: string, opts: LocatorOpts & {
    common?: boolean;
    pageName?: string;
}): [string, string] | undefined;
export declare function getPageUrlByName(pageName: string, opts?: LocatorOpts): string;
export interface PageMetadata {
    title: string;
    label?: string;
}
export declare function getPageMetadata(screenName: string, opts?: LocatorOpts): PageMetadata | null;
export declare function clearLocatorCache(): void;
//# sourceMappingURL=locatorProvider.d.ts.map