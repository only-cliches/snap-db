import * as wasm from "./db-index.js";
import * as path from "path";
import * as fs from "fs";

export class SnapDB<K> {

    private _isReady: boolean;
    private _indexNum: number;
    private _currentFileIdx: number = 0;
    private _currentFileLen: number = 0;
    private _path: string;
    private _dataFiles: number[] = [];
    private _keyStream: fs.WriteStream;
    private _tombStream: fs.WriteStream;
    private _dataStreams: fs.WriteStream[] = [];
    private _cache: {[key: string]: string} = {};
    private _keyData: {[key: string]: [number, number, number]} = {};

    /**
     * Creates an instance of SnapDB.
     * 
     * @param {string} folderName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    constructor(
        folderName: string,
        public keyType: "string" | "float" | "int",
        public memoryCache?: boolean
    ) {

        this._path = path.isAbsolute(folderName) ? folderName : path.join(process.cwd(), folderName);

        // create the database folder if it's not already in place
        const exists = fs.existsSync(this._path);

        if (exists) {
            this._checkWasmReady();
        } else {
            fs.mkdir(this._path, (err) => {
                if (err) {
                    throw err;
                } else {
                    this._checkWasmReady();
                }
            });
        }
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
        let allDone = false;
        let count = 0;
        let hasErr = false;
        const wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        const total = wasmFNs[this.keyType](this._indexNum);
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }

        this.getAllKeys((key) => {
            if (hasErr) return;
            count++;
            const setKey = this._makeKey(key);
            this._readValue(setKey, false, (err, data) => {
                if (err) {
                    hasErr = true;
                    onErr(err);
                } else {
                    this._cache[setKey] = data;
                    count--;
                    if (count === 0 && allDone) {
                        complete();
                    }
                }
            });
        }, () => {
            if (hasErr) return;
            allDone = true;
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
                switch (this.keyType) {
                    case "string":
                        this._indexNum = wasm.new_index_str();
                        break;
                    case "int":
                        this._indexNum = wasm.new_index_int();
                        break;
                    case "float":
                        this._indexNum = wasm.new_index();
                        break;
                }
                this._loadIndexFromDisk();
            } else {
                setTimeout(checkReady, 100);
            }
        }
        checkReady();
    }

    /**
     * Loads previously created database details into disk.
     * Optionally loads cache from disk.
     *
     * @private
     * @memberof SnapDB
     */
    private _loadIndexFromDisk() {
        Promise.all([0, 1, 2].map((s) => {
            return new Promise((res, rej) => {
                switch (s) {
                    case 0:
                        const exists = fs.existsSync(path.join(this._path, ".keys"));
    
                        fs.open(path.join(this._path, ".keys"), "a", (err, fd) => {
                            if (err) {
                                rej(err);
                                return;
                            }
                            if (!exists) {
                                this._keyStream = fs.createWriteStream(path.join(this._path, ".keys"), {autoClose: false, flags: "r+"});
                                // new key file
                                this._keyStream.write(this.keyType + "\n", "utf8", (err) => {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    res();
                                })
                            } else {
                                
                                const writeKeys = (keys: string[]) => {
                                    for (let i = 0; i < keys.length; i++) {
                                        if (keys[i].trim().length) {
                                            const keyData: [any, [number, number, number]] = keys[i].trim().split("::").map((s, k) => {
                                                if (k === 0) {
                                                    if (this.keyType !== "string") {
                                                        return parseFloat(s);
                                                    }
                                                    return Buffer.from(s, "hex").toString("utf8");
                                                } else {
                                                    return s.split(/,/gmi).map(s => parseInt(s));
                                                }
    
                                            }) as any;
     
                                            const totalVals = keyData[1][0] + keyData[1][1] + keyData[1][2];
                                            const useKey = this._makeKey(keyData[0]);
                                            if (totalVals === 0) { // deleted key
                                                const wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                                                wasmFNs[this.keyType](this._indexNum, keyData[0]);
                                                delete this._keyData[useKey];
                                            } else { // new key value
                                                const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                                                wasmFNs[this.keyType](this._indexNum, keyData[0]);
                                                this._keyData[useKey] = keyData[1];
                                            }
                                        }
                                    }
                                }
                                // restore keys to memory
                                fs.readFile(path.join(this._path, ".keys"), (err, data) => {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    this._keyStream = fs.createWriteStream(path.join(this._path, ".keys"), {start: data.length, autoClose: false, flags: "r+"});
                                    const keys = data.toString().split(/\n/gmi);
                                    this.keyType = (keys.shift() as any).trim();
                                    writeKeys(keys);
                        
                                    fs.readFile(path.join(this._path, ".tombs"), (err, data) => {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        const keys = data.toString().split(/\n/gmi);
                                        writeKeys(keys);
                                        res();
                                    });
                                })
                            }

                        });
                        break;
                    case 1:
                        const attach = () => {
                            const exists = fs.existsSync(path.join(this._path, this._currentFileIdx + ".data"));
                            if (!exists && this._currentFileIdx === 0) { // initial startup
                                fs.open(path.join(this._path, this._currentFileIdx + ".data"), "w+", (err, fd) => {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    this._dataFiles[this._currentFileIdx] = fd;
                                    this._dataStreams[this._currentFileIdx] = fs.createWriteStream(path.join(this._path, this._currentFileIdx + ".data"), {autoClose: false, flags: "r+"});
                                    res();
                                });
                            } else { // subsequent
                                if (exists) {
                                    fs.open(path.join(this._path, this._currentFileIdx + ".data"), "r+", (err, fd) => {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        this._dataFiles[this._currentFileIdx] = fd;
                                        this._currentFileIdx++;
                                        attach();
                                    });
                                } else {
                                    // found latest data file, prepare to write to it
                                    this._currentFileIdx--;
                                    fs.fstat(this._dataFiles[this._currentFileIdx], (err, stats) => {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        this._dataStreams[this._currentFileIdx] = fs.createWriteStream(path.join(this._path, this._currentFileIdx + ".data"), {autoClose: false, start: stats.size, flags: "r+"});
                                        this._currentFileLen = stats.size;
                                        res();
                                    });
                                }
                            }

                        }
                        attach();

                        break;
                    case 2:
                        const tombsExist = fs.existsSync(path.join(this._path, ".tombs"));
                        if (tombsExist) {
                            const tombLength = fs.statSync(path.join(this._path, ".tombs")).size;
                            this._tombStream = fs.createWriteStream(path.join(this._path, ".tombs"), {autoClose: false, start: tombLength, flags: "r+"});
                        } else {
                            fs.writeFileSync(path.join(this._path, ".tombs"), "");
                            this._tombStream = fs.createWriteStream(path.join(this._path, ".tombs"), {autoClose: false, start: 0, flags: "r+"});
                        }
                        res();
                        break;
                }
            })
        })).then(() => {
            return new Promise((res, rej) => {
                this._loadCache(res, rej);
            })
        }).then(() => {
            this._isReady = true;
        }).catch((err) => {
            throw err;
        });
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

    /**
     * Currently does nothing.
     *
     * @param {(err: any) => void} complete
     * @memberof SnapDB
     */
    public do_compaction(complete: (err: any) => void) {
        if (!this._isReady) {
            complete("Database not ready!");
            return;
        }
    }

    /**
     * Get a single value from the database at the given key.
     *
     * @param {K} key
     * @returns {Promise<string>}
     * @memberof SnapDB
     */
    public get(key: K): Promise<string> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            const useKey = this._makeKey(key);
            this._readValue(useKey, true, (err, data) => {
                if (err) {
                    rej(err);
                } else {
                    res(data);
                }
            })
        });
    }

    private _readValue(key: string, useCache: boolean, complete: (err: any, data: string) => void) {
        const dataInfo = this._keyData[key];
        if (!dataInfo) {
            complete(new Error("Key not found!"), "");
        } else {
            if (useCache && this.memoryCache && this._cache[key]) {
                complete(undefined, this._cache[key]);
                return;
            }
            const readBuffer = Buffer.alloc(dataInfo[2]);

            fs.read(this._dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], (err, bytesRead, buffer) => {
                if (err) {
                    complete(err, "");
                    return;
                }
                complete(undefined, buffer.toString("utf8"));
            });
        }
    }

    private _readValueSync(key: string, useCache: boolean): string {
        const dataInfo = this._keyData[key];
        if (!dataInfo) {
            throw new Error("Key not found!");
        } else {
            if (useCache && this.memoryCache && this._cache[key]) {
                return this._cache[key];
            }
            const readBuffer = Buffer.alloc(dataInfo[2]);

            fs.readSync(this._dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1]);

            return readBuffer.toString("utf8");
        }
    }

    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    public delete(key: K): Promise<boolean> {
        return new Promise((res, rej) => {
            if (!this._isReady) {
                rej("Database not ready!");
                return;
            }
            const useKey = this._makeKey(key);
            const dataLoc = this._keyData[useKey];
            if (!dataLoc) { // key not found
                rej();
            } else { // key found
                this._tombStream.write(`${useKey}::${[0, 0, 0].join(",")}\n`, "utf8", (err) => {
                    if (err) {
                        rej(err);
                        return;
                    }

                    // write key to memory
                    const wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs[this.keyType](this._indexNum, useKey);
                    delete this._keyData[useKey];

                    // delete done
                    res();
                })
            }
        })
    }

    private _makeKey(key: any): any {
        return this.keyType === "string" ? Buffer.from(String(key), "utf8").toString("hex") : key;
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
            const _writeData = (dataValues: [number, number, number], key: any, data: string) => {
                // write data
                let count = 0;

                this._currentFileLen += dataValues[2];
                this._dataStreams[dataValues[0]].write(data, "utf8", (err) => {
        
                    if (err) {
                        rej(err);
                        return;
                    }
                    count++;
                    if (count === 1) {
                        res();
                    }
                });

                const keyValue = this._makeKey(key);

                if (!this._keyData[keyValue]) {
                    // write key to memory
                    const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[this.keyType](this._indexNum, key);
                }
    
                this._keyData[keyValue] = dataValues;

                // write key data
                this._keyStream.write(`${keyValue}::${dataValues.join(",")}\n`, "utf8", (err) => {
                    if (err) {
                        rej(err);
                        return;
                    }
                    if (this.memoryCache) {
                        this._cache[keyValue] = data;
                    }
    
                    count++;
                    if (count === 1) {
                        res();
                    }
                });
            };

            const dataLen = data.length;

            // 64 MB data file limit size
            if (this._currentFileLen + dataLen > 64000000) {
                this._currentFileIdx++;
                this._currentFileLen = 0;
                this._dataFiles[this._currentFileIdx] = fs.openSync(path.join(this._path, this._currentFileIdx + ".data"), "w+");
                _writeData([this._currentFileIdx, 0, dataLen], key, data);
            } else {
                const newDataValues: [number, number, number] = [this._currentFileIdx, this._currentFileLen, dataLen];
                _writeData(newDataValues, key, data);
            }
        })
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
                const dataKey = this._makeKey(nextKey);
    
                if (this._keyData[dataKey]) {
                    const thisKey =  this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey as any);
                }
                lastKey = nextKey;
            }
        }
        onComplete();
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
                const dataKey = this._makeKey(nextKey);
    
                if (this._keyData[dataKey]) {
                    const value = this._readValueSync(dataKey, true);
                    const thisKey =  this.keyType !== "string" ? dataKey : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey as any, value);
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
                const dataKey = this._makeKey(nextKey);
    
                if (this._keyData[dataKey]) {
                    const value = this._readValueSync(dataKey, true);
                    const thisKey =  this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey as any, value);
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
                const dataKey = this._makeKey(nextKey);
                if (this._keyData[dataKey]) {
                    const value = this._readValueSync(dataKey, true);
                    const thisKey =  this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey as any, value);
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


const db = new SnapDB<string>("test", "string");
db.ready().then(() => {
    let arr: any[] = [];
    let count = 10000;
    for (let i = 1; i <= count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }
    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
    Promise.all(arr.map(r => {
        if (r[0] === 1029) {
            last = r[0];
            // console.log(r[2]);
        }
        return db.put(r[1], r[2]);
    })).then((data) => {
        console.log((count / (Date.now() - writeStart) * 1000).toLocaleString(), "Records Per Second (WRITE)");
        const start = Date.now();
        console.time("READ");
        db.offset(1000, 10, (key, data) => {
            console.log(key, "=>", data);
        }, (err) => {
            if (err) {
                console.log(err);
            }
            console.log(db.getCount(), (db.getCount() / (Date.now() - start) * 1000).toLocaleString(), "Records Per Second (READ)");
        }, false);
    });
});*/