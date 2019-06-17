export declare class SnapCompactor {
    path: string;
    keyType: string;
    cache: boolean;
    private _manifestData;
    private _bloomCache;
    constructor(path: string, keyType: string, cache: boolean);
    private _getBloom;
    private _runCompaction;
}
