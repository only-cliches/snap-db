const wasm = require("./db.js");
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { SnapManifest, writeManifestUpdate, fileName, VERSION, throttle, SnapIndex, NULLBYTE, tableGenerator } from "./common";
import { BloomFilter, MurmurHash3, IbloomFilterObj } from "./bloom";

class SnapDatabase {

    private _cache: {
        [key: string]: string;
    } = {};

    public _indexNum: number;
    public _dbNum: number;
    private _mod: any;

    private _memTable: {
        [key: string]: any;
    } = {};
    private _memTableIndex: number;

    private _memTableSize: number = 0;

    private _logHandle: number;


    private _manifestData: SnapManifest = {
        v: VERSION,
        inc: 0,
        lvl: []
    };

    private _doingTx: boolean = false;

    private _isCompacting: boolean = false;

    private _isConnecting: boolean = false;

    private _txNum: number = Math.round(Math.random() * 256);

    private _bloomCache: {
        [fileName: number]: IbloomFilterObj;
    } = {};

    private _indexFileCache: {
        [fileNum: number]: { cache: SnapIndex, lastUsed: number }
    } = {};

    private _indexCacheClear = throttle(this, () => {
        Object.keys(this._indexFileCache).forEach((fileNum) => {
            const cache: { cache: SnapIndex, lastUsed: number } = this._indexFileCache[fileNum];
            // clear out cache that wasn't used more than 5 seconds ago
            if (cache.lastUsed > Date.now() + 5000) {
                delete this._indexFileCache[fileNum];
            }
        })
    }, 5000);

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
            const wasmFNs = { "string": this._mod.new_index_str, "int": this._mod.new_index_int, "float": this._mod.new_index };
            this._indexNum = wasmFNs[this.keyType]();
            this._memTableIndex = wasmFNs[this.keyType]();

            if (!fs.existsSync(this._path)) {
                fs.mkdirSync(this._path);
            }
            // create the log file if it's not there.
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

            if (fs.existsSync(path.join(this._path, "manifest-temp.json"))) {
                // restore from crash
                this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest-temp.json")) || new Buffer([])).toString("utf-8") || '{"inc": 0, "lvl": []}');

                // write to main manifest
                fs.writeFileSync(path.join(this._path, "manifest.json"), JSON.stringify(this._manifestData));
                const fd2 = fs.openSync(path.join(this._path, "manifest.json"), "rs+");
                fs.fsyncSync(fd2);
                fs.closeSync(fd2);

                // remove temp file
                fs.unlinkSync(path.join(this._path, "manifest-temp.json"));
            } else {
                if (fs.existsSync(path.join(this._path, "manifest.json"))) {
                    this._manifestData = JSON.parse(fs.readFileSync(path.join(this._path, "manifest.json")).toString("utf-8"));
                }
            }

            this._manifestData.v = VERSION;

            writeManifestUpdate(this._path, this._manifestData);

