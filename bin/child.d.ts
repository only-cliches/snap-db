declare const wasm: any;
declare class SnapWorker {
    _path: string;
    keyType: string;
    memoryCache: boolean;
    private _cache;
    _indexNum: number;
    _dbNum: number;
    constructor(_path: string, keyType: string, memoryCache: boolean);
    private _getReady;
    /**
     * Loads previously saved data into cache if cache is enabled.
     *
     * @private
     * @param {() => void} complete
     * @param {(err) => void} onErr
     * @returns
     * @memberof SnapDB
     */
    private _loadCache;
    /**
     * Get all the keys from unqlite and load them into index
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeys;
}
