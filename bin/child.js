var wasm = require("./db.js");
var SnapWorker = /** @class */ (function () {
    function SnapWorker(_path, keyType, memoryCache) {
        var _this = this;
        this._path = _path;
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this._cache = {};
        var checkReady = function () {
            if (wasm.loaded) {
                _this._getReady();
            }
            else {
                setTimeout(checkReady, 100);
            }
        };
        checkReady();
    }
    SnapWorker.prototype._getReady = function () {
        var _this = this;
        var dbData = wasm.database_create(this._path, { "float": 0, "string": 1, "int": 2 }[this.keyType]);
        if (!dbData) {
            throw new Error("Unable to connect to database at " + this._path);
        }
        this._indexNum = parseInt(dbData.split(",")[1]);
        this._dbNum = parseInt(dbData.split(",")[0]);
        this._loadKeys();
        process.on('message', function (msg) {
            var key = msg.key;
            var msgId = msg.id;
            switch (msg.type) {
                case "snap-get":
                    if (_this._cache[String(key)] && _this._cache[String(key)].length) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, data: [undefined, _this._cache[String(key)]] });
                    }
                    else {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, data: [undefined, wasm.database_get(_this._dbNum, String(key))] });
                    }
                    break;
                case "snap-del":
                    // delete key from memory
                    var wasmFNs2 = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs2[_this.keyType](_this._indexNum, key);
                    // delete key from database
                    var result2 = wasm.database_del(_this._dbNum, String(key));
                    delete _this._cache[String(key)];
                    if (result2 === 1) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, data: ["Unable to delete key! " + key] });
                    }
                    else {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msgId, data: [] });
                    }
                    break;
                case "snap-put":
                    // write key to memory
                    var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[_this.keyType](_this._indexNum, key);
                    // write data to database
                    var result = wasm.database_put(_this._dbNum, _this._cache[String(key)] === undefined ? 1 : 0, String(key), msg.value);
                    _this._cache[String(key)] = _this.memoryCache ? msg.value : "";
                    if (process.send) {
                        if (result === 0) {
                            process.send({ type: "snap-res-done", id: msgId, data: [] });
                        }
                        else {
                            process.send({ type: "snap-res-done", id: msgId, data: ["Error writing value!"] });
                        }
                    }
                    break;
                case "snap-get-all-keys":
                    var wasmFNs3 = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
                    var wasmFNs4 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
                    var it_1 = wasmFNs3[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0).split(",").map(function (s) { return parseInt(s); });
                    var nextKey = 0;
                    var count = 0;
                    while (count < it_1[1]) {
                        nextKey = wasmFNs4[_this.keyType](_this._indexNum, it_1[0], msg.reverse ? 1 : 0, count);
                        if (_this._cache[String(nextKey)] !== undefined) {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKey] });
                        }
                        count++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-count":
                    var wasmCountFns = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [undefined, wasmCountFns[_this.keyType](_this._indexNum)] });
                    break;
                case "snap-start-tx":
                    wasm.database_start_tx(_this._indexNum);
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-end-tx":
                    wasm.database_end_tx(_this._indexNum);
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-get-all":
                    var getAllFNS = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
                    var getALLFNS2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
                    var itALL = getAllFNS[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0).split(",").map(function (s) { return parseInt(s); });
                    var nextKeyALL = void 0;
                    var countALL = 0;
                    while (countALL < itALL[1]) {
                        nextKeyALL = getALLFNS2[_this.keyType](_this._indexNum, itALL[0], msg.reverse ? 1 : 0, countALL);
                        if (_this._cache[String(nextKeyALL)] && _this._cache[String(nextKeyALL)].length) {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, _this._cache[String(nextKeyALL)]] });
                        }
                        else {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, wasm.database_get(_this._dbNum, String(nextKeyALL))] });
                        }
                        countALL++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-get-offset":
                    var offsetWasmFN = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
                    var offsetWasmFN2 = { "string": wasm.read_index_offset_str_next, "int": wasm.read_index_offset_int_next, "float": wasm.read_index_offset_next };
                    var offsetIT = offsetWasmFN[_this.keyType](_this._indexNum, msg.reverse ? 1 : 0, msg.offset);
                    var nextKeyOffset = 0;
                    var countOffset = 0;
                    while (countOffset < msg.limit) {
                        nextKeyOffset = offsetWasmFN2[_this.keyType](_this._indexNum, offsetIT, msg.reverse ? 1 : 0, msg.limit, countOffset);
                        if (_this._cache[String(nextKeyOffset)] && _this._cache[String(nextKeyOffset)].length) {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, _this._cache[String(nextKeyOffset)]] });
                        }
                        else {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, wasm.database_get(_this._dbNum, String(nextKeyOffset))] });
                        }
                        countOffset++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-get-range":
                    var wasmFNsRange = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
                    var wasmFNsRange2 = { "string": wasm.read_index_range_str_next, "int": wasm.read_index_range_int_next, "float": wasm.read_index_range_next };
                    var rangeIT = wasmFNsRange[_this.keyType](_this._indexNum, msg.lower, msg.higher, msg.reverse ? 1 : 0).split(",").map(function (s) { return parseInt(s); });
                    var nextKeyRange = void 0;
                    var isDoneRange = false;
                    var countRange = 0;
                    while (countRange < rangeIT[1]) {
                        nextKeyRange = wasmFNsRange2[_this.keyType](_this._indexNum, rangeIT[0], msg.reverse ? 1 : 0, countRange);
                        if (_this._cache[String(nextKeyRange)] && _this._cache[String(nextKeyRange)].length) {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, _this._cache[String(nextKeyRange)]] });
                        }
                        else {
                            if (process.send)
                                process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, wasm.database_get(_this._dbNum, String(nextKeyRange))] });
                        }
                        countRange++;
                    }
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-close":
                    var wasmDelFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                    // clear index
                    wasmDelFns[_this.keyType](_this._indexNum);
                    // close database
                    wasm.database_close(_this._dbNum);
                    if (process.send)
                        process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-clear":
                    var wasmClearFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                    // clear index
                    wasmClearFns[_this.keyType](_this._indexNum);
                    // clear database
                    var resultClear = wasm.database_clear(_this._dbNum);
                    if (resultClear === 0) {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    }
                    else {
                        if (process.send)
                            process.send({ type: "snap-res-done", id: msg.id, data: ["Error clearing database!"] });
                    }
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
        var wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        var total = wasmFNs[this.keyType](this._indexNum);
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        var getAllFNS = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        var getALLFNS2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
        var itALL = getAllFNS[this.keyType](this._indexNum, 0).split(",").map(function (s) { return parseInt(s); });
        var nextKeyALL = 0;
        var countALL = 0;
        while (countALL < itALL[1]) {
            nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
            this._cache[String(nextKeyALL)] = wasm.database_get(this._dbNum, String(nextKeyALL)) || "";
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
                if (process.send)
                    process.send({ type: "snap-ready" });
            }, function (err) {
                throw new Error(err);
            });
        }
        else {
            if (process.send)
                process.send({ type: "snap-ready" });
        }
    };
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