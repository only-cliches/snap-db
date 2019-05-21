import * as path from "path";
import { fork, ChildProcess } from "child_process";

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

export class SnapDB<K> {

    private _isReady: boolean;
    private _path: string;
    private _worker: ChildProcess;

    /**
     * Creates an instance of SnapDB.
     * 
     * @param {string} fileName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    constructor(
        fileName: string,
        public keyType: "string" | "float" | "int",
        public memoryCache?: boolean
    ) {

        this._path = fileName === ":memory:" ? fileName : (path.isAbsolute(fileName) ? fileName : path.join(process.cwd(), fileName));

        this._worker = fork(path.join(__dirname, "child.js"));

        this._worker.on("message", (msg) => { // got message from worker
            switch (msg.type) {
                case "snap-ready":
                    this._isReady = true;
                    break;
                case "snap-res":
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    break;
                case "snap-res-done":
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    break;
            }
        });
        this._worker.send({ type: "snap-connect", path: this._path, cache: this.memoryCache, keyType: this.keyType });
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

            this._worker.send({ type: "snap-put", key: key, value: data, id: msgId });
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

            this._worker.send({ type: "snap-clear", id: msgId });
        });
    }

}


/*
function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

const db = new SnapDB<number>("my-db-test", "int");
db.ready().then(() => {
    console.log("READY");

    let arr: any[] = [];
    let count = 10000;
    for (let i = 0; i < count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }

    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
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
            });
        }, false);
    })
});*/