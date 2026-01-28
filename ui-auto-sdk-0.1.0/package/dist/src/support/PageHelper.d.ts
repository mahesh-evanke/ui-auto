type LocatorTuple = [string, string];
export declare class SdkPageHelper {
    static locator(elementName: string, common: boolean): Promise<LocatorTuple>;
    static selector(elementName: string, common: boolean): Promise<string>;
    static findElement(elementName: string, common: boolean, waitFormat?: string): Promise<WebdriverIO.Element>;
}
export {};
//# sourceMappingURL=PageHelper.d.ts.map