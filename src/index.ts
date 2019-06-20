import * as path from "path";
import { fork, ChildProcess } from "child_process";
import { VERSION, fileName as fNameFN } from "./common";
import { ReallySmallEvents } from "./rse";
import * as fs from "fs";
import { Agent } from "http";


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

    /**
     *Creates an instance of SnapDB.
     * @param {({
     *         dir: string,
     *         key: "string" | "float" | "int",
     *         cache?: boolean,
     *         autoFlush?: number|boolean
     *     })} args
     * @memberof SnapDB
     */
    constructor(args: {
        dir: string,
        key: "string" | "float" | "int",
        cache?: boolean,
        autoFlush?: number|boolean
    }) {

        this._path = path.resolve(args.dir);
        this.keyType = args.key;
        this.memoryCache = args.cache || false;
        this._rse = new ReallySmallEvents();

        this._worker = fork(path.join(__dirname, "database.js"));
        this._compactor = fork(path.join(__dirname, "compact.js"));
        this.clearCompactFiles = [];
        
        const autoFlush = typeof args.autoFlush === "undefined" ? true : args.autoFlush;

        this._worker.on("message", (msg) => { // got message from worker
            switch (msg.type) {
                case "snap-ready":
                    this._isReady = true;
                    break;
                case "snap-compact":
                    this.isCompacting = true;
                    this._compactor.send("do-compact");
                    if (this._hasEvents) this._rse.trigger("compact-start", {target: this, time: Date.now()});
                    break;
                case "snap-compact-done":
                    this.isCompacting = false;
                    // safe to remove old files now
                    this.clearCompactFiles.forEach((fileID) => {
                        try {
                            fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".dta"));
                            fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".idx"));
                            fs.unlinkSync(path.join(this._path, fNameFN(fileID) + ".bom"));
                        } catch(e) {

                        }
                    });
                    this.clearCompactFiles = [];
                    if (this._hasEvents) this._rse.trigger("compact-end", {target: this, time: Date.now()});
                    if (this._compactId && messageBuffer[this._compactId]) {
                        messageBuffer[this._compactId].apply(null, [undefined]);
                        delete messageBuffer[this._compactId];
                        this._compactId = "";
                    }
                    break;
                case "snap-res":
                    if (msg.event && this._hasEvents) {
                        this._rse.trigger(msg.event, {target: this, time: Date.now(), data: msg.data});
                    }
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    break;
                case "snap-res-done":
                    if (msg.event && this._hasEvents) {
                        this._rse.trigger(msg.event, {target: this, time: Date.now(), data: msg.data});
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
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    if (this._hasEvents) this._rse.trigger("clear", {target: this, time: Date.now()});
                    break;
                case "snap-close-done":
                    this._isReady = false;
                    this._compactor.kill();
                    this._worker.kill();
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    if (this._hasEvents) this._rse.trigger("close", {target: this, time: Date.now()});
                    break;
            }
        });
        this._compactor.on("message", (msg) => {
            if (msg.type === "compact-done") {
                this.clearCompactFiles = msg.files;
                this._worker.send({type: "compact-done"});
            }
        });
        this._worker.send({ type: "snap-connect", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: autoFlush });
        this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType, autoFlush: autoFlush });
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
    public flushLog():Promise<any> {
        return new Promise((res, rej) => {
            if (this.isCompacting === true) {
                rej("Already compacting!");
                return;
            }
            this.isCompacting = true;
            this._worker.send({type: "do-compact"});

            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }
            this._compactId = msgId;
            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            }
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
            const checkReady = () => {
                if (this._isReady) {
                    this._rse.trigger("ready", {target: this, time: Date.now()});
                    res();
                } else {
                    setTimeout(checkReady, 100);
                }
            }
            checkReady();
        });
    }


    public get(key: K): Promise<string> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            }

            this._worker.send({ type: "snap-get", key: key, id: msgId });
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
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            }

            this._worker.send({ type: "snap-del", key: key, id: msgId });
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
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(data[1]);
                }
            }

            const parseKey = {
                "string": (k) => String(k),
                "float": (k) => isNaN(k) || k === null ? 0 : parseFloat(k),
                "int":  (k) => isNaN(k) || k === null ? 0 : parseInt(k)
            };

            this._worker.send({ type: "snap-put", key: parseKey[this.keyType](key), value: data, id: msgId });
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
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }

        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = (data) => {
            if (data[0] === "response") {
                onRecord(data[1] as any);
            } else {
                onComplete();
            }
        }

        this._worker.send({ type: "snap-get-all-keys", id: msgId, reverse });
    }

    /**
     * Starts a transaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    public begin_transaction(): Promise<any> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }

            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res();
                }
            }
            this._worker.send({ type: "snap-start-tx", id: msgId });
        });
    }

    /**
     * Ends a transaction.
     *
     * @returns
     * @memberof SnapDB
     */
    public end_transaction(): Promise<any> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }

            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res();
                }
            }
            this._worker.send({ type: "snap-end-tx", id: msgId });
        });

    }

    /**
     * Get the total number of keys in the data store.
     *
     * @returns {Promise<number>}
     * @memberof SnapDB
     */
    public getCount(): Promise<number> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }

            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0]);
                } else {
                    res(parseInt(data[1]));
                }
            }

            this._worker.send({ type: "snap-count", id: msgId });
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
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }

        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = (data) => {
            if (data[0] === "response") {
                onRecord(data[1] as any, data[2]);
            } else {
                onComplete();
            }
        }

        this._worker.send({ type: "snap-get-all", id: msgId, reverse });
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
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }

        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = (data) => {
            if (data[0] === "response") {
                onRecord(data[1] as any, data[2]);
            } else {
                onComplete();
            }
        }

        this._worker.send({ type: "snap-get-range", id: msgId, lower, higher, reverse });

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
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }

        let msgId = rand();
        while (messageBuffer[msgId]) {
            msgId = rand();
        }

        messageBuffer[msgId] = (data) => {
            if (data[0] === "response") {
                onRecord(data[1] as any, data[2]);
            } else {
                onComplete();
            }
        }

        this._worker.send({ type: "snap-get-offset", id: msgId, offset, limit, reverse });
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
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }
            messageBuffer[msgId] = (data) => {
                this._worker.kill();
                this._isReady = false;
                if (data[0]) {
                    rej(data[0])
                } else {
                    res();
                }
            }
            this._worker.send({ type: "snap-close", id: msgId });
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
            let msgId = rand();
            while (messageBuffer[msgId]) {
                msgId = rand();
            }
            messageBuffer[msgId] = (data) => {
                if (data[0]) {
                    rej(data[0])
                } else {
                    res();
                }
            }

            // kill compactor thread (don't care what it's doing)
            this._compactor.kill();

            // spin up new compactor thread
            this._compactor = fork(path.join(__dirname, "compact.js"));
            this._compactor.on("message", (msg) => {
                if (msg.type === "compact-done") {
                    this.clearCompactFiles = msg.files;
                    this._worker.send({type: "compact-done"});
                }
            });
            this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType });

            this._worker.send({ type: "snap-clear", id: msgId });
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


const db = new SnapDB<number>("my-db-test", "int", false);
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
            // console.log(key, data);
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
        db.begin_transaction().then(() => {
            return Promise.all(arr.map(r => {
                return db.put(r[0], r[2]);
            }))
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
                    return db.close();
                });
            }, false);
        }).catch((err) => {
            console.trace()
        })
    }
});*/