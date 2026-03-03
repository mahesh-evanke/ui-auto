export interface ScaffoldOptions {
    consumerRoot?: string;
    force?: boolean;
    /** Include Web UI tests */
    web?: boolean;
    /** Include API tests */
    api?: boolean;
    /** Include Web+API (E2E) tests */
    webuiApi?: boolean;
    /** Include database verification tests */
    db?: boolean;
    /** Include Mobile tests */
    mobile?: boolean;
}
export declare function scaffold(opts?: ScaffoldOptions): void;
//# sourceMappingURL=scaffold.d.ts.map