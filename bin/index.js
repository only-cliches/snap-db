Object.defineProperty(exports, "__esModule", { value: true });
var wasm = require("./db.js");
var path = require("path");
var SnapDB = /** @class */ (function () {
    /**
     * Creates an instance of SnapDB.
     *
     * @param {string} fileName
     * @param {("string" | "float" | "int")} keyType
     * @param {boolean} [memoryCache]
     * @memberof SnapDB
     */
    function SnapDB(fileName, keyType, memoryCache) {
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this._cache = {};
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
            _this._cache[String(key)] = wasm.database_get(_this._dbNum, String(key));
        }, function () {
            complete();
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
                var dbData = wasm.database_create(_this._path, { "float": 0, "string": 1, "int": 2 }[_this.keyType]);
                if (!dbData) {
                    throw new Error("Unable to connect to database at " + _this._path);
                }
                _this._indexNum = parseInt(dbData.split(",")[1]);
                _this._dbNum = parseInt(dbData.split(",")[0]);
                _this._loadKeys();
            }
            else {
                setTimeout(checkReady, 100);
            }
        };
        checkReady();
    };
    /**
     * Get all the keys from unqlite and load them into index
     *
     * @private
     * @memberof SnapDB
     */
    SnapDB.prototype._loadKeys = function () {
        var _this = this;
        var ptr = wasm.database_cursor(this._dbNum);
        var nextKey = 0;
        var lastKey;
        var isDone = false;
        var count = 0;
        while (!isDone) {
            nextKey = wasm.database_cursor_next(this._dbNum, ptr, count);
            if (count === 0 && !nextKey) {
                isDone = true;
            }
            else {
                if (nextKey === lastKey) {
                    isDone = true;
                }
                else {
                    var dataKey = this.keyType === "string" ? nextKey : parseFloat(nextKey);
                    // write key to memory
                    var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
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
            this._loadCache(function () {
                _this._isReady = true;
            }, function (err) {
                throw new Error(err);
            });
        }
        else {
            this._isReady = true;
        }
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
    SnapDB.prototype.get = function (key) {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        if (typeof this._cache[String(key)] === "string") {
            return this._cache[String(key)];
        }
        return wasm.database_get(this._dbNum, String(key));
    };
    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<boolean>}
     * @memberof SnapDB
     */
    SnapDB.prototype.delete = function (key) {
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        // delete key from memory
        var wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
        wasmFNs[this.keyType](this._indexNum, key);
        // delete key from database
        var result = wasm.database_del(this._dbNum, String(key));
        delete this._cache[String(key)];
        if (result === 1) {
            throw new Error("Unable to delete key! " + key);
        }
        return 0;
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
        if (!this._isReady) {
            throw new Error("Database not ready!");
        }
        // write key to memory
        var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
        wasmFNs[this.keyType](this._indexNum, key);
        // write data to database
        var result = wasm.database_put(this._dbNum, String(key), data);
        this._cache[String(key)] = this.memoryCache ? data : "";
        if (result === 0) {
            return 0;
        }
        else {
            throw new Error("Error writing value!");
        }
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
                onRecord(nextKey);
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
                if (this._cache[String(nextKey)] || this._cache[String(nextKey)] === "") {
                    onRecord(nextKey, this.get(nextKey));
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
                if (this._cache[String(nextKey)]) {
                    onRecord(nextKey, this.get(nextKey));
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
                if (this._cache[String(nextKey)]) {
                    onRecord(nextKey, this.get(nextKey));
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
function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
var db = new SnapDB("my-db", "int", true);
db.ready().then(function () {
    var arr = [];
    var count = 10000;
    for (var i = 1; i <= count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }
    arr = arr.sort(function (a, b) { return Math.random() > 0.5 ? 1 : -1; });
    var writeStart = Date.now();
    var last;
    Promise.all(arr.map(function (r) {
        if (r[0] === 1029) {
            last = r[0];
            // console.log(r[2]);
        }
        return db.put(r[0], r[2]);
    })).then(function (data) {
        console.log((count / (Date.now() - writeStart) * 1000).toLocaleString(), "Records Per Second (WRITE)");
        var start = Date.now();
        console.time("READ");
        db.getAll(function (key, data) {
        }, function (err) {
            if (err) {
                console.log(err);
            }
            console.log((db.getCount() / (Date.now() - start) * 1000).toLocaleString(), "Records Per Second (READ)");
        }, false);
    });
});
//# sourceMappingURL=index.js.map