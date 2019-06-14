const wasm = require("./db.js");
import * as fs from "fs";
import * as path from "path";

const binaryInsert = (arr: any[], value: any, remove: boolean, startVal?: number, endVal?: number): boolean => {

    const start = startVal || 0;
    const end = endVal || arr.length;

    if (arr[start] > value) {
        if (!remove) arr.unshift(value);
        return remove ? false : true;
    }
    if (arr[end] < value) {
        if (!remove) arr.push(value);
        return remove ? false : true;
    }

    const m = Math.floor((start + end) / 2);
    if (value == arr[m]) { // already in array
        if (remove) arr.splice(m, 1);
        return remove ? true : false;
    }
    if (end - 1 == start) {
        if (!remove) arr.splice(end, 0, value);
        return remove ? false : true;
    }

    if (value > arr[m]) return binaryInsert(arr, value, remove, m, end);
    if (value < arr[m]) return binaryInsert(arr, value, remove, start, m);

    if (!remove) arr.splice(end, 0, value);
    return remove ? false : true;
};

const NULLBYTE = new Buffer([0]);

class SnapWorker {

    private _cache: {
        [key: string]: string;
    } = {};

    public _indexNum: number;
    public _dbNum: number;
    private _mod: any;

    private _memTable: {
        [key: string]: any;
    } = {};

    private _memTableSize: number = 0;

    private _logHandle: number;

    static tomb = NULLBYTE;

    private _keys: {
        [key: string]: {
            file: number;
            offset: number;
            size: number;
        }
    } = {};

    private _manifestData: {
        inc: number,
        lvl: number[][];
    } = {
        inc: 0,
        lvl: []
    };

    constructor(
        public _path: string,
        public keyType: string,
        public memoryCache: boolean
    ) { 
        this._mod = wasm;
        const checkLoaded = () => {
            if (this._mod.loaded) {
                this._checkForMigration();
            } else {
                setTimeout(checkLoaded, 10);
            }
        }
        checkLoaded();
    }

    private _getFiles() {
        try {
            if (!fs.existsSync(this._path)) {
                fs.mkdirSync(this._path);
            }
            // create the log file if it's not there.
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

            if (fs.existsSync(path.join(this._path, "manifest-temp.json"))) {
                // restore from crash
                this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest-temp.json")) || new Buffer([])).toString("utf-8") || "{'inc': 0, 'lvl': []}");
                
                // write to main manifest
                fs.writeFileSync(path.join(this._path, "manifest.json"), JSON.stringify(this._manifestData));
                const fd2 = fs.openSync(path.join(this._path, "manifest.json"), "rs+");
                fs.fsyncSync(fd2);
                fs.closeSync(fd2);

                // remove temp file
                fs.unlinkSync(path.join(this._path, "manifest-temp.json"));
            } else {
                // create the manifest file if it's not there.
                fs.openSync(path.join(this._path, "manifest.json"), "w+");
                // read from the manifest file
                this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest.json")) || new Buffer([])).toString("utf-8") || "{'inc': 0, 'lvl': []}");
            }

            this._loadKeys();

        } catch(e) {
            console.error("Problem creating or reading database files.");
            console.error(e);
        }

    }

    private _del(key: any, batch?: boolean) {
        const keyLen = String(key).length;
        const valueLen = -1;
        fs.writeSync(this._logHandle, new Buffer(keyLen + "," + valueLen + "," + String(key)));
        fs.writeSync(this._logHandle, NULLBYTE);
        fs.fsyncSync(this._logHandle);
        this._memTable[key] = SnapWorker.tomb;
        this._memTableSize += keyLen;
        delete this._keys[key];
        delete this._cache[key];

        if (!batch) {
            this._maybeFlush();
        }
    }

    private _put(key: any, value: string, batch?: boolean) {
        // write key to index
        const wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
        wasmFNs[this.keyType](this._indexNum, key);

        if (this.memoryCache) {
            this._cache[key] = value;
        }
        
        // write key & value to log
        const keyLen = String(key).length;
        const valueLen = String(value).length;
        fs.writeSync(this._logHandle, new Buffer(keyLen + "," + valueLen + ","));
        fs.writeSync(this._logHandle, new Buffer(String(key) + String(value)));
        fs.writeSync(this._logHandle, NULLBYTE); // confirms a complete write for this record
        // flush to disk
        fs.fsyncSync(this._logHandle);
    
        // mark key as in memtable
        this._keys[key] = {file: -1, offset: 0, size: 0};
        this._memTable[key] = String(value);
        this._memTableSize += keyLen;
        this._memTableSize += valueLen;

        if (this.memoryCache) {
            this._cache[key] = String(value);
        }

        if (!batch) {
            this._maybeFlush();
        }
        
    }

