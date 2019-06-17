export declare const rand: () => string;
export interface SnapEvent {
    target: SnapDB<any>;
    time: number;
    [key: string]: any;
}
export declare class SnapDB<K> {
    keyType: "string" | "float" | "int";
    memoryCache?: boolean | undefined;
    private _isReady;
    private _path;
    private _worker;
    private _compactor;
    version: number;
    private _rse;
    private _hasEvents;
    isCompacting: boolean;
    isTx: boolean;
    /**
     * Creates an instance of SnapDB.
     *
     * @param {string} fileName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    constructor(fileName: string, keyType: "string" | "float" | "int", memoryCache?: boolean | undefined);
    /**
     * Listen for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    on(event: string, callback: (event: SnapEvent) => void): void;
    /**
     * Turn off listener for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    off(event: string, callback: (event: SnapEvent) => void): void;
    doCompaction(): Promise<any>;
    /**
     * This promise returns when the database is ready to use.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    ready(): Promise<any>;
    get(key: K): Promise<string>;
    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    delete(key: K): Promise<any>;
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
     * Starts a transaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    begin_transaction(): Promise<any>;
    /**
     * Ends a transaction.
     *
     * @returns
     * @memberof SnapDB
     */
    end_transaction(): Promise<any>;
    /**
     * Get the total number of keys in the data store.
     *
     * @returns {Promise<number>}
     * @memberof SnapDB
     */
    getCount(): Promise<number>;
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
    /**
     * Closes database
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    close(): Promise<any>;
    /**
     * Empty all keys and values from database.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    empty(): Promise<any>;
}
