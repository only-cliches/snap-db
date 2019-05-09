Object.defineProperty(exports, "__esModule", { value: true });
var wasm = require("./db-index.js");
var path = require("path");
var fs = require("fs");
var SnapDB = /** @class */ (function () {
    /**
     * Creates an instance of SnapDB.
     *
     * @param {string} folderName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    function SnapDB(folderName, keyType, memoryCache) {
        var _this = this;
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this._currentFileIdx = 0;
        this._currentFileLen = 0;
        this._dataFiles = [];
        this._dataStreams = [];
        this._cache = {};
        this._keyData = {};
        this._path = path.isAbsolute(folderName) ? folderName : path.join(process.cwd(), folderName);
        // create the database folder if it's not already in place
        var exists = fs.existsSync(this._path);
        if (exists) {
            this._checkWasmReady();
        }
        else {
            fs.mkdir(this._path, function (err) {
                if (err) {
                    throw err;
                }
                else {
                    _this._checkWasmReady();
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
    SnapDB.prototype._loadCache = function (complete, onErr) {
        var _this = this;
        var allDone = false;
        var count = 0;
        var hasErr = false;
        var wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        var total = wasmFNs[this.keyType](this._indexNum);
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        this.getAllKeys(function (key) {
            if (hasErr)
                return;
            count++;
            var setKey = _this._makeKey(key);
            _this._readValue(setKey, false, function (err, data) {
                if (err) {
                    hasErr = true;
                    onErr(err);
                }
                else {
                    _this._cache[setKey] = data;
                    count--;
                    if (count === 0 && allDone) {
                        complete();
                    }
                }
            });
        }, function () {
            if (hasErr)
                return;
            allDone = true;
        });
    };
    /**
     * Check if WASM module has been initiliazed.
     *
     * @private
     * @memberof SnapDB
     */
    SnapDB.prototype._checkWasmReady = function () {
        var _this = this;
        var checkReady = function () {
            if (wasm.loaded) {
                switch (_this.keyType) {
                    case "string":
                        _this._indexNum = wasm.new_index_str();
                        break;
                    case "int":
                        _this._indexNum = wasm.new_index_int();
                        break;
                    case "float":
                        _this._indexNum = wasm.new_index();
                        break;
                }
                _this._loadIndexFromDisk();
            }
            else {
                setTimeout(checkReady, 100);
            }
        };
        checkReady();
    };
    /**
     * Loads previously created database details into disk.
     * Optionally loads cache from disk.
     *
     * @private
     * @memberof SnapDB
     */
    SnapDB.prototype._loadIndexFromDisk = function () {
        var _this = this;
        Promise.all([0, 1, 2].map(function (s) {
            return new Promise(function (res, rej) {
                switch (s) {
                    case 0:
                        var exists_1 = fs.existsSync(path.join(_this._path, ".keys"));
                        fs.open(path.join(_this._path, ".keys"), "a", function (err, fd) {
                            if (err) {
                                rej(err);
                                return;
                            }
                            if (!exists_1) {
                                _this._keyStream = fs.createWriteStream(path.join(_this._path, ".keys"), { autoClose: false, flags: "r+" });
                                // new key file
                                _this._keyStream.write(_this.keyType + "\n", "utf8", function (err) {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    res();
                                });
                            }
                            else {
                                var writeKeys_1 = function (keys) {
                                    for (var i = 0; i < keys.length; i++) {
                                        if (keys[i].trim().length) {
                                            var keyData = keys[i].trim().split("::").map(function (s, k) {
                                                if (k === 0) {
                                                    if (_this.keyType !== "string") {
                                                        return parseFloat(s);
                                                    }
                                                    return Buffer.from(s, "hex").toString("utf8");
                                                }
                                                else {
                                                    return s.split(/,/gmi).map(function (s) { return parseInt(s); });
                                                }
                                            });
                                            var totalVals = keyData[1][0] + keyData[1][1] + keyData[1][2];
                                            var useKey = _this._makeKey(keyData[0]);
                                            if (totalVals === 0) { // deleted key
                                                var wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                                                wasmFNs[_this.keyType](_this._indexNum, keyData[0]);
                                                delete _this._keyData[useKey];
                                            }
                                            else { // new key value
                                                var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                                                wasmFNs[_this.keyType](_this._indexNum, keyData[0]);
                                                _this._keyData[useKey] = keyData[1];
                                            }
                                        }
                                    }
                                };
                                // restore keys to memory
                                fs.readFile(path.join(_this._path, ".keys"), function (err, data) {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    _this._keyStream = fs.createWriteStream(path.join(_this._path, ".keys"), { start: data.length, autoClose: false, flags: "r+" });
                                    var keys = data.toString().split(/\n/gmi);
                                    _this.keyType = keys.shift().trim();
                                    writeKeys_1(keys);
                                    fs.readFile(path.join(_this._path, ".tombs"), function (err, data) {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        var keys = data.toString().split(/\n/gmi);
                                        writeKeys_1(keys);
                                        res();
                                    });
                                });
                            }
                        });
                        break;
                    case 1:
                        var attach_1 = function () {
                            var exists = fs.existsSync(path.join(_this._path, _this._currentFileIdx + ".data"));
                            if (!exists && _this._currentFileIdx === 0) { // initial startup
                                fs.open(path.join(_this._path, _this._currentFileIdx + ".data"), "w+", function (err, fd) {
                                    if (err) {
                                        rej(err);
                                        return;
                                    }
                                    _this._dataFiles[_this._currentFileIdx] = fd;
                                    _this._dataStreams[_this._currentFileIdx] = fs.createWriteStream(path.join(_this._path, _this._currentFileIdx + ".data"), { autoClose: false, flags: "r+" });
                                    res();
                                });
                            }
                            else { // subsequent
                                if (exists) {
                                    fs.open(path.join(_this._path, _this._currentFileIdx + ".data"), "r+", function (err, fd) {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        _this._dataFiles[_this._currentFileIdx] = fd;
                                        _this._currentFileIdx++;
                                        attach_1();
                                    });
                                }
                                else {
                                    // found latest data file, prepare to write to it
                                    _this._currentFileIdx--;
                                    fs.fstat(_this._dataFiles[_this._currentFileIdx], function (err, stats) {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        _this._dataStreams[_this._currentFileIdx] = fs.createWriteStream(path.join(_this._path, _this._currentFileIdx + ".data"), { autoClose: false, start: stats.size, flags: "r+" });
                                        _this._currentFileLen = stats.size;
                                        res();
                                    });
                                }
                            }
                        };
                        attach_1();
                        break;
                    case 2:
                        var tombsExist = fs.existsSync(path.join(_this._path, ".tombs"));
                        if (tombsExist) {
                            var tombLength = fs.statSync(path.join(_this._path, ".tombs")).size;
                            _this._tombStream = fs.createWriteStream(path.join(_this._path, ".tombs"), { autoClose: false, start: tombLength, flags: "r+" });
                        }
                        else {
                            fs.writeFileSync(path.join(_this._path, ".tombs"), "");
                            _this._tombStream = fs.createWriteStream(path.join(_this._path, ".tombs"), { autoClose: false, start: 0, flags: "r+" });
                        }
                        res();
                        break;
                }
            });
        })).then(function () {
            return new Promise(function (res, rej) {
                _this._loadCache(res, rej);
            });
        }).then(function () {
            _this._isReady = true;
        }).catch(function (err) {
            throw err;
        });
    };
    /**
     * This promise returns when the database is ready to use.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.ready = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            var checkReady = function () {
                if (_this._isReady) {
                    res();
                }
                else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    };
    /**
     * Currently does nothing.
     *
     * @param {(err: any) => void} complete
     * @memberof SnapDB
     */
    SnapDB.prototype.do_compaction = function (complete) {
        if (!this._isReady) {
            complete("Database not ready!");
            return;
        }
    };
    /**
     * Get a single value from the database at the given key.
     *
     * @param {K} key
     * @returns {Promise<string>}
     * @memberof SnapDB
     */
    SnapDB.prototype.get = function (key) {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var useKey = _this._makeKey(key);
            _this._readValue(useKey, true, function (err, data) {
                if (err) {
                    rej(err);
                }
                else {
                    res(data);
                }
            });
        });
    };
    SnapDB.prototype._readValue = function (key, useCache, complete) {
        var dataInfo = this._keyData[key];
        if (!dataInfo) {
            complete(new Error("Key not found!"), "");
        }
        else {
            if (useCache && this.memoryCache && this._cache[key]) {
                complete(undefined, this._cache[key]);
                return;
            }
            var readBuffer = Buffer.alloc(dataInfo[2]);
            fs.read(this._dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], function (err, bytesRead, buffer) {
                if (err) {
                    complete(err, "");
                    return;
                }
                complete(undefined, buffer.toString("utf8"));
            });
        }
    };
    SnapDB.prototype._readValueSync = function (key, useCache) {
        var dataInfo = this._keyData[key];
        if (!dataInfo) {
            throw new Error("Key not found!");
        }
        else {
            if (useCache && this.memoryCache && this._cache[key]) {
                return this._cache[key];
            }
            var readBuffer = Buffer.alloc(dataInfo[2]);
            fs.readSync(this._dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1]);
            return readBuffer.toString("utf8");
        }
    };
    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    SnapDB.prototype.delete = function (key) {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var useKey = _this._makeKey(key);
            var dataLoc = _this._keyData[useKey];
            if (!dataLoc) { // key not found
                rej();
            }
            else { // key found
                _this._tombStream.write(useKey + "::" + [0, 0, 0].join(",") + "\n", "utf8", function (err) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    // write key to memory
                    var wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs[_this.keyType](_this._indexNum, useKey);
                    delete _this._keyData[useKey];
                    // delete done
                    res();
                });
            }
        });
    };
    SnapDB.prototype._makeKey = function (key) {
        return this.keyType === "string" ? Buffer.from(String(key), "utf8").toString("hex") : key;
    };
    /**
     * Put a key and value into the data store.
     * Replaces existing values with new values at the given key, otherwise creates a new key.
     *
     * @param {K} key
     * @param {string} data
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.put = function (key, data) {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var _writeData = function (dataValues, key, data) {
                // write data
                var count = 0;
                _this._currentFileLen += dataValues[2];
                _this._dataStreams[dataValues[0]].write(data, "utf8", function (err) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    count++;
                    if (count === 1) {
                        res();
                    }
                });
                var keyValue = _this._makeKey(key);
                if (!_this._keyData[keyValue]) {
                    // write key to memory
                    var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[_this.keyType](_this._indexNum, key);
                }
                _this._keyData[keyValue] = dataValues;
                // write key data
                _this._keyStream.write(keyValue + "::" + dataValues.join(",") + "\n", "utf8", function (err) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    if (_this.memoryCache) {
                        _this._cache[keyValue] = data;
                    }
                    count++;
                    if (count === 1) {
                        res();
                    }
                });
            };
            var dataLen = data.length;
            // 64 MB data file limit size
            if (_this._currentFileLen + dataLen > 64000000) {
                _this._currentFileIdx++;
                _this._currentFileLen = 0;
                _this._dataFiles[_this._currentFileIdx] = fs.openSync(path.join(_this._path, _this._currentFileIdx + ".data"), "w+");
                _writeData([_this._currentFileIdx, 0, dataLen], key, data);
            }
            else {
                var newDataValues = [_this._currentFileIdx, _this._currentFileLen, dataLen];
                _writeData(newDataValues, key, data);
            }
        });
    };
    /**
     * Get all keys from the data store in order.
     *
     * @param {(key: K) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    SnapDB.prototype.getAllKeys = function (onRecord, onComplete, reverse) {
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }
        var wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        var wasmFNs2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
        var it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0);
        var nextKey = 0;
        var lastKey;
        var isDone = false;
        var count = 0;
        while (!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            }
            else {
                count++;
                var dataKey = this._makeKey(nextKey);
                if (this._keyData[dataKey]) {
                    var thisKey = this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey);
                }
                lastKey = nextKey;
            }
        }
        onComplete();
    };
    /**
     * Get the total number of keys in the data store.
     *
     * @returns {number}
     * @memberof SnapDB
     */
    SnapDB.prototype.getCount = function () {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        var wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        return wasmFNs[this.keyType](this._indexNum);
    };
    /**
     * Get all keys and values from the store in order.
     *
     * @param {(key: K, data: string) => void} onRecord
     * @param {(err?: any) => void} onComplete
     * @param {boolean} [reverse]
     * @memberof SnapDB
     */
    SnapDB.prototype.getAll = function (onRecord, onComplete, reverse) {
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }
        var wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        var wasmFNs2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
        var it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0);
        var nextKey = 0;
        var lastKey;
        var isDone = false;
        var count = 0;
        while (!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            }
            else {
                var dataKey = this._makeKey(nextKey);
                if (this._keyData[dataKey]) {
                    var value = this._readValueSync(dataKey, true);
                    var thisKey = this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey, value);
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
    };
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
    SnapDB.prototype.range = function (lower, higher, onRecord, onComplete, reverse) {
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }
        var wasmFNs = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
        var wasmFNs2 = { "string": wasm.read_index_range_str_next, "int": wasm.read_index_range_int_next, "float": wasm.read_index_range_next };
        var it = wasmFNs[this.keyType](this._indexNum, lower, higher, reverse ? 1 : 0);
        var nextKey = 0;
        var lastKey;
        var isDone = false;
        var count = 0;
        while (!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, count);
            if (nextKey === lastKey) {
                isDone = true;
            }
            else {
                var dataKey = this._makeKey(nextKey);
                if (this._keyData[dataKey]) {
                    var value = this._readValueSync(dataKey, true);
                    var thisKey = this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey, value);
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
    };
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
    SnapDB.prototype.offset = function (offset, limit, onRecord, onComplete, reverse) {
        if (!this._isReady) {
            onComplete("Database not ready!");
            return;
        }
        var wasmFNs = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
        var wasmFNs2 = { "string": wasm.read_index_offset_str_next, "int": wasm.read_index_offset_int_next, "float": wasm.read_index_offset_next };
        var it = wasmFNs[this.keyType](this._indexNum, reverse ? 1 : 0, offset);
        var nextKey = 0;
        var lastKey;
        var isDone = false;
        var count = 0;
        while (!isDone) {
            nextKey = wasmFNs2[this.keyType](this._indexNum, it, reverse ? 1 : 0, limit, count);
            if (nextKey === lastKey) {
                isDone = true;
            }
            else {
                var dataKey = this._makeKey(nextKey);
                if (this._keyData[dataKey]) {
                    var value = this._readValueSync(dataKey, true);
                    var thisKey = this.keyType !== "string" ? parseFloat(dataKey) : Buffer.from(dataKey, "hex").toString("utf8");
                    onRecord(thisKey, value);
                }
                lastKey = nextKey;
            }
            count++;
        }
        onComplete();
    };
    return SnapDB;
}());
exports.SnapDB = SnapDB;
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
//# sourceMappingURL=index.js.map