    private _get(key: any, cb: (err, value: string) => void) {
        // check cache first
        if (this.memoryCache) {
            cb(undefined, this._cache[key]);
            return;
        }

        // check memtable
        if (this._memTable[key]) {
            if (this._memTable[key] === SnapWorker.tomb) {
                cb("Key not found!", "");
                return;
            }
            cb(undefined, this._memTable[key]);
            return;
        }

        // read from disk
        if (typeof this._keys[key] === undefined) {
            cb("Key not found!", "");
            return;
        }
        const fileData = this._keys[key];
        const file = this._fileName(fileData.file) + ".dta"
        const stream = fs.createReadStream(path.join(this._path, file), {encoding: "utf-8", autoClose: true, start: fileData.offset, end: fileData.offset + fileData.size});

        let value = "";
        stream
        .on('data', (chunk) => {
            value += chunk.toString();
        }).on("error", (err) => {
            cb(err, "");
        }).on("close", () => {
            cb(undefined, value);
        })
    }

    private _writeManifestUpdate() {
        // write manifest to temp
        fs.writeFileSync(path.join(this._path, "manifest-temp.json"), JSON.stringify(this._manifestData));
        const fd = fs.openSync(path.join(this._path, "manifest-temp.json"), "rs+");
        fs.fsyncSync(fd);
        fs.closeSync(fd);

        // write to actual file
        fs.writeFileSync(path.join(this._path, "manifest.json"), JSON.stringify(this._manifestData));
        const fd2 = fs.openSync(path.join(this._path, "manifest.json"), "rs+");
        fs.fsyncSync(fd2);
        fs.closeSync(fd2);

        // remove temp
        fs.unlinkSync(path.join(this._path, "manifest-temp.json"));
    }

    private _fileName(idx: number) {
        if (String(idx).length > 9) {
            return String(idx);
        }
        return `000000000${idx}`.slice(-9);
    }

    private _maybeFlush() {
        if (this._memTableSize > 4000) {
            
            const nextFile = this._manifestData.inc + 1;
            
            // remove possible partial files from previouse run
            fs.unlinkSync(this._fileName(nextFile) + ".idx");
            fs.unlinkSync(this._fileName(nextFile) + ".dta");

            const levelFileIdx = fs.openSync(path.join(this._path, this._fileName(nextFile) + ".idx"), "w+");
            const levelFileDta = fs.openSync(path.join(this._path, this._fileName(nextFile) + ".dta"), "w+");
            const sortedKeys = Object.keys(this._memTable).sort((a, b) => a > b ? 1 : -1);
            let dtaLen = 0;
            let i = 0;
            while (i < sortedKeys.length) {
                const key = sortedKeys[i];
                const data = this._memTable[key];

                if (data === SnapWorker.tomb) { // tombstone
                    // write index
                    fs.writeSync(levelFileIdx, new Buffer(String(key))); // key charecters
                    fs.writeSync(levelFileIdx, NULLBYTE) // null byte
                    fs.writeSync(levelFileIdx, new Buffer(String(-1))) // tombstone
                    fs.writeSync(levelFileIdx, NULLBYTE) // null byte

                } else {
                    // write index
                    fs.writeSync(levelFileIdx, new Buffer(String(key))); // key charecters
                    fs.writeSync(levelFileIdx, NULLBYTE) // null byte
                    fs.writeSync(levelFileIdx, new Buffer(String(dtaLen))) // data start location
                    fs.writeSync(levelFileIdx, NULLBYTE) // null byte
                    fs.writeSync(levelFileIdx, new Buffer(String(data.length))) // data length
                    fs.writeSync(levelFileIdx, NULLBYTE) // null byte
                    
                    // write data
                    fs.writeSync(levelFileDta, new Buffer(data));

                    // mark new location for data
                    this._keys[key] = {file: nextFile, offset: dtaLen, size: data.length};

                    dtaLen += data.length;
                }
                i++;
            }

            // checksums for integrity
            const checksum = dtaLen % 256;
            fs.writeSync(levelFileDta, new Buffer([checksum]));
            fs.writeSync(levelFileIdx, new Buffer([checksum]));

            // flush to disk
            fs.fsyncSync(levelFileDta);
            fs.fsyncSync(levelFileIdx);
            fs.closeSync(levelFileDta);
            fs.closeSync(levelFileIdx);

            // update manifest
            if (!this._manifestData.lvl[0]) {
                this._manifestData.lvl[0] = [];
            }
            this._manifestData.lvl[0].push(nextFile);
            this._manifestData.inc = nextFile;
            this._writeManifestUpdate();

            // empty memtable
            this._memTable = {};
            this._memTableSize = 0;

            // empty logfile
            fs.closeSync(this._logHandle);
            fs.unlinkSync(path.join(this._path, "LOG"));
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

            this._maybeCompact();
        }
    }

