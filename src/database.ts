import * as fs from "fs";
import * as path from "path";
import { SnapManifest, writeManifestUpdate, fileName, VERSION, throttle, SnapIndex, NULLBYTE, tableGenerator, rand, QueryArgs } from "./common";
import { BloomFilter, MurmurHash3, IbloomFilterObj } from "./lib_bloom";
import { createRBTree, RedBlackTree, RedBlackTreeIterator } from "./lib_rbtree";

const snapCompare = (a, b) => {
    if (a === b) return 0;
    if (typeof a === typeof b) return a > b ? 1 : -1;
    return typeof a > typeof b ? 1 : -1;
};

export class SnapDatabase {

    private _cache: {
        [key: string]: string;
    } = {};

    private _memTable: RedBlackTree = createRBTree(snapCompare);

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

    public txNum: number = Math.round(Math.random() * 256);

    private _bloomCache: {
        [fileName: number]: {cache: IbloomFilterObj, lastUsed: number}
    } = {};

    private _indexFileCache: {
        [fileNum: number]: { cache: SnapIndex, lastUsed: number }
    } = {};

    private _index: RedBlackTree = createRBTree(snapCompare);

    private _maybeCacheClear = throttle(this, () => {

        // clear out cache that wasn't used more than 10 seconds ago
        const deleteTime = Date.now() + 10000;

        const indexIDs = Object.keys(this._indexFileCache);
        let i = 0;
        while(i < indexIDs.length) {
            const fileNum = indexIDs[i];
            const cache: { cache: SnapIndex, lastUsed: number } = this._indexFileCache[fileNum];
            if (cache.lastUsed > deleteTime) {
                delete this._indexFileCache[fileNum];
            }
            i++;
        }

        i = 0;
        const bloomIDs = Object.keys(this._bloomCache);

        while(i < bloomIDs.length) {
            const fileNum = bloomIDs[i];
            const cache: { cache: IbloomFilterObj, lastUsed: number } = this._bloomCache[fileNum];
            if (cache.lastUsed > deleteTime) {
                delete this._bloomCache[fileNum];
            }
            i++;
        }

    }, 5000);

    public ready: boolean;

    constructor(
        public _path: string,
        public keyType: string,
        public memoryCache: boolean,
        public autoFlush: boolean | number,
        public isWorker: boolean
    ) {
        this._getFiles();
        if (this.isWorker) {
            this._listenForCommands();
        }
    }

    private _getFiles() {

        try {

            if (!fs.existsSync(this._path)) {
                fs.mkdirSync(this._path, { recursive: true });
            }

            // create the log file if it's not there.
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

            // restore from crash/partial write
            if (fs.existsSync(path.join(this._path, "manifest-temp.json"))) {

                try {
                    // if the JSON is invalid this whole block fails to run
                    // either manifest.json is valid OR manifest-temp.json is valid
                    // so if this fails the main mainfest should be good to use.
                    this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest-temp.json")) || Buffer.from([])).toString("utf-8") || '{"inc": 0, "lvl": []}');

                    // write to main manifest
                    fs.writeFileSync(path.join(this._path, "manifest.json"), JSON.stringify(this._manifestData));
                    const fd2 = fs.openSync(path.join(this._path, "manifest.json"), "rs+");
                    fs.fsyncSync(fd2);
                    fs.closeSync(fd2);
                    fs.unlinkSync(path.join(this._path, "manifest-temp.json"));

                } catch (e) {
                    // temporary manifest failed to load
                    try {
                        // try to load main manifest file
                        this._manifestData = JSON.parse(fs.readFileSync(path.join(this._path, "manifest.json")).toString("utf-8"));
                    } catch (e) {
                        console.error(e);
                        throw new Error("manifest.json is damaged or not found, unable to load database");
                    }

                    try {
                        fs.unlinkSync(path.join(this._path, "manifest-temp.json"));
                    } catch (e) {

                    }
                }

            } else if (fs.existsSync(path.join(this._path, "manifest.json"))) {
                try {
                    // try to load main manifest file
                    this._manifestData = JSON.parse(fs.readFileSync(path.join(this._path, "manifest.json")).toString("utf-8"));
                } catch (e) {
                    console.error(e);
                    throw new Error("manifest.json is damaged, unable to load database");
                }
            }

            if (this._manifestData.v <= 1.09) { // use old log parsing method
                // move old log file
                if (!fs.existsSync(path.join(this._path, "LOG-109"))) {
                    fs.closeSync(this._logHandle);
                    fs.renameSync(path.join(this._path, "LOG"), path.join(this._path, "LOG-109"));

                    // init new log file
                    this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");
                }

                // load everything using old format
                this._loadKeysFromV109();

                // remove old log
                fs.unlinkSync(path.join(this._path, "LOG-109"));

                // migrate version number
                this._manifestData.v = VERSION;
                writeManifestUpdate(this._path, this._manifestData);
            } else {
                this._manifestData.v = VERSION;
                writeManifestUpdate(this._path, this._manifestData);
                this._loadKeysAndLog();
            }



        } catch (e) {
            console.error("Problem creating or reading database files.");
            console.error(e);
        }

    }

