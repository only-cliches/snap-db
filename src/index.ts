import * as wasm from "./db-index.js";
import * as path from "path";
import * as fs from "fs";

declare const global: any;

global.snapDB = {
    cbs: {}
};

export class SnapDB<K> {

    public _isReady: boolean;

    public _indexNum: number;

    public _currentFileIdx: number = 0;
    public _currentFileLen: number = 0;

    public _path: string;

    public dataFiles: number[] = [];

    public keyStream: fs.WriteStream;
    public tombStream: fs.WriteStream;
    public dataStreams: fs.WriteStream[] = [];

    public _cache: {[key: string]: string} = {};

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

    private _loadCache(complete: () => void, onErr: (err) => void) {
        let allDone = false;
        let count = 0;
        let hasErr = false;
        const total = this.getCount();
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }

        this.getAllKeys((key) => {
            if (hasErr) return;
            count++;
            const setKey = this._makeKey(key);
            this.get(key, true).then((data) => {
                this._cache[setKey] = data;
                count--;
                if (count === 0 && allDone) {
                    complete();
                }
            }).catch((err) => {
                hasErr = true;
                onErr(err);
            })

        }, () => {
            if (hasErr) return;
            allDone = true;
        });
    } 

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
                                this.keyStream = fs.createWriteStream(path.join(this._path, ".keys"), {autoClose: false, flags: "r+"});
                                // new key file
                                this.keyStream.write(this.keyType + "\n", "utf8", (err) => {
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
                                            if (totalVals === 0) { // deleted key
                                                const wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                                                wasmFNs[this.keyType](this._indexNum, keyData[0]);
                                            } else { // new key value
                                                const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                                                wasmFNs[this.keyType](this._indexNum, keyData[0], keyData[1][0], keyData[1][1], keyData[1][2]);
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
                                    this.keyStream = fs.createWriteStream(path.join(this._path, ".keys"), {start: data.length, autoClose: false, flags: "r+"});
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
                                    this.dataFiles[this._currentFileIdx] = fd;
                                    this.dataStreams[this._currentFileIdx] = fs.createWriteStream(path.join(this._path, this._currentFileIdx + ".data"), {autoClose: false, flags: "r+"});
                                    res();
                                });
                            } else { // subsequent
                                if (exists) {
                                    fs.open(path.join(this._path, this._currentFileIdx + ".data"), "r+", (err, fd) => {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        this.dataFiles[this._currentFileIdx] = fd;
                                        this._currentFileIdx++;
                                        attach();
                                    });
                                } else {
                                    // found latest data file, prepare to write to it
                                    this._currentFileIdx--;
                                    fs.fstat(this.dataFiles[this._currentFileIdx], (err, stats) => {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        this.dataStreams[this._currentFileIdx] = fs.createWriteStream(path.join(this._path, this._currentFileIdx + ".data"), {autoClose: false, start: stats.size, flags: "r+"});
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
                            this.tombStream = fs.createWriteStream(path.join(this._path, ".tombs"), {autoClose: false, start: tombLength, flags: "r+"});
                        } else {
                            fs.writeFileSync(path.join(this._path, ".tombs"), "");
                            this.tombStream = fs.createWriteStream(path.join(this._path, ".tombs"), {autoClose: false, start: 0, flags: "r+"});
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

    public do_compaction(complete: (err: any) => void) {

    }

    public get(key: K, skipCache?: boolean): Promise<string> {
        return new Promise((res, rej) => {
            const useKey = this._makeKey(key);
            if (!skipCache && this.memoryCache && this._cache[useKey]) {
                res(this._cache[useKey]);
                return;
            }
            const wasmFNs = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };
            const dataLoc = wasmFNs[this.keyType](this._indexNum, key);
            if (dataLoc === "n") {
                rej();
            } else {
                const dataInfo = dataLoc.split(",").map(s => parseInt(s));
                const readBuffer = Buffer.alloc(dataInfo[2]);

                fs.read(this.dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], (err, bytesRead, buffer) => {
                    if (err) {
                        rej(err);
                        return;
                    }
                    res(buffer.toString("utf8"));
                });
            }
        });
    }

    public delete(key: K): Promise<boolean> {
        return new Promise((res, rej) => {
            const wasmFNs = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };
            const dataLoc = wasmFNs[this.keyType](this._indexNum, key);
            if (dataLoc === "n") { // key not found
                rej();
            } else { // key found
                const dataInfo = dataLoc.split(",").map(s => parseInt(s));
                const keyData = this._makeKey(key);
                this.tombStream.write(`${keyData}::${[0, 0, 0].join(",")}\n`, "utf8", (err) => {
                    if (err) {
                        rej(err);
                        return;
                    }

                    // write key to memory
                    const wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs[this.keyType](this._indexNum, this._makeKey(key));

                    // delete done
                    res();
                })
            }
        })
    }

    private _makeKey(key: any): any {
        return this.keyType === "string" ? Buffer.from(String(key), "utf8").toString("hex") : key;
    }

    public put(key: K, data: string): Promise<any> {
        return new Promise((res, rej) => {

            const _writeData = (dataValues: [number, number, number], key: any, data: string) => {
                // write data
                this._currentFileLen += dataValues[2];
                this.dataStreams[dataValues[0]].write(data, "utf8", (err) => {
        
                    if (err) {
                        rej(err);
                        return;
                    }
        
                    // write key to memory
                    const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[this.keyType](this._indexNum, key, ...dataValues);

                    const keyValue = this._makeKey(key);

                    // write key
                    this.keyStream.write(`${keyValue}::${dataValues.join(",")}\n`, "utf8", (err) => {
                        if (err) {
                            rej(err);
                            return;
                        }
                        if (this.memoryCache) {
                            this._cache[keyValue] = data;
                        }
        
                        res();
                    });
                });
            };

            const dataLen = data.length;

            // 64 MB data file limit size
            if (this._currentFileLen + dataLen > 64000000) {
                this._currentFileIdx++;
                this._currentFileLen = 0;
                this.dataFiles[this._currentFileIdx] = fs.openSync(path.join(this._path, this._currentFileIdx + ".data"), "w+");
                _writeData([this._currentFileIdx, 0, dataLen], key, data);
            } else {
                const newDataValues: [number, number, number] = [this._currentFileIdx, this._currentFileLen, dataLen];
                _writeData(newDataValues, key, data);
            }
        })
    }

    public getAllKeys(onRecord: (key: K) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        const wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        const len = Object.keys(global.snapDB.cbs).length;
        let hasErr = false;
        // setup callback
        global.snapDB.cbs[len] = (data, done) => {
            if (hasErr) {
                return;
            }
    
            if (done === 1) {
                onComplete();
                delete global.snapDB.cbs[len];
            } else {
                try {
                    const thisKey =  this.keyType !== "string" ? parseFloat(data) :   Buffer.from(data, "hex").toString("utf8");                                            
                    onRecord(thisKey as any);
                } catch (e) {
                    delete global.snapDB.cbs[len];
                    hasErr = true;
                    onComplete(e);
                }
            }
        };
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, reverse ? 1 : 0);
    }

    public getCount(): number {
        const wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        return wasmFNs[this.keyType](this._indexNum);
    }

    public getAll(onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        const wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        const len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        const cb = new SnapCallBack(this, onRecord, (err) => {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, reverse ? 1 : 0);
    }

    public range(lower: K, higher: K, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        const wasmFNs = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
        const len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        const cb = new SnapCallBack(this, onRecord, (err) => {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, lower, higher,  reverse ? 1 : 0);
    }

    public offset(offset: number, limit: number, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean) {
        const wasmFNs = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
        const len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        const cb = new SnapCallBack(this, onRecord, (err) => {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, limit, offset, reverse ? 1 : 0);
    }
}

class SnapCallBack {
    public hasErr = false;
    public counter = 0;
    public allDone = false;

    constructor(
        public parent: SnapDB<any>,
        public onRecord: (...args: any[]) => void,
        public onComplete: (err?: any) => void,
    ) {
        this.call = this.call.bind(this);
    }

    public call(data, done) {
        const that = this.parent;
        const wasmFNs2 = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };

        if (this.hasErr) {
            return;
        }

        if (done === 1) {
            this.allDone = true;
            if (that.memoryCache) {
                this.onComplete();
            }
        } else {

            if (that._cache[data]) {
                const thisKey =  that.keyType !== "string" ? parseFloat(data) :   Buffer.from(data, "hex").toString("utf8");                                            
                this.onRecord(thisKey as any, that._cache[data]);
                return;
            }

            try {

                const dataLoc = wasmFNs2[that.keyType](that._indexNum, data);
                const dataInfo = dataLoc.split(",").map(s => parseInt(s));
                const readBuffer = Buffer.alloc(dataInfo[2]);
                
                this.counter++;

                fs.read(that.dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], (err, bytesRead, buffer) => {
                    if (err) {
                        this.hasErr = true;
                        this.onComplete(err);
                        return;
                    }
                    const thisKey =  that.keyType !== "string" ? parseFloat(data) :   Buffer.from(data, "hex").toString("utf8");                                            
                
                    this.onRecord(thisKey as any, buffer.toString());
                    this.counter--;
                    if (this.counter === 0 && this.allDone === true) {
                        this.onComplete();
                    }
                });
            } catch (e) {
                this.hasErr = true;
                this.onComplete(e);
            }
        }
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


const db = new SnapDB<number>("test", "int");
db.ready().then(() => {
    let arr: any[] = [];
    for (let i = 101; i < 201; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }
    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    console.time("WRITE");
    let last: any;
    Promise.all(arr.map(r => {
        if (r[0] === 1029) {
            last = r[0];
            console.log(r[2]);
        }
        return db.put(r[0], r[2]);
    })).then((data) => {
        console.timeEnd("WRITE");
        console.time("READ");
        db.getAll((key, data) => {
            // console.log(key, "=>", data);
        }, () => {
            console.timeEnd("READ");
            console.log("COUNT", db.getCount());
        }, false);
    });
});*/