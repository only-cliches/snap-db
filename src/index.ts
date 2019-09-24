import * as path from "path";
import { fork, ChildProcess } from "child_process";
import { VERSION, fileName as fNameFN, rand, QueryArgs } from "./common";
import { ReallySmallEvents } from "./lib_rse";
import * as fs from "fs";
import { SnapDatabase } from "./database";
import * as stream from "stream";

const messageBuffer: {
    [messageId: string]: (values: string[]) => void;
} = {};

export interface SnapEvent {
    target: SnapDB<any>,
    time: number,
    [key: string]: any;
}

export class SnapDB<K> {

    public version: number = VERSION;

    /**
     * `true` if the database is currently compacting, `false` otherwise.
     * READ ONLY
     *
     * @type {boolean}
     * @memberof SnapDB
     */
    public isCompacting: boolean = false;

    /**
     * `true` if there is an active, open transaction, `false` otherwise.
     * READ ONLY
     *
     * @type {boolean}
     * @memberof SnapDB
     */
    public isTx: boolean = false;


    /**
     * Holds the current key type.
     * READ ONLY
     *
     * @type {("string" | "float" | "int" | "any")}
     * @memberof SnapDB
     */
    public keyType: "string" | "float" | "int" | "any";

    /**
     * `true` if the in memory cache is enabled, `false` otherwise.
     * READ ONLY
     *
     * @type {boolean}
     * @memberof SnapDB
     */
    public memoryCache?: boolean;

    /**
     * Internal, do not touch!
     *
     * @type {number[]}
     * @memberof SnapDB
     */
    public _clearCompactFiles: number[] = [];

    private _isReady: boolean;
    private _path: string;
    private _worker: ChildProcess;
    private _compactor: ChildProcess;
    private _rse: ReallySmallEvents;
    private _hasEvents: boolean = false;
    private _compactId: string;
    private _database: SnapDatabase;
    private _autoFlush: boolean | number;
    private _isClosed: boolean;

