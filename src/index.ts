import * as wasm from "./db.js";
import * as path from "path";
import * as fs from "fs";

export class SnapDB<K> {

    private _isReady: boolean;
    private _indexNum: number;
    public _dbNum: number;
    private _path: string;
    private _cache: {[key: string]: string} = {};

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

        this._checkWasmReady();
    }

    /**
     * Loads previously saved data into cache if cache is enabled.
     *
     * @private
     * @param {() => void} complete
     * @param {(err) => void} onErr
     * @returns
     * @memberof SnapDB
     */
    private _loadCache(complete: () => void, onErr: (err) => void) {

        const wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        const total = wasmFNs[this.keyType](this._indexNum);

        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }

        this.getAllKeys((key) => {
            this._cache[String(key)] = wasm.database_get(this._dbNum, String(key));
        }, () => {
            complete();
        });
    } 

    /**
     * Check if WASM module has been initiliazed.
     *
     * @private
     * @memberof SnapDB
     */
    private _checkWasmReady() {
        const checkReady = () => {
            if (wasm.loaded) {
        
                const dbData = wasm.database_create(this._path, {"float": 0, "string": 1, "int": 2}[this.keyType]);
                if (!dbData) {
                    throw new Error("Unable to connect to database at " + this._path);
                }
                this._indexNum = parseInt(dbData.split(",")[1]);
                this._dbNum = parseInt(dbData.split(",")[0]);

                this._loadKeys();
            } else {
                setTimeout(checkReady, 100);
            }
        }
        checkReady();
    }

    /**
     * Get all the keys from unqlite and load them into index
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeys() {

        const ptr = wasm.database_cursor(this._dbNum);
        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;
        
        while(!isDone) {
            nextKey = wasm.database_cursor_next(this._dbNum, ptr, count);
            if (count === 0 && !nextKey) {
                isDone = true;
            } else {
                if (nextKey === lastKey) {
                    isDone = true;
                } else {  
                    const dataKey = this.keyType === "string" ? nextKey : parseFloat(nextKey);
                    // write key to memory
                    const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    if (nextKey !== "") {
                        this._cache[String(nextKey)] = "";
                        wasmFNs[this.keyType](this._indexNum, dataKey);
                    }
                    lastKey = nextKey;
                }
                count++;
            }
        }
        if (this.memoryCache) {
            this._loadCache(() => {
                this._isReady = true;
            }, (err) => {
                throw new Error(err);
            })
        } else {
            this._isReady = true;
        }
        
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


    public get(key: K): string {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        if (typeof this._cache[String(key)] && this._cache[String(key)].length) {
            return this._cache[String(key)];
        }
        return wasm.database_get(this._dbNum, String(key));
    }

    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    public delete(key: K): number {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }

        // delete key from memory
        const wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
        wasmFNs[this.keyType](this._indexNum, key);

        // delete key from database
        const result = wasm.database_del(this._dbNum, String(key));
        delete this._cache[String(key)];
        if (result === 1) {
            throw new Error("Unable to delete key! " + key);
        }
        return 0;
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
    public put(key: K, data: string): number {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }

        // write key to memory
        const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
        wasmFNs[this.keyType](this._indexNum, key);
        

        // write data to database
        const result = wasm.database_put(this._dbNum, this._cache[String(key)] === undefined ? 1 : 0, String(key), data);
        this._cache[String(key)] = this.memoryCache ? data : "";

        if (result === 0) {
            return 0;
        } else {
            throw new Error("Error writing value!");
        }
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

        const wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        const wasmFNs2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };

        const it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0);
        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;
        
        while(!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            } else {
                count++;
                onRecord(nextKey);
                lastKey = nextKey;
            }
        }
        onComplete();
    }

    public begin_transaction() {
        wasm.database_start_tx(this._indexNum);
    }

    public end_transaction() {
        wasm.database_end_tx(this._indexNum);
    }

    /**
     * Get the total number of keys in the data store.
     *
     * @returns {number}
     * @memberof SnapDB
     */
    public getCount(): number {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        const wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        return wasmFNs[this.keyType](this._indexNum);
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
        const wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        const wasmFNs2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };

        const it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0);
        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;
        
        while(!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            } else {
                if (this._cache[String(nextKey)] !== undefined) {
                    onRecord(nextKey, this.get(nextKey));
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
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
        const wasmFNs = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
        const wasmFNs2 = { "string": wasm.read_index_range_str_next, "int": wasm.read_index_range_int_next, "float": wasm.read_index_range_next };

        const it = wasmFNs[this.keyType](this._indexNum, lower, higher, reverse ? 1 : 0);

        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;
        
        while(!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            } else {
                if (this._cache[String(nextKey)] !== undefined) {
                    onRecord(nextKey, this.get(nextKey));
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
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
        const wasmFNs = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
        const wasmFNs2 = { "string": wasm.read_index_offset_str_next, "int": wasm.read_index_offset_int_next, "float": wasm.read_index_offset_next };

        const it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0, offset);
        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;
        
        while(!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, limit, count);
            if (nextKey === lastKey) {
                isDone = true;
            } else {
                if (this._cache[String(nextKey)] !== undefined) {
                    onRecord(nextKey, this.get(nextKey));
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
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

    let arr: any[] = [];
    let count = 10000;
    for (let i = 1; i <= count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }

    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
    db.begin_transaction();
    arr.forEach(r => {
        if (r[0] === 1029) {
            last = r[0];
            // console.log(r[2]);
        }
        db.put(r[0], r[2]);
    })
    db.end_transaction();
    console.log((count / (Date.now() - writeStart) * 1000).toLocaleString(), "Records Per Second (WRITE)");
    const start = Date.now();
    console.time("READ");
    db.getAll((key, data) => {
        // console.log(key, data);
    }, (err) => {
        if (err) {
            console.log(err);
        }
        console.log((db.getCount() / (Date.now() - start) * 1000).toLocaleString(), "Records Per Second (READ)");
    }, false);

});*/