    public exists(key: any): boolean {

        // check cache first
        if (this.memoryCache) {
            if (typeof this._cache[key] !== "undefined") {
                return true;
            } else {
                return false;
            }
        }

        // check memtable
        const memValue = this._memTable.get(key);
        if (typeof memValue !== "undefined") {
            if (memValue === NULLBYTE) { // tombstone
                return false;
            }
            return true;
        }

        // check index
        const index = this._index.get(key);
        if (typeof index !== "undefined") {
            return true;
        }
        return false;
    }

    public delete(key: any) {

        this._index = this._index.remove(key);

        const keyStr = (this.keyType === "any" ? (typeof key === "number" ? "n>" : "s>") : "") + String(key);

        const keyLen = keyStr.length;
        

        fs.writeSync(this._logHandle, NULLBYTE);
        this._memTableSize++;

        const tombStone = keyLen + "," + keyStr + ",-1";
        const hash = "," + String(MurmurHash3(0, tombStone));
        fs.writeSync(this._logHandle, ":" + tombStone);
        fs.writeSync(this._logHandle, hash);
        this._memTableSize += tombStone.length + hash.length + 1;

        // flush to disk
        if (!this._doingTx) {
            fs.fsyncSync(this._logHandle);
        }

        if (typeof this._memTable.get(key) !== "undefined") {
            this._memTable = this._memTable.remove(key);
        }

        this._memTable = this._memTable.insert(key, NULLBYTE);

        delete this._cache[key];

        if (!this._doingTx) this.maybeFlushLog();
        return key;
    }

    public put(key: any, value: string) {

        // write key to index
        this._index = this._index.insert(key, NULLBYTE);

        if (this.memoryCache) {
            this._cache[key] = value;
        }

        const keyStr = (this.keyType === "any" ? (typeof key === "number" ? "n>" : "s>") : "") + String(key);
        const valueStr = String(value);

        // mark key in memtable
        if (typeof this._memTable.get(key) !== "undefined") {
            this._memTable = this._memTable.remove(key);
        }

        const meta = keyStr.length + "," + keyStr + "," + (this._memTableSize + 1) + "," + valueStr.length;
        const hash = "," + String(MurmurHash3(0, meta + valueStr));

        // write value to log
        fs.writeSync(this._logHandle, NULLBYTE);
        fs.writeSync(this._logHandle, valueStr);
        fs.writeSync(this._logHandle, ":" + meta);
        fs.writeSync(this._logHandle, hash);

        this._memTable = this._memTable.insert(key, { fileID: -1, offset: [(this._memTableSize + 1), valueStr.length] });

        this._memTableSize++; // NULL
        this._memTableSize += valueStr.length;
        this._memTableSize += 1 + meta.length;
        this._memTableSize += hash.length;

        if (this.memoryCache) {
            this._cache[key] = value;
        }

        // flush to disk
        if (!this._doingTx) {
            fs.fsyncSync(this._logHandle);
            this.maybeFlushLog();
        }
    }