    /**
     *Creates an instance of SnapDB.
     * @param {({
     *         dir: string,
     *         key: "string" | "float" | "int" | "any",
     *         cache?: boolean,
     *         autoFlush?: number|boolean,
     *         singleThread?: boolean
     *     })} args
     * @memberof SnapDB
     */
    constructor(args: {
        dir: string,
        key?: "string" | "float" | "int" | "any",
        cache?: boolean,
        autoFlush?: number | boolean,
        mainThread?: boolean
    } | string, keyType?: "string" | "float" | "int" | "any", cache?: boolean) {

        this._autoFlush = true;
        this._onCompactorMessage = this._onCompactorMessage.bind(this);

        if (typeof args === "string") {
            this._path = args;
            this.keyType = keyType || "any";
            this.memoryCache = cache || false;
            this._worker = fork(path.join(__dirname, "database.js"));
        } else {
            this._path = path.resolve(args.dir);
            this.keyType = args.key || "any";
            this.memoryCache = args.cache || false;
            this._autoFlush = typeof args.autoFlush === "undefined" ? true : args.autoFlush;

            if (args.mainThread) {
                this._database = new SnapDatabase(this._path, this.keyType, this.memoryCache, this._autoFlush, false);
            } else {
                this._worker = fork(path.join(__dirname, "database.js"));
            }
        }

        this._rse = new ReallySmallEvents();
        this._compactor = fork(path.join(__dirname, "compact.js"));
        this._clearCompactFiles = [];

        if (this._worker) { // multi threaded mode

            this._worker.on("message", (msg) => { // got message from worker
                switch (msg.type) {
                    case "snap-ready":
                        this._isReady = true;
                        break;
                    case "snap-compact":
                        this.isCompacting = true;
                        this._compactor.send("do-compact");
                        if (this._hasEvents) this._rse.trigger("compact-start", { target: this, time: Date.now() });
                        break;
                    case "snap-compact-done":
                        this._cleanupCompaction();
                        break;
                    case "snap-res":
                        if (msg.event && this._hasEvents) {
                            this._rse.trigger(msg.event, { target: this, tx: msg.id, time: Date.now(), data: msg.data[1], error: msg.data[0] });
                        }
                        messageBuffer[msg.id].apply(null, [msg.data]);
                        break;
                    case "snap-res-done":
                        if (msg.event && this._hasEvents) {
                            this._rse.trigger(msg.event, { target: this, tx: msg.id, time: Date.now(), data: msg.data[1], error: msg.data[0] });
                        }
                        if (msg.event === "tx-start") {
                            this.isTx = true;
                        }
                        if (msg.event === "tx-end") {
                            this.isTx = false;
                        }
                        messageBuffer[msg.id].apply(null, [msg.data]);
                        delete messageBuffer[msg.id];
                        break;
                    case "snap-clear-done":


                        this._compactor = fork(path.join(__dirname, "compact.js"));
                        this._compactor.on("message", this._onCompactorMessage);

                        messageBuffer[msg.id].apply(null, [msg.data]);
                        delete messageBuffer[msg.id];

                        this._isReady = true;
                        if (this._hasEvents) this._rse.trigger("clear", { target: this, tx: msg.id, time: Date.now() });
                        break;
                    case "snap-close-done":
                        this._isReady = false;
                        this._compactor.kill();
                        this._worker.kill();
                        messageBuffer[msg.id].apply(null, [msg.data]);
                        delete messageBuffer[msg.id];
                        if (this._hasEvents) this._rse.trigger("close", { target: this, tx: msg.id, time: Date.now() });
                        break;
                }
            });
            this._worker.send({ type: "snap-connect", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: this._autoFlush });
        }

        // trigger database ready
        const checkReady = () => {
            if (this._isClosed) return;
            if ((this._database && this._database.ready) || this._isReady) {
                this._isReady = true;
                if (this._hasEvents) {
                    this._rse.trigger("ready", { target: this, time: Date.now() });
                }
            } else {
                setTimeout(checkReady, 100);
            }
        }
        checkReady();

        // prepare compactor thread
        this._compactor.on("message", this._onCompactorMessage);
        this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: this._autoFlush });
    }

    /**
     * Listen for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    public on(event: string, callback: (event: SnapEvent) => void) {
        this._hasEvents = true;
        this._rse.on(event, callback);
    }

    /**
     * Turn off listener for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    public off(event: string, callback: (event: SnapEvent) => void) {
        this._rse.off(event, callback);
    }

    /**
     * Forces the log to be flushed to disk files, possibly causing a compaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public flushLog(callback?: (err: any) => void): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this.isCompacting === true) {
                if (callback) callback("Already compacting!");
                rej("Already compacting!");
                return;
            }
            this.isCompacting = true;

            if (this._worker) {
                this._worker.send({ type: "do-compact" });
            } else {
                this._database.maybeFlushLog(true);
                this._compactor.send("do-compact");
            }

            const checkDone = () => {

                if (this.isClosed) return;

                if (this.isCompacting) {
                    setTimeout(checkDone, 100);
                } else {
                    if (callback) callback(undefined);
                    res();
                }
            }
            checkDone();
        })
    }

    /**
     * Returns `true` if the database is ready, `false` otherwise.
     *
     * @returns {boolean}
     * @memberof SnapDB
     */
    public isOpen(): boolean {
        if (this._isReady) return true;
        return false;
    }

    /**
     * Returns `true` if the database isn't ready, `false` otherwise.
     *
     * @returns {boolean}
     * @memberof SnapDB
     */
    public isClosed(): boolean {
        if (this._isReady) return false;
        return true;
    }

    /**
     * This resolves when the database is ready to use.
     *
     * @returns {Promise<void>}
     * @memberof SnapDB
     */
    public ready(callback?: () => void): Promise<void> {
        if (this._isReady) {
            if (callback) callback();
            return Promise.resolve();
        }
        return new Promise((res, rej) => {
            const readyCB = () => {
                if (callback) callback();
                this.off("ready", readyCB);
                res();
            }
            this.on("ready", readyCB);
        });
    }

    /**
     * Get a value from the database given it's key.
     *
     * @param {K} key
     * @returns {Promise<string>}
     * @memberof SnapDB
     */
    public get(key: K, callback?:(err: any, value?: string) => void ): Promise<string | undefined> {

        const getKey = this.keyType === "any" ? this._anyKey(key) : key;

        return this._doWhenReady((res, rej) => {
            if (this._worker) {

                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1] === null ? undefined : data[1]);
                    }
                    if (callback) callback(data[0], data[1] === null ? undefined : data[1]);
                })

                this._worker.send({ type: "snap-get", key: getKey, id: msgId });
            } else {

                try {
                    const data = this._database.get(getKey);
                    res(data === null ? undefined : data);
                    if (callback) callback(undefined, data === null ? undefined : data);
                    if (this._hasEvents) this._rse.trigger("get", { target: this, tx: rand(), time: Date.now(), data: data });
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("get", { target: this, tx: rand(), time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public delete(key: K, callback?: (err: any, key?: K) => void): Promise<any> {
        if (key === null || key === undefined) {
            if (callback) callback("Write Error: Key can't be null or undefined!");
            return Promise.reject("Write Error: Key can't be null or undefined!");
        }
        const getKey = this.keyType === "any" ? this._anyKey(key) : key;
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                    if (callback) callback(data[0], data[1]);
                })

                this._worker.send({ type: "snap-del", key: getKey, id: msgId });
            } else {
                const msgId = rand();
                try {
                    res(this._database.delete(getKey));
                    if (callback) callback(undefined, getKey);
                    if (this._hasEvents) this._rse.trigger("delete", { target: this, tx: msgId, time: Date.now(), data: true });
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("delete", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @param {(err: any) => void} [callback]
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public del(key: K, callback?: (err: any) => void): Promise<any> {
        return this.delete(key, callback);
    }

    /**
     * Put a key and value into the data store.
     * Replaces existing values with new values at the given key, otherwise creates a new key.
     *
     * @param {K} key
     * @param {string} data
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public put(key: K, data: string, callback?: (err: any, response: any) => void): Promise<any> {
        if (key === null || key === undefined) {
            if (callback) callback("Write Error: Key can't be null or undefined!", undefined);
            return Promise.reject("Write Error: Key can't be null or undefined!");
        }

        if (data === null || data === undefined || typeof data !== "string") {
            if (callback) callback("Write Error: Data must be a string!", undefined);
            return Promise.reject("Write Error: Data must be a string!");
        }

        const parseKey = {
            "string": (k) => String(k),
            "float": (k) => isNaN(k) || k === null ? 0 : parseFloat(k),
            "int": (k) => isNaN(k) || k === null ? 0 : parseInt(k)
        };

        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data: any[]) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                    if (callback) callback(data[0], data[1]);
                })

                this._worker.send({ type: "snap-put", key: this.keyType === "any" ? this._anyKey(key) : parseKey[this.keyType](key), value: data, id: msgId });
            } else {
                const msgId = rand();
                try {
                    const put = this._database.put(this.keyType === "any" ? this._anyKey(key) : parseKey[this.keyType](key), data);
                    res(put);
                    if (callback) callback(undefined, put);
                    if (this._hasEvents) this._rse.trigger("put", { target: this, tx: msgId, time: Date.now(), data: put });

                } catch (e) {
                    rej(e);
                    if (callback) callback(e, undefined);
                    if (this._hasEvents) this._rse.trigger("put", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });
    }


    /**
     * API compatible version of batch query from LevelDB.
     *
     * @param {({type: "del"|"put", key: K, value?: string}[])} [ops]
     * @param {(error: any) => void} [callback]
     * @returns {*}
     * @memberof SnapDB
     */
    public batch(ops?: {type: "del"|"put", key: K, value?: string}[], callback?: (error: any) => void): any {
        if (ops) {
            return new Promise((res, rej) => {
                const run = async () => {
                    try {
                        await this.startTx();
                        for (const action of ops) {
                            switch(action.type) {
                                case "del":
                                    await this.del(action.key);
                                break;
                                case "put":
                                    await this.put(action.key, action.value || "");
                                break;
                            }
                        }
                        await this.endTx();
                        if (callback) callback(undefined);
                        res();
                    } catch(e) {
                        if (callback) callback(e);
                        rej(e);
                    }
                }
                const check = () => {
                    if (this._isClosed) return;
                    if (this.isTx) {
                        setTimeout(check, 100);
                    } else {
                        run();
                    }
                }
                check();
            })
        } else {
            let ops: {type: "del"|"put", key: K, value?: string}[] = [];
            const chain = {
                length: 0,
                write: (callback?: (err: any) => void) => {
                    return this.batch(ops, callback);
                },
                del: (key: K) => {
                    ops.push({type: "del", key: key});
                    chain.length = ops.length;
                    return chain;
                },
                put: (key: K, value: string) => {
                    ops.push({type: "put", key: key, value: value});
                    chain.length = ops.length;
                    return chain;
                },
                clear: () => {
                    ops = [];
                    chain.length = 0;
                    return chain;
                }
            }
            return chain;
        }
    }

    private _levelResultMutate(args: QueryArgs<K>) {
        return (key?: K, value?: string) => {
            if (args.values === false && args.keys === false) return {};
            if (args.values === false) return key;
            if (args.keys === false) return value;
            return {key: key, value: value};
        };
    }

    /**
     * LevelDB compatible createReadStream function.
     *
     * @param {QueryArgs<K>} args
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public createReadStream(args: QueryArgs<K>): stream.Readable {
        return this._streamKeysAndValues(args, "read-stream", "read-stream-end", this._levelResultMutate(args));
    }

    /**
     * LevelDB compatible createKeyStream function.
     *
     * @param {QueryArgs<K>} args
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public createKeyStream(args: QueryArgs<K>): stream.Readable {
        const opts = {
            ...args,
            values: false
        };
        return this._streamKeysAndValues(opts, "read-key-stream", "read-key-stream-end", this._levelResultMutate(opts));
    }

    /**
     * LevelDB compatible createValueStream function.
     *
     * @param {QueryArgs<K>} args
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public createValueStream(args: QueryArgs<K>): stream.Readable {
        const opts = {
            ...args,
            keys: false
        };
        return this._streamKeysAndValues(opts, "read-value-stream", "read-value-stream-end", this._levelResultMutate(opts));
    }

    /**
     * Get all keys from the data store in order, or optionally in reverse order.
     *
     * @param {(key: K) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public getAllKeys(onRecord: (key: K) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        this._standardKeysAndValues({ reverse: reverse, values: false }, "get-keys", "get-keys-end", onRecord, onComplete);
    }

    /**
     * Get all keys from the data store in order, or optionally in reverse order.
     * 
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<K>>}
     * @memberof SnapDB
     */
    public getAllKeysIt(reverse?: boolean): Promise<AsyncIterableIterator<K>> {
        return this._iterateKeysAndValues({ reverse: reverse, values: false }, "get-keys", "get-keys-end", true) as any;
    }

    /**
     * 
     *
     * @param {boolean} [reverse]
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public getAllKeysStream(reverse?: boolean): stream.Readable {
        return this._streamKeysAndValues({reverse: reverse, values: false}, "get-keys", "get-keys-end", (key, value) => key);
    }

    /**
     * Get the total number of keys in the data store.
     *
     * @returns {Promise<number>}
     * @memberof SnapDB
     */
    public getCount(callback?: (err: any, count?: number) => void): Promise<number> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(parseInt(data[1]));
                    }
                    if (callback) callback(data[0], data[1] !== undefined ? parseInt(data[1]) : undefined);
                });

                this._worker.send({ type: "snap-count", id: msgId });
            } else {
                const msgId = rand();
                try {
                    const ct = this._database.getCount();
                    res(ct);
                    if (callback) callback(undefined, ct);
                    if (this._hasEvents) this._rse.trigger("get-count", { target: this, tx: msgId, time: Date.now(), data: ct });
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("get-count", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Get all keys and values from the store in order, or optionally in reverse order.
     *
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public getAll(onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        this._standardKeysAndValues({ reverse: reverse }, "get-all", "get-all-end", onRecord, onComplete);
    }

    /**
     * Get all keys and values from the store in order, or optionally in reverse order.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public getAllIt(reverse?: boolean): Promise<AsyncIterableIterator<[K, string]>> {
        return this._iterateKeysAndValues({ reverse: reverse }, "get-all", "get-all-end");
    }

    /**
     * Get all keys and values from the store in order, or optionally in reverse order.
     *
     * @param {boolean} [reverse]
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public getAllStream(reverse?: boolean): stream.Readable {
        return this._streamKeysAndValues({reverse: reverse}, "get-all", "get-all-end");
    }

    /**
     * Gets the keys and values between a given range, inclusive.  Optionally get the range in reverse order.
     *
     * @param {K} lower
     * @param {K} higher
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public range(lower: K, higher: K, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        this._standardKeysAndValues(reverse ? { lte: higher, gt: lower, reverse: true } : { lt: higher, gte: lower }, "get-range", "get-range-end", onRecord, onComplete);
    }

    /**
     * Gets the keys and values between a given range, inclusive.  Optionally get the range in reverse order.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public rangeIt(lower: K, higher: K, reverse?: boolean): Promise<AsyncIterableIterator<[K, string]>> {
        return this._iterateKeysAndValues(reverse ? { lte: higher, gt: lower, reverse: true } : { lt: higher, gte: lower }, "get-range", "get-range-end");
    }

    /**
     * Gets the keys and values between a given range, inclusive.  Optionally get the range in reverse order.
     *
     * @param {K} lower
     * @param {K} higher
     * @param {boolean} [reverse]
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public rangeStream(lower: K, higher: K, reverse?: boolean): stream.Readable {
        return this._streamKeysAndValues(reverse ? { lte: higher, gt: lower, reverse: true } : { lt: higher, gte: lower }, "get-range", "get-range-end");
    }

    /**
     * Get a collection of values from the keys at the given offset/limit. Optionally get the results from the end of the key set.
     * 
     * @param {number} offset
     * @param {number} limit
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public offset(offset: number, limit: number, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        this._standardKeysAndValues({ offset: offset, limit: limit, reverse: reverse }, "get-offset", "get-offset-end", onRecord, onComplete);
    }

    /**
     * Get a collection of values from the keys at the given offset/limit. Optionally get the results from the end of the key set.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public offsetIt(offset: number, limit: number, reverse?: boolean): Promise<AsyncIterableIterator<[K, string]>> {
        return this._iterateKeysAndValues({ offset: offset, limit: limit, reverse: reverse }, "get-offset", "get-offset-end");
    }

    /**
     * Get a collection of values from the keys at the given offset/limit. Optionally get the results from the end of the key set.
     *
     * @param {number} offset
     * @param {number} limit
     * @param {boolean} [reverse]
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public offsetStream(offset: number, limit: number, reverse?: boolean): stream.Readable {
        return this._streamKeysAndValues({ offset: offset, limit: limit, reverse: reverse }, "get-offset", "get-offset-end");
    }

    /**
     * Standard query for data
     *
     * @param {QueryArgs<K>} args
     * @param {((key: K, data: string|undefined) => void)} onRecord
     * @param {(err?: any) => void} onComplete
     * @memberof SnapDB
     */
    public query(args: QueryArgs<K>, onRecord: (key: K, data: string | undefined) => void, onComplete: (err?: any) => void) {
        this._standardKeysAndValues(args, "get-query", "get-query-end", onRecord, onComplete);
    }

    /**
     * Get a collection of values from the keys at the given offset/limit. Optionally get the results from the end of the key set.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public queryIt(args: QueryArgs<K>): Promise<AsyncIterableIterator<[K, string]>> {
        return this._iterateKeysAndValues(args, "get-query", "get-query-end");
    }

    /**
     * Get a collection of values from the keys at the given offset/limit. Optionally get the results from the end of the key set.
     *
     * @param {QueryArgs<K>} args
     * @returns {stream.Readable}
     * @memberof SnapDB
     */
    public queryStream(args: QueryArgs<K>): stream.Readable {
        return this._streamKeysAndValues(args, "get-query", "get-query-end");
    }

    /**
     * Check if a key exists or not.
     *
     * @param {K} key
     * @param {(err: any, exists: boolean) => void} [callback]
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    public exists(key: K, callback?: (err: any, exists?: boolean) => void): Promise<boolean> {
        const getKey = this.keyType === "any" ? this._anyKey(key) : key;
        return this._doWhenReady((res, rej) => {
            if (this._worker) {

                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                    if (callback) callback(data[0], data[1]);
                })

                this._worker.send({ type: "snap-exists", key: getKey, id: msgId });
            } else {

                try {
                    const data = this._database.exists(getKey);
                    res(data);
                    if (callback) callback(undefined, data);
                    if (this._hasEvents) this._rse.trigger("exists", { target: this, tx: rand(), time: Date.now(), data: data });
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("exists", { target: this, tx: rand(), time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Begins a transaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public startTx(callback?: (error: any, txNum?: number) => void): Promise<number> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res();
                    }
                    if (callback) callback(data[0], data[1]);
                })

                this._worker.send({ type: "snap-start-tx", id: msgId });
            } else {
                try {
                    this._database.startTX();
                    res(this._database.txNum);
                    if (callback) callback(undefined, this._database.txNum);
                    if (this._hasEvents) this._rse.trigger("tx-start", { target: this, tx: this._database.txNum, time: Date.now(), data: this._database.txNum });
                    this.isTx = true;
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("tx-start", { target: this, tx: undefined, time: Date.now(), error: e });
                }

            }
        });
    }

    /**
     * Starts a transaction. (depreciated method, use .startTx() instead)
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public begin_transaction(): Promise<any> {
        return this.startTx();
    }

    /**
     * Ends a transaction
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public endTx(callback?: (err: any, txNum?: number) => void): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res();
                    }
                    if (callback) callback(data[0], data[1]);
                })

                this._worker.send({ type: "snap-end-tx", id: msgId });
            } else {
                try {
                    const currentTX = this._database.txNum;
                    this._database.endTX();
                    if (this._hasEvents) this._rse.trigger("tx-end", { target: this, tx: currentTX, time: Date.now(), data: currentTX });
                    res(currentTX);
                    if (callback) callback(undefined, currentTX);
                    this.isTx = false;
                } catch (e) {
                    rej(e);
                    if (callback) callback(e);
                    if (this._hasEvents) this._rse.trigger("tx-end", { target: this, tx: this._database.txNum, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Ends a transaction. (depreciated method, use .endTx() instead)
     *
     * @returns
     * @memberof SnapDB
     */
    public end_transaction(): Promise<any> {
        return this.endTx();
    }

    /**
     * Closes database.  This isn't reversible, you must create a new SnapDB instance if you want to reconnect to this database without restarting your app.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public close(callback?: (error?: any) => void): Promise<any> {

        if (this._isClosed) {
            if (callback) callback();
            return Promise.resolve();
        }

        this._isClosed = true;
        return new Promise((res, rej) => {

            if (this._worker) {
                const msgId = this._msgID((data) => {
                    this._worker.kill();
                    this._isReady = false;
                    if (data[0]) {
                        if (callback) callback(data[0]);
                        rej(data[0])
                    } else {
                        if (callback) callback();
                        res();
                    }
                })
                this._worker.send({ type: "snap-close", id: msgId });
            } else {

                try {
                    this._isReady = false;
                    this._compactor.kill();
                    res(this._database.close());
                    if (callback) callback();
                    if (this._hasEvents) this._rse.trigger("close", { target: this, tx: rand(), time: Date.now() });
                } catch (e) {
                    if (callback) callback(e);
                    rej(e);
                }
            }

        });
    }

    /**
     * Empty all keys and values from database.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public empty(callback?: (err: any) => void): Promise<any> {

        return new Promise((res, rej) => {
            if (!this._isReady) {
                if (callback) callback(undefined);
                res();
                return;
            }
            this._isReady = false;

            // kill compactor thread (don't care what it's doing)
            this._compactor.kill();

            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0])
                    } else {
                        res();
                    }
                    if (callback) callback(data[0]);
                })
                this._worker.send({ type: "snap-clear", id: msgId });
            } else {
                const msgId = rand();
                this._database.clear();

                // spin up new compactor thread
                this._compactor = fork(path.join(__dirname, "compact.js"));
                this._compactor.on("message", this._onCompactorMessage);
                this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: this._autoFlush });
                this._isReady = true;
                if (callback) callback(undefined);
                if (this._hasEvents) this._rse.trigger("clear", { target: this, tx: msgId, time: Date.now() });
            }
        });
    }

    /**
     * Perform an async action after the database is ready.  Does the action right away if the database is already ready.
     *
     * @private
     * @param {(cres: (value?: unknown) => void, crej: (value?: unknown) => void) => void} callback
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    private _doWhenReady(callback: (cres: (value?: unknown) => void, crej: (value?: unknown) => void) => void): Promise<any> {
        return new Promise((res, rej) => {
            if (this._isReady) {
                callback(res, rej);
            } else {
                let fired = false;
                const cb = () => {
                    if (fired) return;
                    fired = true;
                    callback(res, rej);
                    setTimeout(() => {
                        this.off("ready", cb);
                        this.off("clear", cb);
                    }, 100);
                }
                this.on("ready", cb);
                this.on("clear", cb);
            }
        })
    }



    /**
     * Handle messages from the compactor thread.
     *
     * @private
     * @param {*} msg
     * @memberof SnapDB
     */
    private _onCompactorMessage(msg) {
        if (msg.type === "compact-done") {
            this._clearCompactFiles = msg.files;
            if (this._worker) {
                this._worker.send({ type: "compact-done" });
            } else {
                this._database.compactDone();
                this._cleanupCompaction();
            }
        }
    }

    /**
     * Generate a message id and callback for sending messages to the worker thread.
     *
     * @private
     * @param {(data: any) => void} cb
     * @returns
     * @memberof SnapDB
     */
    private _msgID(cb: (data: any) => void) {
        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = cb;
        return msgId;
    }

    /**
     * Make "any" type keys are numbers or strings
     *
     * @private
     * @param {*} key
     * @returns {*}
     * @memberof SnapDB
     */
    private _anyKey(key: any): any {
        const type = typeof key;
        if (type === "string" || type === "number") return key;
        return key !== undefined && key.toString && typeof key.toString === "function" ? key.toString() : String(key);
    }

    /**
     * Handle work after compaction is finished.
     *
     * @private
     * @memberof SnapDB
     */
    private _cleanupCompaction() {
        this.isCompacting = false;
        // safe to remove old files now
        this._clearCompactFiles.forEach((fileID) => {
            try {
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".dta"));
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".idx"));
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".bom"));
            } catch (e) {

            }
        });
        this._clearCompactFiles = [];
        if (this._hasEvents) this._rse.trigger("compact-end", { target: this, time: Date.now() });
        if (this._compactId && messageBuffer[this._compactId]) {
            messageBuffer[this._compactId].apply(null, [undefined]);
            delete messageBuffer[this._compactId];
            this._compactId = "";
        }
    }

    private _streamKeysAndValues(args: QueryArgs<K>, progressEvent: string, doneEvent: string, mutateResult?: (key?: K, value?: string) => any): stream.Readable {
        const s = new stream.Readable();

        this._standardKeysAndValues(args, progressEvent, doneEvent, (key, value) => {
            s.push(mutateResult ? mutateResult(key, value) : [key, value]);
        }, (err) => {
            if (err) {
                s.emit("error", err);
            } else {
                s.push(null);
            }
        });

        return s;
    }

    private _standardKeysAndValues(args: QueryArgs<K>, progressEvent: string, doneEvent: string, onRecord: (key: K | undefined, data: string | undefined) => void, onComplete: (err?: any) => void) {
        this._doWhenReady(() => {
            let i = 0;
            const queryId = rand();
            if (this._worker) {
                this._asyncNewIterator(args).then((id) => {
                    const nextRow = () => {
                        this._asyncNextIterator(id).then((value) => {
                            if (value.done) {
                                onComplete();
                                if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: undefined });
                            } else {
                                if (args.values === false) {
                                    if (this._hasEvents) this._rse.trigger(progressEvent, { target: this, query: args, tx: queryId, time: Date.now(), data: { k: value.key, v: undefined } });
                                    onRecord(args.keys === false ? undefined : value.key, undefined);
                                    i++;
                                    i % 250 ? setImmediate(nextRow) : nextRow();
                                } else {
                                    this.get(value.key).then((val) => {
                                        onRecord(args.keys === false ? undefined : value.key, val);
                                        if (this._hasEvents) this._rse.trigger(progressEvent, { target: this, query: args, tx: queryId, time: Date.now(), data: { k: value.key, v: val } });
                                        i++;
                                        i % 250 ? setImmediate(nextRow) : nextRow();
                                    }).catch((error) => {
                                        if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: error });
                                        onComplete(error);
                                    });
                                }
                            }
                        }).catch((error) => {
                            if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: error });
                            onComplete(error);
                        });
                    }
                    nextRow();
                }).catch((error) => {
                    if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: error });
                    onComplete(error);
                });
            } else {
                try {
                    const id = this._database.newIterator(args);

                    let nextKey = this._database.nextIterator(id);
                    while (!nextKey.done) {
                        if (args.values === false) {
                            onRecord(args.keys === false ? undefined : nextKey.key, undefined);
                        } else {
                            onRecord(args.keys === false ? undefined : nextKey.key, this._database.get(nextKey.key));
                        }
                        nextKey = this._database.nextIterator(id);
                    }
                    this._database.clearIterator(id);
                    onComplete();
                    if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: undefined });
                } catch (e) {
                    onComplete(e);
                    if (this._hasEvents) this._rse.trigger(doneEvent, { target: this, query: args, tx: queryId, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Generate iterable for database queries.
     *
     * @private
     * @param {("all"|"offset"|"range")} mode
     * @param {any[]} args
     * @param {boolean} reverse
     * @param {string} progressEvent
     * @param {string} doneEvent
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    private _iterateKeysAndValues(args: QueryArgs<K>, progressEvent: string, doneEvent: string, keysOnly?: boolean): Promise<AsyncIterableIterator<[K, string]>> {
        return this._doWhenReady((res, rej) => {
            const that = this;
            const loop = async function* () {
                if (that._worker) {
                    const id = await that._asyncNewIterator(args);
                    try {
                        let nextKey = await that._asyncNextIterator(id);
                        let nextValue = nextKey.done || args.values === false ? undefined : await that.get(nextKey.key);
                        while (!nextKey.done) {
                            if (that._hasEvents) that._rse.trigger(progressEvent, { target: that, query: args, tx: id, time: Date.now(), data: { k: nextKey, v: nextValue } });
                            yield keysOnly ? nextKey.key : [args.keys === false ? undefined : nextKey.key, nextValue];
                            nextKey = await that._asyncNextIterator(id);
                            nextValue = nextKey.done || args.values === false ? undefined : await that.get(nextKey.key);
                        }
                        await that._asyncClearIteator(id);
                        if (that._hasEvents) that._rse.trigger(doneEvent, { target: that, query: args, tx: id, time: Date.now(), error: undefined });
                    } catch (e) {
                        if (that._hasEvents) that._rse.trigger(doneEvent, { target: that, query: args, tx: id, time: Date.now(), error: eval });
                        throw e;
                    }

                } else {
                    const id = that._database.newIterator(args);
                    try {
                        let nextKey = that._database.nextIterator(id);
                        let nextValue = nextKey.done || args.values === false ? undefined : await that.get(nextKey.key);
                        while (!nextKey.done) {
                            if (that._hasEvents) that._rse.trigger(progressEvent, { target: that, query: args, tx: id, time: Date.now(), data: { k: nextKey, v: nextValue } });
                            yield keysOnly ? nextKey.key : [args.keys === false ? undefined : nextKey.key, nextValue];
                            nextKey = that._database.nextIterator(id);
                            nextValue = nextKey.done || args.values === false ? undefined : await that.get(nextKey.key);
                        }
                        that._database.clearIterator(id);

                        if (that._hasEvents) that._rse.trigger(doneEvent, { target: that, query: args, tx: id, time: Date.now(), error: undefined });
                    } catch (e) {
                        if (that._hasEvents) that._rse.trigger(doneEvent, { target: that, query: args, tx: id, time: Date.now(), error: e });
                        throw e;
                    }
                }
            };
            res(loop());
        });
    }

    /**
     * Generate new key iterator in the worker thread.
     *
     * @private
     * @param {("all" | "offset" | "range")} mode
     * @param {any[]} args
     * @param {boolean} reverse
     * @returns {Promise<string>}
     * @memberof SnapDB
     */
    private _asyncNewIterator(args: QueryArgs<any>): Promise<string> {
        return new Promise((res, rej) => {
            const msgId = this._msgID((data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            })
            this._worker.send({ type: "snap-new-iterator", args: [args], id: msgId });
        });
    }

    /**
     * Increment the worker thread key iterator.
     *
     * @private
     * @param {string} id
     * @returns {Promise<{ key: K, done: boolean }>}
     * @memberof SnapDB
     */
    private _asyncNextIterator(id: string): Promise<{ key: K, done: boolean }> {
        return new Promise((res, rej) => {
            const msgId = this._msgID((data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            })
            this._worker.send({ type: "snap-next-iterator", args: [id], id: msgId });
        });
    }

    /**
     * Clear an iterator from the worker thread.
     *
     * @private
     * @param {string} id
     * @returns {Promise<void>}
     * @memberof SnapDB
     */
    private _asyncClearIteator(id: string): Promise<void> {
        return new Promise((res, rej) => {
            const msgId = this._msgID((data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res();
                }
            })
            this._worker.send({ type: "snap-clear-iterator", args: [id], id: msgId });
        });
    }

}


/*
function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < Math.ceil(Math.random() * 400) + 100; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}


const db = new SnapDB<number>({dir: "my-db-test", key: "int", mainThread: true, autoFlush: false, cache: true});
console.time("READY");
db.ready().then(() => {
    console.timeEnd("READY");

    let arr: any[] = [];
    let count = 100000;
    for (let i = 0; i < count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }

    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
    const start = Date.now();
    let ct = 0;
    let read = false;
    if (read) {
        db.getAll((key, data) => {
            ct++;
            console.log(key, data);
        }, (err) => {
            if (err) {
                console.log(err);
            }
            const time = (Date.now() - start);
            db.getCount().then((ct) => {
                console.log(ct, "RECORDS");
                console.log(((ct / time) * 1000).toLocaleString(), "Records Per Second (READ)");
                return db.close();
            });
        }, false);
    } else {
        let i = 0;
        db.begin_transaction().then(() => {
            return Promise.all(arr.map(r => db.put(r[0], r[2])))
        }).then(() => {
            return db.end_transaction();
        }).then(() => {
            console.log((count / (Date.now() - writeStart) * 1000).toLocaleString(), "Records Per Second (WRITE)");
            const start = Date.now();
            let ct = 0;
            db.getAll((key, data) => {
                ct++;
                // console.log(key, data);
            }, (err) => {
                if (err) {
                    console.log(err);
                }
                const time = (Date.now() - start);
                db.getCount().then((ct) => {
                    console.log(((ct / time) * 1000).toLocaleString(), "Records Per Second (READ)");
                    // return db.close();
                });
            }, false);
        }).catch((err) => {
            console.trace(err);
        })
    }
});*/