export declare class SnapDB<K> {
    keyType: "string" | "float" | "int";
    memoryCache?: boolean | undefined;
    private _isReady;
    private _indexNum;
    private _currentFileIdx;
    private _currentFileLen;
    private _path;
    private _dataFiles;
    private _keyStream;
    private _tombStream;
    private _dataStreams;
    private _cache;
    private _keyData;
    /**
     * Creates an instance of SnapDB.
     *
     * @param {string} folderName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    constructor(folderName: string, keyType: "string" | "float" | "int", memoryCache?: boolean | undefined);
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
     * Check if WASM module has been initiliazed.
     *
     * @private
     * @memberof SnapDB
     */
    private _checkWasmReady;
    /**
     * Loads previously created database details into disk.
     * Optionally loads cache from disk.
     *
     * @private
     * @memberof SnapDB
     */
    private _loadIndexFromDisk;
    /**
     * This promise returns when the database is ready to use.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    ready(): Promise<any>;
    /**
     * Currently does nothing.
     *
     * @param {(err: any) => void} complete
     * @memberof SnapDB
     */
    do_compaction(complete: (err: any) => void): void;
    /**
     * Get a single value from the database at the given key.
     *
     * @param {K} key
     * @returns {Promise<string>}
     * @memberof SnapDB
     */
    get(key: K): Promise<string>;
    private _readValue;
    private _readValueSync;
    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    delete(key: K): Promise<boolean>;
    private _makeKey;
    /**
     * Put a key and value into the data store.
     * Replaces existing values with new values at the given key, otherwise creates a new key.
     *
     * @param {K} key
     * @param {string} data
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    put(key: K, data: string): Promise<any>;
    /**
     * Get all keys from the data store in order.
     *
     * @param {(key: K) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    getAllKeys(onRecord: (key: K) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    /**
     * Get the total number of keys in the data store.
     *
     * @returns {number}
     * @memberof SnapDB
     */
    getCount(): number;
    /**
     * Get all keys and values from the store in order.
     *
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    getAll(onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    /**
     * Gets the keys and values between a given range, inclusive.
     *
     * @param {K} lower
     * @param {K} higher
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    range(lower: K, higher: K, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    /**
     * Get a collection of values from the keys at the given offset/limit.
     * This is traditionally a very slow query, in SnapDB it's extremely fast.
     *
     * @param {number} offset
     * @param {number} limit
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    offset(offset: number, limit: number, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
}