    private _getBloom(fileID: number) {
        if (this._bloomCache[fileID]) {
            this._bloomCache[fileID].lastUsed = Date.now();
            return this._bloomCache[fileID].cache;
        }
        this._bloomCache[fileID] = {cache: JSON.parse(fs.readFileSync(path.join(this._path, fileName(fileID) + ".bom"), "utf-8")), lastUsed: Date.now()};
        return this._bloomCache[fileID].cache;
    }

    private _maybeGetValue(strKey: string, fileID: number) {

        const index: SnapIndex = this._indexFileCache[fileID] ? this._indexFileCache[fileID].cache : JSON.parse(fs.readFileSync(path.join(this._path, fileName(fileID) + ".idx"), "utf-8"));

        if (this._indexFileCache[fileID]) {
            this._indexFileCache[fileID].lastUsed = Date.now();
        } else {
            this._indexFileCache[fileID] = { cache: index, lastUsed: Date.now() };
        }

        if (typeof index.keys[strKey] !== "undefined") { // bloom filter miss if undefined
            let dataStart = index.keys[strKey][0];
            let dataLength = index.keys[strKey][1];

            // tombstone found
            if (dataStart === -1) { 
                return {type: "data", data: undefined};
            }

            // data found
            const fd = fs.openSync(path.join(this._path, fileName(fileID) + ".dta"), "r");
            let buff = Buffer.alloc(dataLength);
            fs.readSync(fd, buff, 0, dataLength, dataStart);
            fs.closeSync(fd);
            return {type: "data", data: buff.toString("utf-8")};
        }
        return {type: "miss", data: undefined};
    }

    public get(key: any, skipCache?: boolean): string | undefined {
        this._maybeCacheClear();

        // check cache first
        if (this.memoryCache && !skipCache) {
            if (typeof this._cache[key] !== "undefined") {
                return this._cache[key];
            } else {
                return undefined;
            }
        }

        // check if it's in the index at all
        if (this.exists(key) === false) return undefined;

        // check memtable
        const memValue = this._memTable.get(key);
        if (typeof memValue !== "undefined") { // found value in mem table
            if (memValue === NULLBYTE) { // tombstone
                return undefined;
            }
            let buff = Buffer.alloc(memValue.offset[1]); // length/size
            fs.readSync(this._logHandle, buff, 0, memValue.offset[1], memValue.offset[0]);
            return buff.toString("utf-8");
        }

        // find latest key entry on disk

        let i = 0;
        while (i < this._manifestData.lvl.length) { // go through each level, starting at level 0
            const lvl = this._manifestData.lvl[i];
            let k = 0;
            while (k < lvl.files.length) { // loop through all files in this level
                const fileInfo = lvl.files[k];
                if (fileInfo.range[0] <= key && fileInfo.range[1] >= key) {
                    const bloom = this._getBloom(fileInfo.i);
                    const strKey = String(key);
                    if (BloomFilter.contains(bloom.vData, bloom.nHashFuncs, bloom.nTweak, strKey)) {
                        const value = this._maybeGetValue(strKey, fileInfo.i);
                        if (value.type !== "miss") return value.data;
                    }
                }
                k++;
            }
            i++;
        }

        return undefined;
    }

    public maybeFlushLog(forceFlush?: boolean) {
        if (this._doingTx || this._isCompacting) {
            return;
        }

        const OneMB = 1000000;

        if (this.autoFlush === false && !forceFlush) {
            return;
        }

        const maxSize = typeof this.autoFlush === "boolean" ? 2 * OneMB : this.autoFlush * OneMB;

        // flush log & memtable
        if (this._memTableSize > maxSize || forceFlush) {

            const level0Files = this._manifestData.lvl && this._manifestData.lvl.length ? this._manifestData.lvl[0].files.map(f => f.i) : [];

            tableGenerator(0, this._manifestData, this._path, this._memTable, () => {

                // remove old level 0 files from manifest
                this._manifestData.lvl[0].files = this._manifestData.lvl[0].files.filter((f) => {
                    return level0Files.indexOf(f.i) === -1;
                });

                // update manifest to disk
                writeManifestUpdate(this._path, this._manifestData);

                // empty memtable
                this._memTable = createRBTree(snapCompare);
                this._memTableSize = 0;

                // empty logfile
                fs.closeSync(this._logHandle);
                try {
                    fs.unlinkSync(path.join(this._path, "LOG"));
                } catch (e) {

                }
                this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");

                // delete old level files
                level0Files.forEach((fileID) => {
                    try {
                        fs.unlinkSync(path.join(this._path, fileName(fileID) + ".dta"));
                        fs.unlinkSync(path.join(this._path, fileName(fileID) + ".idx"));
                        fs.unlinkSync(path.join(this._path, fileName(fileID) + ".bom"));
                    } catch (e) {
                        // no error if the delete fails, doesn't matter
                    }
                });

                this._maybeCompact();
            });
        }
    }