            this._loadKeys();

        } catch (e) {
            console.error("Problem creating or reading database files.");
            console.error(e);
        }

    }

    private _del(key: any, skiplog?: boolean) {

        const wasmFNs2 = { "string": this._mod.del_key_str, "int": this._mod.del_key_int, "float": this._mod.del_key };
        wasmFNs2[this.keyType](this._indexNum, key);

        const keyLen = String(key).length;

        if (!skiplog) {
            fs.writeSync(this._logHandle, NULLBYTE);
            fs.writeSync(this._logHandle, keyLen + ",-1," + String(key));
            // flush to disk
            if (!this._doingTx) {
                fs.fsyncSync(this._logHandle);
            }
        }

        this._memTable[key] = NULLBYTE;
        this._memTableSize += keyLen;
        delete this._cache[key];

        this._maybeFlushLog();
    }

    private _put(key: any, value: string, skiplog?: boolean) {

        // write key to index
        const wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
        wasmFNs[this.keyType](this._indexNum, key);

        if (this.memoryCache) {
            this._cache[key] = value;
        }

        const keyStr = String(key);
        const valueStr = String(value);

        if (!skiplog) {
            // write key & value to log
            fs.writeSync(this._logHandle, NULLBYTE);
            fs.writeSync(this._logHandle, keyStr.length + "," + valueStr.length + "," + keyStr + valueStr);
            fs.writeSync(this._logHandle, MurmurHash3(0, keyStr + valueStr)); // data checksum
        }


        // flush to disk
        if (!skiplog && !this._doingTx) {
            fs.fsyncSync(this._logHandle);
        }

        // mark key in memtable
        this._memTable[key] = valueStr;
        wasmFNs[this.keyType](this._memTableIndex, key);
        this._memTableSize += keyStr.length;
        this._memTableSize += valueStr.length;

        if (this.memoryCache) {
            this._cache[key] = this._memTable[key];
        }

        if (!skiplog) this._maybeFlushLog();

    }

    private _getBloom(fileID: number) {
        if (this._bloomCache[fileID]) {
            return this._bloomCache[fileID];
        }
        this._bloomCache[fileID] = JSON.parse(fs.readFileSync(path.join(this._path, fileName(fileID) + ".bom"), "utf-8"));
        return this._bloomCache[fileID];
    }

    private _get(key: any, skipCache?: boolean): string {
        this._indexCacheClear();

        // check cache first
        if (this.memoryCache && !skipCache) {
            if (typeof this._cache[key] !== "undefined") {
                return this._cache[key];
            } else {
                throw new Error("Key not found!");
            }
        }

        // check memtable
        if (this._memTable[key]) {
            if (this._memTable[key] === NULLBYTE) { // tombstone
                throw new Error("Key not found!");
            }
            return this._memTable[key];
        }

        // find latest key entry on disk
        const strKey = String(key);
        let candidateFiles: number[] = [];
        this._manifestData.lvl.forEach((lvl, i) => {
            lvl.files.forEach((fileInfo) => {
                if (i === 0) { // level 0, no range check
                    const bloom = this._getBloom(fileInfo.i);
                    if (BloomFilter.contains(bloom.vData, bloom.nHashFuncs, bloom.nTweak, strKey)) {
                        candidateFiles.push(fileInfo.i);
                    }
                } else { // level 1+, do range check then bloom filter
                    if (fileInfo.range[0] <= key && fileInfo.range[1] >= key) {
                        const bloom = this._getBloom(fileInfo.i);
                        if (BloomFilter.contains(bloom.vData, bloom.nHashFuncs, bloom.nTweak, strKey)) {
                            candidateFiles.push(fileInfo.i);
                        }
                    }
                }
            });
        });

        // no candidates found, key doesn't exist
        if (candidateFiles.length === 0) {
            throw new Error("Key not found!");
        }

        // newer files first
        candidateFiles = candidateFiles.sort((a, b) => a < b ? 1 : -1);

        let fileIdx = 0;
        while (fileIdx < candidateFiles.length) {
            const fileID = candidateFiles[fileIdx];

            const index: SnapIndex = this._indexFileCache[fileID] ? this._indexFileCache[fileID].cache : JSON.parse(fs.readFileSync(path.join(this._path, fileName(fileID) + ".idx"), "utf-8"));

            if (this._indexFileCache[fileID]) {
                this._indexFileCache[fileID].lastUsed = Date.now();
            } else {
                this._indexFileCache[fileID] = { cache: index, lastUsed: Date.now() };
            }

            if (typeof index.keys[strKey] !== "undefined") { // bloom filter miss if undefined
                let dataStart = index.keys[strKey][0];
                let dataLength = index.keys[strKey][1];
                if (dataStart === -1) { // tombstone found
                    throw new Error("Key not found!");
                }
                const fd = fs.openSync(path.join(this._path, fileName(fileID) + ".dta"), "r");
                let buff = new Buffer(dataLength);
                fs.readSync(fd, buff, 0, dataLength, dataStart);
                fs.closeSync(fd);
                return buff.toString("utf-8");
            }
            fileIdx++
        };

        throw new Error("Key not found!");
    }

    private _maybeFlushLog() {
        if (this._doingTx || this._isCompacting) {
            return;
        }

        // flush log & memtable at 2 megabytes
        if (this._memTableSize > 2000000) {

            tableGenerator(0, this._manifestData, this._memTable, this.keyType, this._path, this._memTableIndex);

            // update manifest to disk
            writeManifestUpdate(this._path, this._manifestData);

            // empty memtable
            this._memTable = {};
            this._memTableSize = 0;
            const wasmClearFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
            wasmClearFns[this.keyType](this._memTableIndex);

            // empty logfile
            fs.closeSync(this._logHandle);
            fs.unlinkSync(path.join(this._path, "LOG"));
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

            this._maybeCompact();
        }
    }

    private _maybeCompact() {
        this._isCompacting = true;
        if (process.send) process.send({ type: "snap-compact" });
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
            console.log("Attempting to migrate from SQLite backend..");
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
                    this._listenForCommands();
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
                this._listenForCommands();
            } catch (e) {
                console.error("Problem migrating from SQLite database!");
                console.error(e);
            }
        } else {
            this._getFiles();
            this._listenForCommands();
        }
    }

    private _listenForCommands() {

        process.on('message', (msg) => { // got message from master
            const key = msg.key;
            const msgId = msg.id;
            switch (msg.type) {
                case "compact-done":
                    this._isCompacting = false;
                    this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest.json")) || new Buffer([])).toString("utf-8"));
                    this._bloomCache = {};
                    this._indexFileCache = {};
                    if (process.send) process.send({ type: "snap-compact-done", id: msgId });
                    if (this._isConnecting) {
                        this._isConnecting = false;
                        if (process.send) process.send({ type: "snap-ready" });
                    }
                    break;
                case "snap-get":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "get", data: [undefined, this._get(key)] })
                    } catch (e) {
                        console.error(e);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "get", data: ["Unable to get key!", ""] })
                    }
                    break;
                case "snap-del":
                    try {
                        this._del(key);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "delete", data: [] })
                    } catch (e) {
                        console.error(e);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "delete", data: ["Unable to delete key! " + key] })
                    }

                    break;
                case "snap-put":
                    try {
                        this._put(key, msg.value);
                        if (this.memoryCache) {
                            this._cache[key] = msg.value;
                        }
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "put", data: [] });
                    } catch (e) {
                        console.error(e);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "put", data: ["Error writing value!"] })
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
                        if (process.send) process.send({ type: "snap-res", event: "get-keys", id: msg.id, data: ["response", nextKey] })
                        count++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", event: "get-keys-end", id: msg.id, data: [] })

                    break;
                case "snap-count":
                    const wasmCountFns = { "string": this._mod.get_total_str, "int": this._mod.get_total_int, "float": this._mod.get_total };
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-count", data: [undefined, wasmCountFns[this.keyType](this._indexNum)] })
                    break;
                case "snap-start-tx":
                    if (this._doingTx === true) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: ["Can't do nested transactions, finish the current one first!", ""] });
                        return;
                    }
                    let newTXNum = 0;
                    while (newTXNum === 0 || newTXNum === this._txNum) {
                        newTXNum = Math.round(Math.random() * 256);
                    }
                    this._txNum = newTXNum;
                    // transaction start
                    fs.writeSync(this._logHandle, NULLBYTE);
                    fs.writeSync(this._logHandle, "TX-START-" + this._txNum);
                    this._doingTx = true;
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "tx-start", data: [undefined, this._txNum] });
                    break;
                case "snap-end-tx":
                    // transaction end
                    fs.writeSync(this._logHandle, NULLBYTE);
                    fs.writeSync(this._logHandle, "TX-END-" + this._txNum);
                    fs.fsyncSync(this._logHandle);
                    this._doingTx = false;
                    this._maybeFlushLog();
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "tx-end", data: [undefined, this._txNum] });
                    break;
                case "snap-get-all":
                    const getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
                    const getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };

                    let itALL = getAllFNS[this.keyType](this._indexNum, msg.reverse ? 1 : 0)
                    if (!itALL) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-all-end", data: [] })
                        return;
                    }
                    itALL = itALL.split(",").map(s => parseInt(s));
                    let nextKeyALL: any;
                    let countALL = 0;

                    while (countALL < itALL[1]) {
                        nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], msg.reverse ? 1 : 0, countALL);
                        if (process.send) process.send({ type: "snap-res", id: msg.id, event: "get-all", data: ["response", nextKeyALL, this._get(nextKeyALL)] })
                        countALL++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-all-end", data: [] })
                    break;
                case "snap-get-offset":
                    const offsetWasmFN = { "string": this._mod.read_index_offset_str, "int": this._mod.read_index_offset_int, "float": this._mod.read_index_offset };
                    const offsetWasmFN2 = { "string": this._mod.read_index_offset_str_next, "int": this._mod.read_index_offset_int_next, "float": this._mod.read_index_offset_next };

                    const offsetIT = offsetWasmFN[this.keyType](this._indexNum, msg.reverse ? 1 : 0, msg.offset);
                    if (offsetIT === 0) {
                        if (process.send) process.send({ type: "snap-res-done", event: "get-offset-end", id: msg.id, data: [] })
                        return;
                    }
                    let nextKeyOffset: any = 0;
                    let countOffset = 0;

                    while (countOffset < msg.limit) {
                        nextKeyOffset = offsetWasmFN2[this.keyType](this._indexNum, offsetIT, msg.reverse ? 1 : 0, msg.limit, countOffset);
                        if (process.send) process.send({ type: "snap-res", id: msg.id, event: "get-offset", data: ["response", nextKeyOffset, this._get(nextKeyOffset)] })
                        countOffset++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-offset-end", data: [] })
                    break;
                case "snap-get-range":
                    const wasmFNsRange = { "string": this._mod.read_index_range_str, "int": this._mod.read_index_range_int, "float": this._mod.read_index_range };
                    const wasmFNsRange2 = { "string": this._mod.read_index_range_str_next, "int": this._mod.read_index_range_int_next, "float": this._mod.read_index_range_next };

                    let rangeIT = wasmFNsRange[this.keyType](this._indexNum, msg.lower, msg.higher, msg.reverse ? 1 : 0);
                    if (!rangeIT) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-range-end", data: [] })
                        return;
                    }
                    rangeIT = rangeIT.split(",").map(s => parseInt(s));

                    let nextKeyRange: any;
                    let countRange = 0;

                    while (countRange < rangeIT[1]) {
                        nextKeyRange = wasmFNsRange2[this.keyType](this._indexNum, rangeIT[0], msg.reverse ? 1 : 0, countRange);
                        if (process.send) process.send({ type: "snap-res", id: msg.id, event: "get-range", data: ["response", nextKeyRange, this._get(nextKeyRange)] })
                        countRange++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-range-end", data: [] })

                    break;
                case "snap-close":
                    const wasmDelFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
                    // clear index
                    wasmDelFns[this.keyType](this._indexNum);

                    // close log file
                    fs.closeSync(this._logHandle);

                    this._bloomCache = {};
                    this._indexFileCache = {};

                    if (process.send) process.send({ type: "snap-close-done", id: msg.id, data: [undefined] })
                    break;
                case "snap-clear":
                    this._isCompacting = true;
                    const wasmClearFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
                    // clear index
                    wasmClearFns[this.keyType](this._indexNum);

                    // clear database

                    // remove all files in db folder
                    fs.readdir(this._path, (err, files) => {
                        if (err) throw err;

                        for (const file of files) {
                            fs.unlink(path.join(this._path, file), err => {
                                if (err) throw err;
                            });
                        }
                    });

                    // setup new manifest
                    this._getFiles();

                    if (process.send) process.send({ type: "snap-clear-done", id: msg.id, data: [] })

                    this._isCompacting = false;
                    this._doingTx = false;
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
    private _loadCache() {

        const wasmFNs = { "string": this._mod.get_total_str, "int": this._mod.get_total_int, "float": this._mod.get_total };
        const total = wasmFNs[this.keyType](this._indexNum);

        if (total === 0 || !this.memoryCache) {
            return;
        }
        const getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
        const getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };

        const itALL = getAllFNS[this.keyType](this._indexNum, 0).split(",").map(s => parseInt(s));
        let nextKeyALL: any = 0;
        let countALL = 0;

        while (countALL < itALL[1]) {
            nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
            this._cache[nextKeyALL] = this._get(nextKeyALL, true);
            countALL++;
        }
    }

    /**
     * Get all the keys from log files and index files
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeys() {

        const parseLogLine = (line: string): any[] => {
            // log record line:
            // keyKength,valueLength,key value hash

            let buffer = "";

            let i = 0;
            while (line[i] !== "," && i < line.length) {
                buffer += line[i];
                i++;
            }
            i++;
            let keyLen = parseInt(buffer);
            buffer = "";

            if (isNaN(keyLen)) {
                throw new Error("Error parsing log file!");
            }

            while (line[i] !== "," && i < line.length) {
                buffer += line[i];
                i++;
            }
            i++;
            let valueLen = parseInt(buffer);
            buffer = "";

            if (isNaN(valueLen)) {
                throw new Error("Error parsing log file!");
            }

            let k = 0;
            while (k < keyLen && k < line.length) {
                buffer += line[i + k];
                k++;
            }
            let key = this.keyType === "string" ? buffer : parseFloat(buffer);

            if (valueLen === -1) { // tombstone
                return [key, -1];
            }



            buffer = "";
            k = 0;
            while (k < valueLen && k < line.length) {
                buffer += line[i + k + keyLen];
                k++;
            }
            let value = buffer;
            buffer = "";
            k = i + keyLen + valueLen;
            while (k < line.length) {
                buffer += line[k];
                k++;
            }
            if (MurmurHash3(0, String(key) + value) !== parseInt(buffer)) {
                console.warn("Integrity check failed for the following key, value not imported.")
                console.warn(key);
                return [];
            }
            return [key, value];
        }

        // populate index
        this._readIndexFiles();

        // load LOG file into memtable

        const LOGFILE = fs.readFileSync(path.join(this._path, "LOG"));

        if (LOGFILE.length === 0) {
            // nothing to load, all done
            if (process.send) process.send({ type: "snap-ready" });
        } else {

            // import logfile into merge tree
            let events: string[] = [];
            let buffer = "";
            let i = 1;
            while (i < LOGFILE.length) {
                if (LOGFILE[i] === 0) {
                    events.push(buffer);
                    buffer = "";
                } else {
                    buffer += String.fromCharCode(LOGFILE[i]);
                }
                i++;
            }
            events.push(buffer);
            buffer = "";

            let tx: number = 0;
            let batches: string[] = [];
            events.forEach((event) => {
                if (event.indexOf("TX-START") === 0) { // start transaction
                    // clear previouse transaction data
                    tx = parseInt(event.replace("TX-START-", ""));
                    batches = [];
                } else if (event.indexOf("TX-END") === 0) { // end of transaction
                    const endTx = tx = parseInt(event.replace("TX-END-", ""));
                    if (endTx === tx) { // commit batch
                        batches.forEach((bEvent) => {
                            let rowData = parseLogLine(bEvent);
                            if (rowData.length) {
                                if (rowData[1] === -1) {
                                    this._del(rowData[0], true);
                                } else {
                                    this._put(rowData[0], rowData[1], true);
                                }
                            }
                        });
                        batches = [];
                    }
                    tx = 0;
                } else { // normal record
                    if (tx === 0) { // not in transaction
                        let rowData = parseLogLine(event);
                        if (rowData.length) {
                            if (rowData[1] === -1) {
                                this._del(rowData[0], true);
                            } else {
                                this._put(rowData[0], rowData[1], true);
                            }
                        }
                    } else { // in transaction
                        batches.push(event);
                    }
                }
            });
            this._isConnecting = true;

            // load cache if it's enabled
            this._loadCache();

            // flush logs if needed
            this._maybeFlushLog();
        }
    }

    private _readIndexFiles() {
        fs.readdir(this._path, (err, filenames) => {
            if (err) {
                throw err;
            }
            filenames.sort((a, b) => a > b ? 1 : -1).forEach((filename) => {
                if (filename.indexOf(".idx") !== -1) {
                    fs.readFile(path.join(this._path, filename), 'utf-8', (err, content) => {
                        if (err) {
                            throw err;
                        }
                        if (content && content.length) {
                            const index: SnapIndex = JSON.parse(content);
                            const keys = Object.keys(index.keys);
                            let i = keys.length;
                            while(i--) {
                                const key = this.keyType === "string" ? keys[i] : parseFloat(keys[i]);
                                if (index.keys[keys[i]][0] === -1) { // delete
                                    const wasmFNs2 = { "string": this._mod.del_key_str, "int": this._mod.del_key_int, "float": this._mod.del_key };
                                    wasmFNs2[this.keyType](this._indexNum, key);
                                } else { // add
                                    const wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
                                    wasmFNs[this.keyType](this._indexNum, key);
                                }
                            }
                        }
                    });
                }
            });
        });
    }
}

process.on('message', (msg) => { // got message from master
    switch (msg.type) {
        case "snap-connect":
            new SnapDatabase(msg.path, msg.keyType, msg.cache);
            break;
    }
});