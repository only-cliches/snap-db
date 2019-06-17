export declare class SnapCompactor {
    path: string;
    keyType: string;
    cache: boolean;
    private _manifestData;
    constructor(path: string, keyType: string, cache: boolean);
    private _runCompaction;
}
