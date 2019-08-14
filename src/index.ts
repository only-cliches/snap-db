import * as path from "path";
import { fork, ChildProcess } from "child_process";
import { VERSION, fileName as fNameFN } from "./common";
import { ReallySmallEvents } from "./rse";
import * as fs from "fs";
import { SnapDatabase } from "./database";

const messageBuffer: {
    [messageId: string]: (values: string[]) => void;
} = {};

export const rand = () => {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 6; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

export interface SnapEvent {
    target: SnapDB<any>,
    time: number,
    [key: string]: any;
}

export class SnapDB<K> {

    private _isReady: boolean;
    private _path: string;
    private _worker: ChildProcess;
    private _compactor: ChildProcess;
    public version: number = VERSION;
    private _rse: ReallySmallEvents;
    private _hasEvents: boolean = false;
    public isCompacting: boolean = false;
    public isTx: boolean = false;
    public clearCompactFiles: number[] = [];
    private _compactId: string;
    public keyType: "string" | "float" | "int";
    public memoryCache?: boolean;
    private _database: SnapDatabase;
    private _autoFlush: boolean | number;

    /**
     *Creates an instance of SnapDB.
     * @param {({
     *         dir: string,
     *         key: "string" | "float" | "int",
     *         cache?: boolean,
     *         autoFlush?: number|boolean,
     *         singleThread?: boolean
     *     })} args
     * @memberof SnapDB
     */
    constructor(args: {
        dir: string,
        key: "string" | "float" | "int",
        cache?: boolean,
        autoFlush?: number | boolean,
        mainThread?: boolean
    } | string, keyType?: "string" | "float" | "int", cache?: boolean) {

        this._autoFlush = true;
        this._onCompactorMessage = this._onCompactorMessage.bind(this);

        if (typeof args === "string") {
            this._path = args;
            this.keyType = keyType || "string";
            this.memoryCache = cache || false;
            this._worker = fork(path.join(__dirname, "database.js"));
            console.warn("This initialization for SnapDB is depreciated, please read documentation for new arguments!");

        } else {
            this._path = path.resolve(args.dir);
            this.keyType = args.key;
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
        this.clearCompactFiles = [];

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
                        this._isReady = true;

                        this._compactor = fork(path.join(__dirname, "compact.js"));
                        this._compactor.on("message", this._onCompactorMessage);

                        messageBuffer[msg.id].apply(null, [msg.data]);
                        delete messageBuffer[msg.id];
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

        const checkReady = () => {
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

        this._compactor.on("message", this._onCompactorMessage);
        this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: this._autoFlush });
    }

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

    private _cleanupCompaction() {
        this.isCompacting = false;
        // safe to remove old files now
        this.clearCompactFiles.forEach((fileID) => {
            try {
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".dta"));
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".idx"));
                fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".bom"));
            } catch (e) {

            }
        });
        this.clearCompactFiles = [];
        if (this._hasEvents) this._rse.trigger("compact-end", { target: this, time: Date.now() });
        if (this._compactId && messageBuffer[this._compactId]) {
            messageBuffer[this._compactId].apply(null, [undefined]);
            delete messageBuffer[this._compactId];
            this._compactId = "";
        }
    }

    /**
     * Forces the log to be flushed to disk files, possibly causing a compaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public flushLog(): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this.isCompacting === true) {
                rej("Already compacting!");
                return;
            }
            this.isCompacting = true;

            if (this._worker) {
                this._worker.send({ type: "do-compact" });
            } else {
                this._database.flushLog(true);
                this._compactor.send("do-compact");
            }

            const checkDone = () => {
                if (this.isCompacting) {
                    setTimeout(checkDone, 100);
                } else {
                    res();
                }
            }
            checkDone();
        })
    }

    /**
     * This promise returns when the database is ready to use.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public ready(): Promise<any> {
        return new Promise((res, rej) => {
            const readyCB = () => {
                this.off("ready", readyCB);
                res();
            }
            this.on("ready", readyCB);
        });
    }

    private _msgID(cb: (data: any) => void) {
        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = cb;
        return msgId;
    }

    public get(key: K): Promise<string> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                })

                this._worker.send({ type: "snap-get", key: key, id: msgId });
            } else {
                const msgId = rand();
                try {
                    const data = this._database.get(key);
                    res(data);
                    if (this._hasEvents) this._rse.trigger("get", { target: this, tx: msgId, time: Date.now(), data: data });
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("get", { target: this, tx: msgId, time: Date.now(), error: e });
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
    public delete(key: K): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                })

                this._worker.send({ type: "snap-del", key: key, id: msgId });
            } else {
                const msgId = rand();
                try {
                    res(this._database.delete(key));
                    if (this._hasEvents) this._rse.trigger("delete", { target: this, tx: msgId, time: Date.now(), data: true });
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("delete", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });

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
    public put(key: K, data: string): Promise<any> {

        const parseKey = {
            "string": (k) => String(k),
            "float": (k) => isNaN(k) || k === null ? 0 : parseFloat(k),
            "int": (k) => isNaN(k) || k === null ? 0 : parseInt(k)
        };

        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(data[1]);
                    }
                })

                this._worker.send({ type: "snap-put", key: parseKey[this.keyType](key), value: data, id: msgId });
            } else {
                const msgId = rand();
                try {
                    res(this._database.put(parseKey[this.keyType](key), data));
                    if (this._hasEvents) this._rse.trigger("put", { target: this, tx: msgId, time: Date.now(), data: true });
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("put", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Get all keys from the data store in order.
     *
     * @param {(key: K) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public getAllKeys(onRecord: (key: K) => void, onComplete: (err?: any) => void, reverse?: boolean) {

        this._doWhenReady(() => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) { // error complete
                        onComplete(data[0]);
                    } else if (data[1] !== undefined) { // key
                        onRecord(data[1]);
                    } else {
                        onComplete();
                    }
                })

                this._worker.send({ type: "snap-get-all-keys", id: msgId, reverse });
            } else {
                const msgId = rand();
                this._database.getAllKeys((key) => {
                    onRecord(key);
                    if (this._hasEvents) this._rse.trigger("get-keys", { target: this, tx: msgId, time: Date.now(), data: key });
                }, (err) => {
                    onComplete(err)
                    if (this._hasEvents) this._rse.trigger("get-keys-end", { target: this, tx: msgId, time: Date.now(), error: err });
                }, reverse || false);
            }
        });
    }

    /**
     * Async Iterable version of get all keys.
     * 
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<K>>}
     * @memberof SnapDB
     */
    public getAllKeysAsync(reverse?: boolean):Promise<AsyncIterableIterator<K>>  {
        return new Promise((res, rej) => {
            let keys: any[] = [];
            this.getAllKeys((key) => {
                keys.push(key);
            }, () => {
                async function* loopKeys() {
                    let i = 0;
                    while(i < keys.length) {
                        yield keys[i];
                        i++;
                    }
                }
                res(loopKeys());
            }, reverse);
        })
    }

    /**
     * Starts a transaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public begin_transaction(): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res();
                    }
                })

                this._worker.send({ type: "snap-start-tx", id: msgId });
            } else {
                try {
                    this._database.startTX();
                    res(this._database.txNum);
                    if (this._hasEvents) this._rse.trigger("tx-start", { target: this, tx: this._database.txNum, time: Date.now(), data: this._database.txNum });
                    this.isTx = true;
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("tx-start", { target: this, tx: undefined, time: Date.now(), error: e });
                }

            }
        });
    }

    /**
     * Ends a transaction.
     *
     * @returns
     * @memberof SnapDB
     */
    public end_transaction(): Promise<any> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res();
                    }
                })

                this._worker.send({ type: "snap-end-tx", id: msgId });
            } else {
                try {
                    const currentTX = this._database.txNum;
                    this._database.endTX();
                    if (this._hasEvents) this._rse.trigger("tx-end", { target: this, tx: currentTX, time: Date.now(), data: currentTX });
                    res(currentTX);
                    this.isTx = false;
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("tx-end", { target: this, tx: this._database.txNum, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Get the total number of keys in the data store.
     *
     * @returns {Promise<number>}
     * @memberof SnapDB
     */
    public getCount(): Promise<number> {
        return this._doWhenReady((res, rej) => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) {
                        rej(data[0]);
                    } else {
                        res(parseInt(data[1]));
                    }
                });

                this._worker.send({ type: "snap-count", id: msgId });
            } else {
                const msgId = rand();
                try {
                    const ct = this._database.getCount();
                    res(ct);
                    if (this._hasEvents) this._rse.trigger("get-count", { target: this, tx: msgId, time: Date.now(), data: ct });
                } catch (e) {
                    rej(e);
                    if (this._hasEvents) this._rse.trigger("get-count", { target: this, tx: msgId, time: Date.now(), error: e });
                }
            }
        });
    }

    /**
     * Get all keys and values from the store in order.
     *
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    public getAll(onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {

        this._doWhenReady(() => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) { // error complete
                        onComplete(data[0]);
                    } else if (data[1]) { // key/value
                        onRecord(data[1].k, data[1].v);
                    } else {
                        onComplete();
                    }
                })

                this._worker.send({ type: "snap-get-all", id: msgId, reverse });
            } else {
                const msgId = rand();
                this._database.getAll((key, data) => {
                    onRecord(key, data);
                    if (this._hasEvents) this._rse.trigger("get-all", { target: this, tx: msgId, time: Date.now(), data: { k: key, v: data } });
                }, (err) => {
                    onComplete(err);
                    if (this._hasEvents) this._rse.trigger("get-all-end", { target: this, tx: msgId, time: Date.now(), error: err });
                }, reverse || false);
            }
        });
    }

    /**
     * Async Iterable version of getAll.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public getAllAsync(reverse?: boolean):Promise<AsyncIterableIterator<[K, string]>>  {
        return new Promise((res, rej) => {
            let values: any[] = [];
            this.getAll((key, value) => {
                values.push([key, value]);
            }, (err) => {
                if (err) {
                    rej(err);
                    return;
                }
                async function* loopValues() {
                    let i = 0;
                    while(i < values.length) {
                        yield values[i];
                        i++;
                    }
                }
                res(loopValues());
            }, reverse);
        })
    }

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
    public range(lower: K, higher: K, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {

        this._doWhenReady(() => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) { // error complete
                        onComplete(data[0]);
                    } else if (data[1]) { // key/value
                        onRecord(data[1].k, data[1].v);
                    } else {
                        onComplete();
                    }
                })

                this._worker.send({ type: "snap-get-range", id: msgId, lower, higher, reverse });
            } else {
                const msgId = rand();
                this._database.getRange(lower, higher, (key, data) => {
                    onRecord(key, data);
                    if (this._hasEvents) this._rse.trigger("get-range", { target: this, tx: msgId, time: Date.now(), data: { k: key, v: data } });
                }, (err) => {
                    onComplete(err);
                    if (this._hasEvents) this._rse.trigger("get-range-end", { target: this, tx: msgId, time: Date.now(), error: err });
                }, reverse || false);
            }
        });
    }

    /**
     * Async Iterable version of range.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public rangeAsync(lower: K, higher: K, reverse?: boolean):Promise<AsyncIterableIterator<[K, string]>>  {
        return new Promise((res, rej) => {
            let values: any[] = [];
            this.range(lower, higher, (key, value) => {
                values.push([key, value]);
            }, (err) => {
                if (err) {
                    rej(err);
                    return;
                }
                async function* loopValues() {
                    let i = 0;
                    while(i < values.length) {
                        yield values[i];
                        i++;
                    }
                }
                res(loopValues());
            }, reverse);
        })
    }

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
    public offset(offset: number, limit: number, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {

        this._doWhenReady(() => {
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    if (data[0]) { // error complete
                        onComplete(data[0]);
                    } else if (data[1]) { // key/value
                        onRecord(data[1].k, data[1].v);
                    } else {
                        onComplete();
                    }
                })

                this._worker.send({ type: "snap-get-offset", id: msgId, offset, limit, reverse });
            } else {
                const msgId = rand();
                this._database.getOffset(offset, limit, (key, data) => {
                    onRecord(key, data);
                    if (this._hasEvents) this._rse.trigger("get-offset", { target: this, tx: msgId, time: Date.now(), data: { k: key, v: data } });
                }, (err) => {
                    onComplete(err);
                    if (this._hasEvents) this._rse.trigger("get-offset-end", { target: this, tx: msgId, time: Date.now(), error: err });
                }, reverse || false);
            }
        });

    }

    /**
     * Async Iterable version of offset.
     *
     * @param {boolean} [reverse]
     * @returns {Promise<AsyncIterableIterator<[K, string]>>}
     * @memberof SnapDB
     */
    public offsetAsync(offset: number, limit: number, reverse?: boolean):Promise<AsyncIterableIterator<[K, string]>>  {
        return new Promise((res, rej) => {
            let values: any[] = [];
            this.offset(offset, limit, (key, value) => {
                values.push([key, value]);
            }, (err) => {
                if (err) {
                    rej(err);
                    return;
                }
                async function* loopValues() {
                    let i = 0;
                    while(i < values.length) {
                        yield values[i];
                        i++;
                    }
                }
                res(loopValues());
            }, reverse);
        })
    }

    /**
     * Closes database
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public close(): Promise<any> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                res();
                return;
            }
            if (this._worker) {
                const msgId = this._msgID((data) => {
                    this._worker.kill();
                    this._isReady = false;
                    if (data[0]) {
                        rej(data[0])
                    } else {
                        res();
                    }
                })
                this._worker.send({ type: "snap-close", id: msgId });
            } else {

                try {
                    this._isReady = false;
                    this._compactor.kill();
                    res(this._database.close());
                    if (this._hasEvents) this._rse.trigger("close", { target: this, tx: rand(), time: Date.now() });
                } catch (e) {
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
    public empty(): Promise<any> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
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
                if (this._hasEvents) this._rse.trigger("clear", { target: this, tx: msgId, time: Date.now() });
            }
        });
    }

    private _onCompactorMessage(msg) {
        if (msg.type === "compact-done") {
            this.clearCompactFiles = msg.files;
            if (this._worker) {
                this._worker.send({ type: "compact-done" });
            } else {
                this._database.compactDone();
                this._cleanupCompaction();
            }
        }
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