    private _maybeCompact() {
        this._manifestData.lvl.forEach((lvl, i) => {
            const maxSizeMB = Math.pow(10, i + 1);
            let size = 0;
            lvl.forEach((file) => {
                const fName = this._fileName(file) + ".dta";
                size += (fs.statSync(path.join(this._path, fName)).size / 1000000.0);
            });
            if (size > maxSizeMB) { // compact this level down to the next one

            }
        });
    }

    /**
     * Migrate SQLite files to new database file format.
     *
     * @private
     * @returns
     * @memberof SnapWorker
     */
    private _checkForMigration() {
        if (fs.existsSync(this._path) && !fs.lstatSync(this._path).isDirectory()) {
            console.log("Attempting to migrate from SQLite database...");
            console.log("If this process doesn't complete remove the '-old' from your SQLite database file and try again");
            try {
                fs.renameSync(this._path, this._path + "-old");
                this._getFiles();
                // SQLite database (old format)
                // Read SQLite data and copy it to new format, then delete it
                const dbData = this._mod.database_create(this._path + "-old", { "float": 0, "string": 1, "int": 2 }[this.keyType]);
                if (!dbData) {
                    throw new Error("Unable to connect to database at " + this._path + "-old");
                }
                this._indexNum = parseInt(dbData.split(",")[1]);
                this._dbNum = parseInt(dbData.split(",")[0]);
                const getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
                const getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };
    
                let itALL = getAllFNS[this.keyType](this._indexNum, 0);
                if (!itALL) {
                    this._ready();
                    return;
                }
                itALL = itALL.split(",").map(s => parseInt(s));
                let nextKeyALL: any;
                let countALL = 0;
    
                while (countALL < itALL[1]) {
                    nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
                    this._put(nextKeyALL, this._mod.database_get(this._dbNum, String(nextKeyALL)));
                    countALL++;
                }
                console.log("SQLite migration completed.");
                this._ready();
            } catch(e) {
                console.error("Problem migrating from SQLite database!");
                console.error(e);
            }
        } else {
            this._getFiles();
            this._ready();
        }
    }

    private _ready() {

        process.on('message', (msg) => { // got message from master
            const key = msg.key;
            const msgId = msg.id;
            switch (msg.type) {
                case "snap-get":

                    if (this._cache[String(key)] && this._cache[String(key)].length) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this._cache[String(key)]] })
                    } else {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this._mod.database_get(this._dbNum, String(key))] })
                    }
                    break;
                case "snap-del":
                    // delete key from memory
                    const wasmFNs2 = { "string": this._mod.del_key_str, "int": this._mod.del_key_int, "float": this._mod.del_key };
                    wasmFNs2[this.keyType](this._indexNum, key);

                    // delete key from database
                    const result2 = this._mod.database_del(this._dbNum, String(key));
                    delete this._cache[String(key)];
                    if (result2 === 1) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: ["Unable to delete key! " + key] })
                    } else {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [] })
                    }

                    break;
                case "snap-put":
                    // write key to memory
                    const wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
                    wasmFNs[this.keyType](this._indexNum, key);

                    // write data to database
                    const result = this._mod.database_put(this._dbNum, this._cache[String(key)] === undefined ? 1 : 0, String(key), msg.value);

                    this._cache[String(key)] = this.memoryCache ? msg.value : "";

                    if (process.send) {
                        if (result === 0) {
                            process.send({ type: "snap-res-done", id: msgId, data: [] })
                        } else {
                            process.send({ type: "snap-res-done", id: msgId, data: ["Error writing value!"] })
                        }
                    }
                    break;
                case "snap-get-all-keys":

                    const wasmFNs3 = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
                    const wasmFNs4 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };

                    const it = wasmFNs3[this.keyType](this._indexNum, msg.reverse ? 1 : 0).split(",").map(s => parseInt(s));
                    if (!it) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                        return;
                    }
                    let nextKey: any = 0;
                    let count = 0;

                    while (count < it[1]) {
                        nextKey = wasmFNs4[this.keyType](this._indexNum, it[0], msg.reverse ? 1 : 0, count);
                        if (this._cache[String(nextKey)] !== undefined) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKey] })
                        }
                        count++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })

                    break;
                case "snap-count":
                    const wasmCountFns = { "string": this._mod.get_total_str, "int": this._mod.get_total_int, "float": this._mod.get_total };
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [undefined, wasmCountFns[this.keyType](this._indexNum)] })
                    break;
                case "snap-start-tx":
                    this._mod.database_start_tx(this._indexNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-end-tx":
                    this._mod.database_end_tx(this._indexNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-get-all":
                    const getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
                    const getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };

                    let itALL = getAllFNS[this.keyType](this._indexNum, msg.reverse ? 1 : 0)
                    if (!itALL) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                        return;
                    }
                    itALL = itALL.split(",").map(s => parseInt(s));
                    let nextKeyALL: any;
                    let countALL = 0;

                    while (countALL < itALL[1]) {
                        nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], msg.reverse ? 1 : 0, countALL);
                        if (this._cache[String(nextKeyALL)] && this._cache[String(nextKeyALL)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, this._cache[String(nextKeyALL)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, this._mod.database_get(this._dbNum, String(nextKeyALL))] })
                        }
                        countALL++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                    break;
                case "snap-get-offset":
                    const offsetWasmFN = { "string": this._mod.read_index_offset_str, "int": this._mod.read_index_offset_int, "float": this._mod.read_index_offset };
                    const offsetWasmFN2 = { "string": this._mod.read_index_offset_str_next, "int": this._mod.read_index_offset_int_next, "float": this._mod.read_index_offset_next };

                    const offsetIT = offsetWasmFN[this.keyType](this._indexNum, msg.reverse ? 1 : 0, msg.offset);
                    if (offsetIT === 0) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                        return;
                    }
                    let nextKeyOffset: any = 0;
                    let countOffset = 0;

                    while (countOffset < msg.limit) {
                        nextKeyOffset = offsetWasmFN2[this.keyType](this._indexNum, offsetIT, msg.reverse ? 1 : 0, msg.limit, countOffset);
                        if (this._cache[String(nextKeyOffset)] && this._cache[String(nextKeyOffset)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, this._cache[String(nextKeyOffset)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, this._mod.database_get(this._dbNum, String(nextKeyOffset))] })
                        }
                        countOffset++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                    break;
                case "snap-get-range":
                    const wasmFNsRange = { "string": this._mod.read_index_range_str, "int": this._mod.read_index_range_int, "float": this._mod.read_index_range };
                    const wasmFNsRange2 = { "string": this._mod.read_index_range_str_next, "int": this._mod.read_index_range_int_next, "float": this._mod.read_index_range_next };

                    let rangeIT = wasmFNsRange[this.keyType](this._indexNum, msg.lower, msg.higher, msg.reverse ? 1 : 0);
                    if (!rangeIT) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                        return;
                    }
                    rangeIT = rangeIT.split(",").map(s => parseInt(s));

                    let nextKeyRange: any;
                    let isDoneRange = false;
                    let countRange = 0;

                    while (countRange < rangeIT[1]) {
                        nextKeyRange = wasmFNsRange2[this.keyType](this._indexNum, rangeIT[0], msg.reverse ? 1 : 0, countRange);
                        if (this._cache[String(nextKeyRange)] && this._cache[String(nextKeyRange)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, this._cache[String(nextKeyRange)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, this._mod.database_get(this._dbNum, String(nextKeyRange))] })
                        }
                        countRange++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })

                    break;
                case "snap-close":
                    const wasmDelFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
                    // clear index
                    wasmDelFns[this.keyType](this._indexNum);

                    // close database
                    this._mod.database_close(this._dbNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: []})
                    break;
                case "snap-clear":
                    const wasmClearFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
                    // clear index
                    wasmClearFns[this.keyType](this._indexNum);

                    // clear database
                    const resultClear = this._mod.database_clear(this._dbNum);
                    if (resultClear === 0) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: []})
                    } else {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: ["Error clearing database!"]});
                    }

                    break;
            }
        });
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

        const wasmFNs = { "string": this._mod.get_total_str, "int": this._mod.get_total_int, "float": this._mod.get_total };
        const total = wasmFNs[this.keyType](this._indexNum);

        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        const getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
        const getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };
        
        const itALL = getAllFNS[this.keyType](this._indexNum, 0).split(",").map(s => parseInt(s));
        let nextKeyALL: any = 0;
        let countALL = 0;

        while (countALL < itALL[1]) {
            nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
            this._cache[String(nextKeyALL)] = this._mod.database_get(this._dbNum, String(nextKeyALL)) || "";
            countALL++;
        }
        complete();
    }

    /**
     * Get all the keys from unqlite and load them into index
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeys() {

        const ptr = this._mod.database_cursor(this._dbNum).split(",").map(s => parseInt(s));
        let nextKey: any;
        let count = 0;

        while (count < ptr[1]) {
            nextKey = this._mod.database_cursor_next(this._dbNum, ptr[0], count);
            const dataKey = this.keyType === "string" ? nextKey : parseFloat(nextKey || "0");
            // write key to memory
            const wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
            this._cache[String(nextKey)] = "";
            wasmFNs[this.keyType](this._indexNum, dataKey);
            count++;
        }
        this._loadCache(() => {
            if (process.send) process.send({ type: "snap-ready" });
        }, (err) => {
            throw new Error(err);
        })
    }
}

process.on('message', (msg) => { // got message from master
    switch (msg.type) {
        case "snap-connect":
            new SnapWorker(msg.path, msg.keyType, msg.cache);
            break;
    }
});