    private _maybeCompact() {
        this._isCompacting = true;
        if (process.send) process.send({ type: "snap-compact" });
    }

    public startTX() {
        let newTXNum = 0;
        while (newTXNum === 0 || newTXNum === this.txNum) {
            newTXNum = Math.round(Math.random() * 256);
        }
        this.txNum = newTXNum;
        fs.writeSync(this._logHandle, NULLBYTE);
        this._memTableSize++;

        const startTX = "TX-START-" + this.txNum;
        fs.writeSync(this._logHandle, startTX);
        this._memTableSize += startTX.length;

        this._doingTx = true;
    }

    public endTX() {
        fs.writeSync(this._logHandle, NULLBYTE);
        this._memTableSize++;

        const endTX = "TX-END-" + this.txNum;
        fs.writeSync(this._logHandle, endTX);
        this._memTableSize += endTX.length;

        fs.fsyncSync(this._logHandle);

        this._doingTx = false;

        this.maybeFlushLog();
    }

    public compactDone() {
        this._isCompacting = false;
        this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest.json")) || Buffer.from([])).toString("utf-8"));
        this._bloomCache = {};
        this._indexFileCache = {};
    }

    public getCount() {
        return this._index.length();
    }

    public close() {
        // clear index
        this._index = createRBTree(snapCompare);
        this._memTable = createRBTree(snapCompare);

        // close log file
        fs.closeSync(this._logHandle);

        this._bloomCache = {};
        this._indexFileCache = {};
    }

    public clear() {
        this._isCompacting = true;

        this._index = createRBTree(snapCompare);
        this._memTable = createRBTree(snapCompare);
        this._memTableSize = 0;

        fs.closeSync(this._logHandle);

        // clear database

        // remove all files in db folder
        try {
            const files = fs.readdirSync(this._path);
            for (const file of files) {
                fs.unlinkSync(path.join(this._path, file));
            }
        } catch (e) {

        }
        // setup new manifest and log
        this._getFiles();
        this._isCompacting = false;
        this._doingTx = false;
    }

    public iterators: {
        [key: string]: { it: RedBlackTreeIterator, r: boolean, limit: number, count: number, end?: any, endE?: any };
    } = {};

    public newIterator(queryArgs: QueryArgs<any>): string {
        let id = rand();
        while (this.iterators[id]) {
            id = rand();
        }

        if (queryArgs.offset !== undefined) {
            this.iterators[id] = { it: queryArgs.reverse ? this._index.end() : this._index.begin(), r: queryArgs.reverse || false, limit: queryArgs.limit || -1, count: 0 };
            let i = queryArgs.offset;
            while (i-- && this.iterators[id].it.valid()) {
                if (queryArgs.reverse) {
                    this.iterators[id].it.prev();
                } else {
                    this.iterators[id].it.next();
                }
            }
        } else {
            if (queryArgs.reverse) {
                const end = queryArgs.lt !== undefined ? this._index.lt(queryArgs.lt) : (queryArgs.lte !== undefined ? this._index.le(queryArgs.lte) : this._index.end());
                this.iterators[id] = { it: end, r: true, limit: queryArgs.limit || -1, end: queryArgs.gt, endE: queryArgs.gte, count: 0 };
            } else {
                const start = queryArgs.gt !== undefined ? this._index.gt(queryArgs.gt) : (queryArgs.gte !== undefined ? this._index.ge(queryArgs.gte) : this._index.begin());
                this.iterators[id] = { it: start, r: false, limit: queryArgs.limit || -1, end: queryArgs.lt, endE: queryArgs.lte, count: 0 };
            }
        }

        return id;
    }

