Object.defineProperty(exports, "__esModule", { value: true });
var wasm = require("./db.js");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var common_1 = require("./common");
var bloom_1 = require("./bloom");
var NULLBYTE = new Buffer([0]);
var SnapWorker = /** @class */ (function () {
    function SnapWorker(_path, keyType, memoryCache) {
        var _this = this;
        this._path = _path;
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this._cache = {};
        this._memTable = {};
        this._memTableSize = 0;
        this._manifestData = {
            v: common_1.VERSION,
            inc: 0,
            lvl: []
        };
        this._doingTx = false;
        this._isCompacting = false;
        this._isConnecting = false;
        this._txNum = Math.round(Math.random() * 256);
        this._indexFileCache = {};
        this._indexCacheClear = common_1.throttle(this, function () {
            Object.keys(_this._indexFileCache).forEach(function (fileNum) {
                var cache = _this._indexFileCache[fileNum];
                // clear out cache that wasn't used more than 5 seconds ago
                if (cache.lastUsed > Date.now() + 5000) {
                    delete _this._indexFileCache[fileNum];
                }
            });
        }, 5000);
        this._mod = wasm;
        var checkLoaded = function () {
            if (_this._mod.loaded) {
                _this._checkForMigration();
            }
            else {
                setTimeout(checkLoaded, 10);
            }
        };
        checkLoaded();
    }
    SnapWorker.prototype._getFiles = function () {
        try {
            var wasmFNs = { "string": this._mod.new_index_str, "int": this._mod.new_index_int, "float": this._mod.new_index };
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
                var fd2 = fs.openSync(path.join(this._path, "manifest.json"), "rs+");
                fs.fsyncSync(fd2);
                fs.closeSync(fd2);
                // remove temp file
                fs.unlinkSync(path.join(this._path, "manifest-temp.json"));
            }
            else {
                // create the manifest file if it's not there.
                fs.openSync(path.join(this._path, "manifest.json"), "w+");
                // read from the manifest file
                this._manifestData = JSON.parse((fs.readFileSync(path.join(this._path, "manifest.json")) || new Buffer([])).toString("utf-8") || '{"inc": 0, "lvl": []}');
            }
            this._manifestData.v = common_1.VERSION;
            common_1.writeManifestUpdate(this._path, this._manifestData);
            this._loadKeys();
        }
        catch (e) {
            console.error("Problem creating or reading database files.");
            console.error(e);
        }
    };
    SnapWorker.prototype._del = function (key, skiplog) {
        var wasmFNs2 = { "string": this._mod.del_key_str, "int": this._mod.del_key_int, "float": this._mod.del_key };
        wasmFNs2[this.keyType](this._indexNum, key);
        var keyLen = String(key).length;
        if (!skiplog) {
            fs.writeSync(this._logHandle, NULLBYTE);
            fs.writeSync(this._logHandle, keyLen + ",-1," + String(key));
            // flush to disk
            if (!this._doingTx) {
                fs.fsyncSync(this._logHandle);
            }
        }
        this._memTable[key] = SnapWorker.tomb;
        this._memTableSize += keyLen;
        delete this._cache[key];
        this._maybeFlushLog();
    };
    SnapWorker.prototype._put = function (key, value, skiplog) {
        // write key to index
        var wasmFNs = { "string": this._mod.add_to_index_str, "int": this._mod.add_to_index_int, "float": this._mod.add_to_index };
        wasmFNs[this.keyType](this._indexNum, key);
        if (this.memoryCache) {
            this._cache[key] = value;
        }
        var keyStr = String(key);
        var valueStr = String(value);
        if (!skiplog) {
            // write key & value to log
            fs.writeSync(this._logHandle, NULLBYTE);
            fs.writeSync(this._logHandle, keyStr.length + "," + valueStr.length + "," + keyStr + valueStr);
            fs.writeSync(this._logHandle, bloom_1.MurmurHash3(0, keyStr + valueStr)); // data checksum
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
        if (!skiplog)
            this._maybeFlushLog();
    };
    SnapWorker.prototype._get = function (key) {
        this._indexCacheClear();
        // check cache first
        if (this.memoryCache) {
            if (typeof this._cache[key] !== "undefined") {
                return this._cache[key];
            }
            else {
                throw new Error("Key not found!");
            }
        }
        // check memtable
        if (this._memTable[key]) {
            if (this._memTable[key] === SnapWorker.tomb) {
                throw new Error("Key not found!");
            }
            return this._memTable[key];
        }
        // find latest key entry on disk
        var strKey = String(key);
        var candidateFiles = [];
        this._manifestData.lvl.forEach(function (lvl, i) {
            lvl.files.forEach(function (fileInfo) {
                if (i === 0) { // level 0, no range check
                    if (bloom_1.BloomFilter.contains(fileInfo.bloom.vData, fileInfo.bloom.nHashFuncs, fileInfo.bloom.nTweak, strKey)) {
                        candidateFiles.push(fileInfo.i);
                    }
                }
                else { // level 1+, do range check then bloom filter
                    if (fileInfo.range[0] >= key && fileInfo.range[1] <= key) {
                        if (bloom_1.BloomFilter.contains(fileInfo.bloom.vData, fileInfo.bloom.nHashFuncs, fileInfo.bloom.nTweak, strKey)) {
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
        candidateFiles = candidateFiles.sort(function (a, b) { return a < b ? 1 : -1; });
        var fileIdx = 0;
        while (fileIdx < candidateFiles.length) {
            var fileID = candidateFiles[fileIdx];
            var index = this._indexFileCache[fileID] ? this._indexFileCache[fileID].cache : JSON.parse(fs.readFileSync(path.join(this._path, common_1.fileName(fileID) + ".idx"), "utf-8"));
            if (this._indexFileCache[fileID]) {
                this._indexFileCache[fileID].lastUsed = Date.now();
            }
            else {
                this._indexFileCache[fileID] = { cache: index, lastUsed: Date.now() };
            }
            if (typeof index.keys[strKey] !== "undefined") {
                var dataStart = index.keys[strKey][0];
                var dataLength = index.keys[strKey][1];
                if (dataStart === -1) { // tombstone found
                    throw new Error("Key not found!");
                }
                var fd = fs.openSync(path.join(this._path, common_1.fileName(fileID) + ".dta"), "r");
                var buff = new Buffer(dataLength);
                fs.readSync(fd, buff, 0, dataLength, dataStart);
                return buff.toString("utf-8");
            }
            fileIdx++;
        }
        ;
        throw new Error("Key not found!");
    };
    SnapWorker.prototype._maybeFlushLog = function () {
        if (this._doingTx || this._isCompacting) {
            return;
        }
        // flush at 4 megabytes 4000000
        if (this._memTableSize > 200) {
            var nextFile = this._manifestData.inc + 1;
            var wasmFNs3 = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
            var wasmFNs4 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };
            var it_1 = wasmFNs3[this.keyType](this._memTableIndex, 0).split(",").map(function (s) { return parseInt(s); });
            var key = void 0;
            var count = 0;
            var bloom = bloom_1.BloomFilter.create(it_1[1], 0.1);
            try {
                // remove possible partial files from previous run
                fs.unlinkSync(common_1.fileName(nextFile) + ".idx");
                fs.unlinkSync(common_1.fileName(nextFile) + ".dta");
            }
            catch (e) {
                // no need to catch this error or care about it, happens if files don't exist.
            }
            var levelFileIdx = fs.openSync(path.join(this._path, common_1.fileName(nextFile) + ".idx"), "a+");
            var levelFileDta = fs.openSync(path.join(this._path, common_1.fileName(nextFile) + ".dta"), "a+");
            var dataLen = 0;
            var dataHash = crypto.createHash("sha1");
            var keyHash = crypto.createHash("sha1");
            var indexJSON = {
                keys: {},
                hash: ""
            };
            while (count < it_1[1]) {
                key = wasmFNs4[this.keyType](this._memTableIndex, it_1[0], 0, count);
                var strKey = String(key);
                var data = this._memTable[key];
                if (data === SnapWorker.tomb) { // tombstone
                    // write index
                    indexJSON.keys[key] = [-1, 0]; // tombstone
                    bloom.insert(strKey);
                }
                else {
                    // write index
                    indexJSON.keys[key] = [dataLen, data.length];
                    bloom.insert(strKey);
                    // write data
                    fs.writeSync(levelFileDta, data);
                    dataHash.update(data);
                    dataLen += data.length;
                }
                count++;
            }
            // checksums for integrity
            fs.writeSync(levelFileDta, NULLBYTE);
            fs.writeSync(levelFileDta, NULLBYTE);
            fs.writeSync(levelFileDta, dataHash.digest("base64"));
            indexJSON.hash = keyHash.update(JSON.stringify(indexJSON.keys)).digest("base64");
            fs.writeSync(levelFileIdx, JSON.stringify(indexJSON));
            // flush to disk
            fs.fsyncSync(levelFileDta);
            fs.fsyncSync(levelFileIdx);
            fs.closeSync(levelFileDta);
            fs.closeSync(levelFileIdx);
            // update manifest
            if (!this._manifestData.lvl[0]) {
                this._manifestData.lvl[0] = {
                    comp: 0,
                    files: []
                };
            }
            this._manifestData.lvl[0].files.push({ i: nextFile, range: [0, 0], bloom: bloom.toObject() });
            this._manifestData.inc = nextFile;
            common_1.writeManifestUpdate(this._path, this._manifestData);
            // empty memtable
            this._memTable = {};
            this._memTableSize = 0;
            var wasmClearFns = { "string": this._mod.empty_index_str, "int": this._mod.empty_index_int, "float": this._mod.empty_index };
            wasmClearFns[this.keyType](this._memTableIndex);
            // empty logfile
            fs.closeSync(this._logHandle);
            fs.unlinkSync(path.join(this._path, "LOG"));
            this._logHandle = fs.openSync(path.join(this._path, "LOG"), "a+");
            this._maybeCompact();
        }
    };
    SnapWorker.prototype._maybeCompact = function () {
        this._isCompacting = true;
        if (process.send)
            process.send({ type: "snap-compact" });
    };
    /**
     * Migrate SQLite files to new database file format.
     *
     * @private
     * @returns
     * @memberof SnapWorker
     */
    SnapWorker.prototype._checkForMigration = function () {
        if (fs.existsSync(this._path) && !fs.lstatSync(this._path).isDirectory()) {
            console.log("Attempting to migrate from SQLite database...");
            console.log("If this process doesn't complete remove the '-old' from your SQLite database file and try again");
            try {
                fs.renameSync(this._path, this._path + "-old");
                this._getFiles();
                // SQLite database (old format)
                // Read SQLite data and copy it to new format, then delete it
                var dbData = this._mod.database_create(this._path + "-old", { "float": 0, "string": 1, "int": 2 }[this.keyType]);
                if (!dbData) {
                    throw new Error("Unable to connect to database at " + this._path + "-old");
                }
                this._indexNum = parseInt(dbData.split(",")[1]);
                this._dbNum = parseInt(dbData.split(",")[0]);
                var getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
                var getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };
                var itALL = getAllFNS[this.keyType](this._indexNum, 0);
                if (!itALL) {
                    this._ready();
                    return;
                }
                itALL = itALL.split(",").map(function (s) { return parseInt(s); });
                var nextKeyALL = void 0;
                var countALL = 0;
                while (countALL < itALL[1]) {
                    nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
                    this._put(nextKeyALL, this._mod.database_get(this._dbNum, String(nextKeyALL)));
                    countALL++;
                }
                console.log("SQLite migration completed.");
                this._ready();
            }
            catch (e) {
                console.error("Problem migrating from SQLite database!");
                console.error(e);
            }
        }
        else {
            this._getFiles();
            this._ready();
        }
    };
    SnapWorker.prototype._ready = function () {
        var _this = this;
        process.on('message', function (msg) {
            var key = msg.key;
            var msgId = msg.id;
            switch (msg.type) {
                case "compact-done":
                    _this._isCompacting = false;
                    _this._manifestData = JSON.parse((fs.readFileSync(path.join(_this._path, "manifest.json")) || new Buffer([])).toString("utf-8"));
                    if (process.send)
                        process.send({ type: "snap-compact-done", id: msgId });
                    if (_this._isConnecting) {
                        _this._isConnecting = false;
                        if (process.send)
                            process.send({ type: "snap-ready" });
                    }
                    break;
                case "snap-get":
                    try {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "get", data: [undefined, _this._get(key)] });
                    }
                    catch (e) {
                        console.error(e);
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "get", data: ["Unable to get key!", ""] });
                    }
                    break;
                case "snap-del":
                    try {
                        _this._del(key);
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "delete", data: [] });
                    }
                    catch (e) {
                        console.error(e);
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "delete", data: ["Unable to delete key! " + key] });
                    }
                    break;
                case "snap-put":
                    try {
                        _this._put(key, msg.value);
                        if (_this.memoryCache) {
                            _this._cache[key] = msg.value;
                        }
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "put", data: [] });
                    }
                    catch (e) {
                        console.error(e);
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, event: "put", data: ["Error writing value!"] });
                    }
                    break;
                case "snap-get-all-keys":
                    var wasmFNs3 = { "string": _this._mod.read_index_str, "int": _this._mod.read_index_int, "float": _this._mod.read_index };
                    var wasmFNs4 = { "string": _this._mod.read_index_str_next, "int": _this._mod.read_index_int_next, "float": _this._mod.read_index_next };
                    var it_2 = wasmFNs3[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0).split(",").map(function (s) { return parseInt(s); });
                    if (!it_2) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, data: [] });
                        return;
                    }
                    var nextKey = 0;
                    var count = 0;
                    while (count < it_2[1]) {
                        nextKey = wasmFNs4[_this.keyType](_this._indexNum, it_2[0], msg.reverse ? 1 : 0, count);
                        if (process.send)
                            process.send({ type: "snap-res", event: "get-keys", id: msg.id, data: ["response", nextKey] });
                        count++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", event: "get-keys-end", id: msg.id, data: [] });
                    break;
                case "snap-count":
                    var wasmCountFns = { "string": _this._mod.get_total_str, "int": _this._mod.get_total_int, "float": _this._mod.get_total };
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "get-count", data: [undefined, wasmCountFns[_this.keyType](_this._indexNum)] });
                    break;
                case "snap-start-tx":
                    if (_this._doingTx === true) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, data: ["Can't do nested transactions, finish the current one first!", ""] });
                        return;
                    }
                    var newTXNum = 0;
                    while (newTXNum === 0 || newTXNum === _this._txNum) {
                        newTXNum = Math.round(Math.random() * 256);
                    }
                    _this._txNum = newTXNum;
                    // transaction start
                    fs.writeSync(_this._logHandle, NULLBYTE);
                    fs.writeSync(_this._logHandle, "TX-START-" + _this._txNum);
                    _this._doingTx = true;
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "tx-start", data: [undefined, _this._txNum] });
                    break;
                case "snap-end-tx":
                    // transaction end
                    fs.writeSync(_this._logHandle, NULLBYTE);
                    fs.writeSync(_this._logHandle, "TX-END-" + _this._txNum);
                    fs.fsyncSync(_this._logHandle);
                    _this._doingTx = false;
                    _this._maybeFlushLog();
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "tx-end", data: [undefined, _this._txNum] });
                    break;
                case "snap-get-all":
                    var getAllFNS = { "string": _this._mod.read_index_str, "int": _this._mod.read_index_int, "float": _this._mod.read_index };
                    var getALLFNS2 = { "string": _this._mod.read_index_str_next, "int": _this._mod.read_index_int_next, "float": _this._mod.read_index_next };
                    var itALL = getAllFNS[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0);
                    if (!itALL) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, event: "get-all-end", data: [] });
                        return;
                    }
                    itALL = itALL.split(",").map(function (s) { return parseInt(s); });
                    var nextKeyALL = void 0;
                    var countALL = 0;
                    while (countALL < itALL[1]) {
                        nextKeyALL = getALLFNS2[_this.keyType](_this._indexNum, itALL[0], msg.reverse ? 1 : 0, countALL);
                        if (process.send)
                            process.send({ type: "snap-res", id: msg.id, event: "get-all", data: ["response", nextKeyALL, _this._get(nextKeyALL)] });
                        countALL++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "get-all-end", data: [] });
                    break;
                case "snap-get-offset":
                    var offsetWasmFN = { "string": _this._mod.read_index_offset_str, "int": _this._mod.read_index_offset_int, "float": _this._mod.read_index_offset };
                    var offsetWasmFN2 = { "string": _this._mod.read_index_offset_str_next, "int": _this._mod.read_index_offset_int_next, "float": _this._mod.read_index_offset_next };
                    var offsetIT = offsetWasmFN[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0, msg.offset);
                    if (offsetIT === 0) {
                        if (process.send)
                            process.send({ type: "snap-res-done", event: "get-offset-end", id: msg.id, data: [] });
                        return;
                    }
                    var nextKeyOffset = 0;
                    var countOffset = 0;
                    while (countOffset < msg.limit) {
                        nextKeyOffset = offsetWasmFN2[_this.keyType](_this._indexNum, offsetIT, msg.reverse ? 1 : 0, msg.limit, countOffset);
                        if (process.send)
                            process.send({ type: "snap-res", id: msg.id, event: "get-offset", data: ["response", nextKeyOffset, _this._get(nextKeyOffset)] });
                        countOffset++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "get-offset-end", data: [] });
                    break;
                case "snap-get-range":
                    var wasmFNsRange = { "string": _this._mod.read_index_range_str, "int": _this._mod.read_index_range_int, "float": _this._mod.read_index_range };
                    var wasmFNsRange2 = { "string": _this._mod.read_index_range_str_next, "int": _this._mod.read_index_range_int_next, "float": _this._mod.read_index_range_next };
                    var rangeIT = wasmFNsRange[_this.keyType](_this._indexNum, msg.lower, msg.higher, msg.reverse ? 1 : 0);
                    if (!rangeIT) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, event: "get-range-end", data: [] });
                        return;
                    }
                    rangeIT = rangeIT.split(",").map(function (s) { return parseInt(s); });
                    var nextKeyRange = void 0;
                    var countRange = 0;
                    while (countRange < rangeIT[1]) {
                        nextKeyRange = wasmFNsRange2[_this.keyType](_this._indexNum, rangeIT[0], msg.reverse ? 1 : 0, countRange);
                        if (process.send)
                            process.send({ type: "snap-res", id: msg.id, event: "get-range", data: ["response", nextKeyRange, _this._get(nextKeyRange)] });
                        countRange++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, event: "get-range-end", data: [] });
                    break;
                case "snap-close":
                    var wasmDelFns = { "string": _this._mod.empty_index_str, "int": _this._mod.empty_index_int, "float": _this._mod.empty_index };
                    // clear index
                    wasmDelFns[_this.keyType](_this._indexNum);
                    // close log file
                    fs.closeSync(_this._logHandle);
                    if (process.send)
                        process.send({ type: "snap-close-done", id: msg.id, data: [] });
                    break;
                case "snap-clear":
                    _this._isCompacting = true;
                    var wasmClearFns = { "string": _this._mod.empty_index_str, "int": _this._mod.empty_index_int, "float": _this._mod.empty_index };
                    // clear index
                    wasmClearFns[_this.keyType](_this._indexNum);
                    // clear database
                    // remove all files in db folder
                    fs.readdir(_this._path, function (err, files) {
                        if (err)
                            throw err;
                        for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
                            var file = files_1[_i];
                            fs.unlink(path.join(_this._path, file), function (err) {
                                if (err)
                                    throw err;
                            });
                        }
                    });
                    // setup new manifest
                    _this._getFiles();
                    if (process.send)
                        process.send({ type: "snap-clear-done", id: msg.id, data: [] });
                    _this._isCompacting = false;
                    _this._doingTx = false;
                    break;
            }
        });
    };
    /**
     * Loads previously saved data into cache if cache is enabled.
     *
     * @private
     * @param {() => void} complete
     * @param {(err) => void} onErr
     * @returns
     * @memberof SnapDB
     */
    SnapWorker.prototype._loadCache = function (complete, onErr) {
        var wasmFNs = { "string": this._mod.get_total_str, "int": this._mod.get_total_int, "float": this._mod.get_total };
        var total = wasmFNs[this.keyType](this._indexNum);
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        var getAllFNS = { "string": this._mod.read_index_str, "int": this._mod.read_index_int, "float": this._mod.read_index };
        var getALLFNS2 = { "string": this._mod.read_index_str_next, "int": this._mod.read_index_int_next, "float": this._mod.read_index_next };
        var itALL = getAllFNS[this.keyType](this._indexNum, 0).split(",").map(function (s) { return parseInt(s); });
        var nextKeyALL = 0;
        var countALL = 0;
        while (countALL < itALL[1]) {
            nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
            this._cache[String(nextKeyALL)] = this._mod.database_get(this._dbNum, String(nextKeyALL)) || "";
            countALL++;
        }
        complete();
    };
    /**
     * Get all the keys from unqlite and load them into index
     *
     * @private
     * @memberof SnapDB
     */
    SnapWorker.prototype._loadKeys = function () {
        var _this = this;
        var parseLogLine = function (line) {
            // log record line:
            // keyKength,valueLength,key value hash
            var buffer = "";
            var i = 0;
            while (line[i] !== "," && i < line.length) {
                buffer += line[i];
                i++;
            }
            i++;
            var keyLen = parseInt(buffer);
            buffer = "";
            if (isNaN(keyLen)) {
                throw new Error("Error parsing log file!");
            }
            while (line[i] !== "," && i < line.length) {
                buffer += line[i];
                i++;
            }
            i++;
            var valueLen = parseInt(buffer);
            buffer = "";
            if (isNaN(valueLen)) {
                throw new Error("Error parsing log file!");
            }
            var k = 0;
            while (k < keyLen && k < line.length) {
                buffer += line[i + k];
                k++;
            }
            var key = _this.keyType === "string" ? buffer : parseFloat(buffer);
            if (valueLen === -1) { // tombstone
                return [key, -1];
            }
            buffer = "";
            k = 0;
            while (k < valueLen && k < line.length) {
                buffer += line[i + k + keyLen];
                k++;
            }
            var value = buffer;
            buffer = "";
            k = i + keyLen + valueLen;
            while (k < line.length) {
                buffer += line[k];
                k++;
            }
            if (bloom_1.MurmurHash3(0, String(key) + value) !== parseInt(buffer)) {
                console.warn("Integrity check failed for the following key, value not imported.");
                console.warn(key);
                return [];
            }
            return [key, value];
        };
        // load LOG file into memtable
        var LOGFILE = fs.readFileSync(path.join(this._path, "LOG"));
        if (LOGFILE.length === 0) {
            // nothing to load, all done
            if (process.send)
                process.send({ type: "snap-ready" });
        }
        else {
            // import logfile into merge tree
            var events = [];
            var buffer = "";
            var i = 1;
            while (i < LOGFILE.length) {
                if (LOGFILE[i] === 0) {
                    events.push(buffer);
                    buffer = "";
                }
                else {
                    buffer += String.fromCharCode(LOGFILE[i]);
                }
                i++;
            }
            events.push(buffer);
            buffer = "";
            var tx_1 = 0;
            var batches_1 = [];
            events.forEach(function (event) {
                if (event.indexOf("TX-START") === 0) { // start transaction
                    // clear previouse transaction data
                    tx_1 = parseInt(event.replace("TX-START-", ""));
                    batches_1 = [];
                }
                else if (event.indexOf("TX-END") === 0) { // end of transaction
                    var endTx = tx_1 = parseInt(event.replace("TX-END-", ""));
                    if (endTx === tx_1) { // commit batch
                        batches_1.forEach(function (bEvent) {
                            var rowData = parseLogLine(bEvent);
                            if (rowData.length) {
                                if (rowData[1] === -1) {
                                    _this._del(rowData[0], true);
                                }
                                else {
                                    _this._put(rowData[0], rowData[1], true);
                                }
                            }
                        });
                        batches_1 = [];
                    }
                    tx_1 = 0;
                }
                else { // normal record
                    if (tx_1 === 0) { // not in transaction
                        var rowData = parseLogLine(event);
                        if (rowData.length) {
                            if (rowData[1] === -1) {
                                _this._del(rowData[0], true);
                            }
                            else {
                                _this._put(rowData[0], rowData[1], true);
                            }
                        }
                    }
                    else { // in transaction
                        batches_1.push(event);
                    }
                }
            });
            this._isConnecting = true;
            this._maybeFlushLog();
        }
    };
    SnapWorker.tomb = NULLBYTE;
    return SnapWorker;
}());
process.on('message', function (msg) {
    switch (msg.type) {
        case "snap-connect":
            new SnapWorker(msg.path, msg.keyType, msg.cache);
            break;
    }
});
//# sourceMappingURL=child.js.map