    public clearIterator(id: string) {
        delete this.iterators[id];
    }

    public nextIterator(id: string): { key: any, done: boolean } {

        if (this.iterators[id].it.valid()) {
            const key = this.iterators[id].it.key();
            const reverse = this.iterators[id].r;

            const limitFinished = this.iterators[id].limit === -1 ? false : this.iterators[id].count >= this.iterators[id].limit;
            const rangeFinished1 = this.iterators[id].end !== undefined ? (reverse ? key < this.iterators[id].end : key > this.iterators[id].end) : false;
            const rangeFinished2 = this.iterators[id].endE !== undefined ? (reverse ? key <= this.iterators[id].endE : key >= this.iterators[id].endE) : false;

            if (!limitFinished && !rangeFinished1 && !rangeFinished2) {
                this.iterators[id].count++;
                if (this.iterators[id].r) {
                    this.iterators[id].it.prev();
                } else {
                    this.iterators[id].it.next();
                }
                return { key: key, done: false };
            } else {
                return { key: undefined, done: true };
            }
        } else {
            return { key: undefined, done: true };
        }

    }


    private _listenForCommands() {

        process.on('message', (msg) => { // got message from master
            const key = msg.key;
            const msgId = msg.id;
            switch (msg.type) {
                case "compact-done":
                    this.compactDone();
                    if (process.send) process.send({ type: "snap-compact-done", id: msgId });
                    if (this._isConnecting) {
                        this._isConnecting = false;
                        this.ready = true;
                        if (process.send) process.send({ type: "snap-ready" });
                    }
                    break;
                case "do-compact":
                    this.maybeFlushLog(true);
                    break;
                case "snap-new-iterator":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this.newIterator(msg.args[0])] })
                    } catch (e) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: ["Failed to make iterator!", ""] })
                    }
                    break;
                case "snap-next-iterator":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this.nextIterator(msg.args[0])] })
                    } catch (e) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: ["Failed to get next iterator value!", ""] })
                    }
                    break;
                case "snap-clear-iterator":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this.clearIterator(msg.args[0])] })
                    } catch (e) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: ["Failed to clear iterator value!", ""] })
                    }
                    break;
                case "snap-get":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "get", data: [undefined, this.get(key)] })
                    } catch (e) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "get", data: ["Unable to get key or key not found!", ""] })
                    }
                    break;
                case "snap-exists":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "exists", data: [undefined, this.exists(key)] })
                    } catch (e) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "exists", data: ["Unable to run exists query!", ""] })
                    }
                    break;
                case "snap-del":
                    try {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "delete", data: [undefined, this.delete(key)] })
                    } catch (e) {
                        console.error(e);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "delete", data: ["Unable to delete key! " + key] })
                    }

                    break;
                case "snap-put":
                    try {
                        this.put(key, msg.value);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "put", data: [undefined, true] });
                    } catch (e) {
                        console.error(e);
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, event: "put", data: ["Error writing value!"] })
                    }
                    break;
                case "snap-count":
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "get-count", data: [undefined, this.getCount()] })
                    break;
                case "snap-start-tx":
                    if (this._doingTx === true) {
                        if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: ["Can't do nested transactions, finish the current one first!", ""] });
                        return;
                    }
                    this.startTX();
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "tx-start", data: [undefined, this.txNum] });
                    break;
                case "snap-end-tx":
                    this.endTX();
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, event: "tx-end", data: [undefined, this.txNum] });
                    break;
                case "snap-close":
                    this.close();
                    if (process.send) process.send({ type: "snap-close-done", id: msg.id, data: [undefined] })
                    break;
                case "snap-clear":
                    this.clear();
                    if (process.send) process.send({ type: "snap-clear-done", id: msg.id, data: [] })
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

        const total = this._index.length();

        if (total === 0 || !this.memoryCache) {
            return;
        }

        const it = this._index.begin();

        while (it.hasNext()) {
            this._cache[it.key()] = this.get(it.key(), true) || "";
            it.next();
        }
    }

    /**
     * Get all the keys from log files and index files
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeysAndLog() {

        // populate index from database files
        this._readIndexFiles();

        // load LOG file into memtable
        const logFileSize = fs.fstatSync(this._logHandle).size;

        if (logFileSize === 0) {
            // load cache if it's enabled
            this._loadCache();

            // nothing to load, all done
            this.ready = true;
            if (process.send) process.send({ type: "snap-ready" });
        } else {
            const readStream = fs.createReadStream(path.join(this._path, "LOG"), { autoClose: false, fd: this._logHandle });

            let buffer: string = "";
            let tx: number = -1;
            let txKeys: [any, number, number][] = [];

            const processLog = (line: string) => {
                if (!line || !line.length) return;

                if (line.indexOf("TX-START") === 0) { // start transaction
                    tx = parseInt(line.replace("TX-START-", ""));
                    txKeys = [];
                } else if (line.indexOf("TX-END") === 0) { // end of transaction
                    if (parseInt(line.replace("TX-END-", "")) === tx) {
                        let j = 0; // commit transaction to memtable

                        while (j < txKeys.length) {
                            this._index = this._index.remove(txKeys[j][0]);
                            this._memTable = this._memTable.remove(txKeys[j][0]);
                            if (txKeys[j][1] === -1) { // tombstone
                                this._memTable = this._memTable.insert(txKeys[j][0], NULLBYTE);
                            } else {
                                this._index = this._index.insert(txKeys[j][0], NULLBYTE);
                                this._memTable = this._memTable.insert(txKeys[j][0], { fileID: -1, offset: [txKeys[j][1], txKeys[j][2]] });
                            }
                            j++;
                        }
                    }
                    tx = -1;
                    txKeys = [];
                } else { // normal line
                    let k = line.length;
                    let keyData: string = "";
                    let stop = false;
                    let valueBreak: number = 0;
                    while (k-- && stop === false) {
                        if (line[k] === ":") {
                            valueBreak = k;
                            stop = true;
                        } else {
                            keyData = line[k] + keyData;
                        }
                    }
                    stop = false;
                    k = 0;
                    let keyLenStr: string = "";
                    let ptr = 0;
                    while (k < keyData.length && stop === false) {
                        ptr++;
                        if (keyData[k] === ",") {
                            stop = true;
                        } else {
                            keyLenStr = keyLenStr + keyData[k];
                        }
                        k++;
                    }
                    const keyLength = parseInt(keyLenStr);
                    if (isNaN(keyLength)) {
                        throw new Error("Error parsing log file!");
                    }
                    k = 0;
                    let key: string = "";
                    while (k < keyLength) {
                        key += keyData[k + ptr];
                        k++;
                    }
                    ptr += keyLength + 1;

                    let parsedKey = this.keyType === "any" ? (key.slice(0, 2) === "n>" ? parseFloat(key.slice(2)) : key.slice(2)) : (this.keyType === "string" ? key : parseFloat(key));
                    let parsedValueData = keyData.substr(ptr).split(",").map(s => parseInt(s));

                    this._memTable = this._memTable.remove(parsedKey);
                    this._index = this._index.remove(parsedKey);

                    if (parsedValueData[0] === -1) { // tombstone
                        if (tx !== -1) {
                            txKeys.push([parsedKey, -1, 0]);
                        } else {
                            this._memTable = this._memTable.insert(parsedKey, NULLBYTE);
                        }
                    } else { // value
                        const start = parsedValueData[0];
                        const length = parsedValueData[1];
                        const hash = parsedValueData[2];

                        if (hash === MurmurHash3(0, keyLength + "," + key + "," + start + "," + length + line.substr(0, valueBreak))) {
                            this._index = this._index.insert(parsedKey, NULLBYTE);
                            if (tx !== -1) {
                                txKeys.push([parsedKey, start, length]);
                            } else {
                                this._memTable = this._memTable.insert(parsedKey, { fileID: -1, offset: [start, length] });
                            }
                        } else {
                            console.error(`Error validating key "${parsedKey}", value not imported from log!`);
                        }
                    }
                }
            }

            let size = 0;

            readStream.on("data", (chunk: Buffer) => {
                let i = 0;
                while (i < chunk.length) {
                    if (chunk[i] === 0 && buffer.length) {
                        processLog(buffer);
                        buffer = "";
                    } else if (chunk[i] !== 0) {
                        buffer += String.fromCharCode(chunk[i]);
                    }
                    i++;
                }
                size += chunk.length;
            }).on("end", () => {

                if (buffer.length) {
                    processLog(buffer);
                    buffer = "";
                }

                this._isConnecting = true;
                this._memTableSize = size;

                // purge keys that are in an incomplete transaction
                if (tx !== -1) {
                    let i = txKeys.length;
                    while (i--) {
                        this._memTable = this._memTable.remove(txKeys[i]);
                    }
                }

                // load cache if it's enabled
                this._loadCache();

                // flush logs if needed
                this.maybeFlushLog();

                this.ready = true;
                if (process.send) process.send({ type: "snap-ready" });
            })

        }
    }

    /**
     * Get all the keys from log files and index files
     *
     * @private
     * @memberof SnapDB
     */
    private _loadKeysFromV109() {

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

        const LOGFILE = fs.readFileSync(path.join(this._path, "LOG-109"));

        if (LOGFILE.length === 0) {
            // nothing to load, all done

            // load cache if it's enabled
            this._loadCache();
            this.ready = true;
            if (process.send) process.send({ type: "snap-ready" });
        } else {

            // import logfile into merge tree
            let events: string[] = [];
            let buffer = "";
            let i = 0;
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
            events.filter(v => v && v.length).forEach((event) => {
                if (event.indexOf("TX-START-") === 0) { // start transaction
                    // clear previouse transaction data
                    tx = parseInt(event.replace("TX-START-", ""));
                    batches = [];
                } else if (event.indexOf("TX-END-") === 0) { // end of transaction
                    const endTx = tx = parseInt(event.replace("TX-END-", ""));
                    if (endTx === tx) { // commit batch
                        batches.forEach((bEvent) => {
                            let rowData = parseLogLine(bEvent);
                            const key = this.keyType === "string" ? rowData[0] : parseFloat(rowData[0]);
                            if (rowData.length) {
                                if (rowData[1] === -1) {
                                    this.delete(key);
                                } else {
                                    this.put(key, rowData[1]);
                                }
                            }
                        });
                        batches = [];
                    }
                    tx = 0;
                } else { // normal record
                    if (tx === 0) { // not in transaction
                        let rowData = parseLogLine(event);

                        const key = this.keyType === "string" ? rowData[0] : parseFloat(rowData[0]);
                        if (rowData.length) {
                            if (rowData[1] === -1) {
                                this.delete(key);
                            } else {
                                this.put(key, rowData[1]);
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
            this.maybeFlushLog();
            this.ready = true;

            if (process.send) process.send({ type: "snap-ready" });
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
                            while (i--) {
                                const key = this.keyType === "any" ? (keys[i].slice(0, 2) === "n>" ? parseFloat(keys[i].slice(2)) : keys[i].slice(2)) : (this.keyType === "string" ? keys[i] : parseFloat(keys[i]));
                                if (index.keys[keys[i]][0] === -1) { // delete
                                    this._index = this._index.remove(key);
                                } else { // add
                                    this._index = this._index.insert(key, "");
                                }
                            }
                        }
                    });
                }
            });
        });
    }
}

// this is child fork if process.send exists
if (process.send !== undefined) {
    process.on('message', (msg) => { // got message from master
        switch (msg.type) {
            case "snap-connect":
                new SnapDatabase(msg.path, msg.keyType, msg.cache, msg.autoFlush, true);
                break;
        }
    });
}