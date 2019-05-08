Object.defineProperty(exports, "__esModule", { value: true });
var wasm = require("./db-index.js");
var path = require("path");
var fs = require("fs");
global.snapDB = {
    cbs: {}
};
var SnapDB = /** @class */ (function () {
    function SnapDB(folderName, keyType, memoryCache) {
        var _this = this;
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this._currentFileIdx = 0;
        this._currentFileLen = 0;
        this.dataFiles = [];
        this.dataStreams = [];
        this._cache = {};
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
    SnapDB.prototype._loadCache = function (complete, onErr) {
        var _this = this;
        var allDone = false;
        var count = 0;
        var hasErr = false;
        var total = this.getCount();
        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        this.getAllKeys(function (key) {
            if (hasErr)
                return;
            count++;
            var setKey = _this._makeKey(key);
            _this.get(key, true).then(function (data) {
                _this._cache[setKey] = data;
                count--;
                if (count === 0 && allDone) {
                    complete();
                }
            }).catch(function (err) {
                hasErr = true;
                onErr(err);
            });
        }, function () {
            if (hasErr)
                return;
            allDone = true;
        });
    };
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
                                _this.keyStream = fs.createWriteStream(path.join(_this._path, ".keys"), { autoClose: false, flags: "r+" });
                                // new key file
                                _this.keyStream.write(_this.keyType + "\n", "utf8", function (err) {
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
                                            if (totalVals === 0) { // deleted key
                                                var wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                                                wasmFNs[_this.keyType](_this._indexNum, keyData[0]);
                                            }
                                            else { // new key value
                                                var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                                                wasmFNs[_this.keyType](_this._indexNum, keyData[0], keyData[1][0], keyData[1][1], keyData[1][2]);
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
                                    _this.keyStream = fs.createWriteStream(path.join(_this._path, ".keys"), { start: data.length, autoClose: false, flags: "r+" });
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
                                    _this.dataFiles[_this._currentFileIdx] = fd;
                                    _this.dataStreams[_this._currentFileIdx] = fs.createWriteStream(path.join(_this._path, _this._currentFileIdx + ".data"), { autoClose: false, flags: "r+" });
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
                                        _this.dataFiles[_this._currentFileIdx] = fd;
                                        _this._currentFileIdx++;
                                        attach_1();
                                    });
                                }
                                else {
                                    // found latest data file, prepare to write to it
                                    _this._currentFileIdx--;
                                    fs.fstat(_this.dataFiles[_this._currentFileIdx], function (err, stats) {
                                        if (err) {
                                            rej(err);
                                            return;
                                        }
                                        _this.dataStreams[_this._currentFileIdx] = fs.createWriteStream(path.join(_this._path, _this._currentFileIdx + ".data"), { autoClose: false, start: stats.size, flags: "r+" });
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
                            _this.tombStream = fs.createWriteStream(path.join(_this._path, ".tombs"), { autoClose: false, start: tombLength, flags: "r+" });
                        }
                        else {
                            fs.writeFileSync(path.join(_this._path, ".tombs"), "");
                            _this.tombStream = fs.createWriteStream(path.join(_this._path, ".tombs"), { autoClose: false, start: 0, flags: "r+" });
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
    SnapDB.prototype.do_compaction = function (complete) {
    };
    SnapDB.prototype.get = function (key, skipCache) {
        var _this = this;
        return new Promise(function (res, rej) {
            var useKey = _this._makeKey(key);
            if (!skipCache && _this.memoryCache && _this._cache[useKey]) {
                res(_this._cache[useKey]);
                return;
            }
            var wasmFNs = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };
            var dataLoc = wasmFNs[_this.keyType](_this._indexNum, key);
            if (dataLoc === "n") {
                rej();
            }
            else {
                var dataInfo = dataLoc.split(",").map(function (s) { return parseInt(s); });
                var readBuffer = Buffer.alloc(dataInfo[2]);
                fs.read(_this.dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], function (err, bytesRead, buffer) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    res(buffer.toString("utf8"));
                });
            }
        });
    };
    SnapDB.prototype.delete = function (key) {
        var _this = this;
        return new Promise(function (res, rej) {
            var wasmFNs = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };
            var dataLoc = wasmFNs[_this.keyType](_this._indexNum, key);
            if (dataLoc === "n") { // key not found
                rej();
            }
            else { // key found
                var dataInfo = dataLoc.split(",").map(function (s) { return parseInt(s); });
                var keyData = _this._makeKey(key);
                _this.tombStream.write(keyData + "::" + [0, 0, 0].join(",") + "\n", "utf8", function (err) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    // write key to memory
                    var wasmFNs = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs[_this.keyType](_this._indexNum, _this._makeKey(key));
                    // delete done
                    res();
                });
            }
        });
    };
    SnapDB.prototype._makeKey = function (key) {
        return this.keyType === "string" ? Buffer.from(String(key), "utf8").toString("hex") : key;
    };
    SnapDB.prototype.put = function (key, data) {
        var _this = this;
        return new Promise(function (res, rej) {
            var _writeData = function (dataValues, key, data) {
                // write data
                _this._currentFileLen += dataValues[2];
                _this.dataStreams[dataValues[0]].write(data, "utf8", function (err) {
                    if (err) {
                        rej(err);
                        return;
                    }
                    // write key to memory
                    var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[_this.keyType].apply(wasmFNs, [_this._indexNum, key].concat(dataValues));
                    var keyValue = _this._makeKey(key);
                    // write key
                    _this.keyStream.write(keyValue + "::" + dataValues.join(",") + "\n", "utf8", function (err) {
                        if (err) {
                            rej(err);
                            return;
                        }
                        if (_this.memoryCache) {
                            _this._cache[keyValue] = data;
                        }
                        res();
                    });
                });
            };
            var dataLen = data.length;
            // 64 MB data file limit size
            if (_this._currentFileLen + dataLen > 64000000) {
                _this._currentFileIdx++;
                _this._currentFileLen = 0;
                _this.dataFiles[_this._currentFileIdx] = fs.openSync(path.join(_this._path, _this._currentFileIdx + ".data"), "w+");
                _writeData([_this._currentFileIdx, 0, dataLen], key, data);
            }
            else {
                var newDataValues = [_this._currentFileIdx, _this._currentFileLen, dataLen];
                _writeData(newDataValues, key, data);
            }
        });
    };
    SnapDB.prototype.getAllKeys = function (onRecord, onComplete, reverse) {
        var _this = this;
        var wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        var len = Object.keys(global.snapDB.cbs).length;
        var hasErr = false;
        // setup callback
        global.snapDB.cbs[len] = function (data, done) {
            if (hasErr) {
                return;
            }
            if (done === 1) {
                onComplete();
                delete global.snapDB.cbs[len];
            }
            else {
                try {
                    var thisKey = _this.keyType !== "string" ? parseFloat(data) : Buffer.from(data, "hex").toString("utf8");
                    onRecord(thisKey);
                }
                catch (e) {
                    delete global.snapDB.cbs[len];
                    hasErr = true;
                    onComplete(e);
                }
            }
        };
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, reverse ? 1 : 0);
    };
    SnapDB.prototype.getCount = function () {
        var wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        return wasmFNs[this.keyType](this._indexNum);
    };
    SnapDB.prototype.getAll = function (onRecord, onComplete, reverse) {
        var wasmFNs = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        var len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        var cb = new SnapCallBack(this, onRecord, function (err) {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, reverse ? 1 : 0);
    };
    SnapDB.prototype.range = function (lower, higher, onRecord, onComplete, reverse) {
        var wasmFNs = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
        var len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        var cb = new SnapCallBack(this, onRecord, function (err) {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, lower, higher, reverse ? 1 : 0);
    };
    SnapDB.prototype.offset = function (offset, limit, onRecord, onComplete, reverse) {
        var wasmFNs = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
        var len = Object.keys(global.snapDB.cbs).length;
        // delete global.snapDB.cbs[len];
        var cb = new SnapCallBack(this, onRecord, function (err) {
            onComplete(err);
            delete global.snapDB.cbs[len];
        });
        global.snapDB.cbs[len] = cb.call;
        // trigger the read
        wasmFNs[this.keyType](this._indexNum, len, limit, offset, reverse ? 1 : 0);
    };
    return SnapDB;
}());
exports.SnapDB = SnapDB;
var SnapCallBack = /** @class */ (function () {
    function SnapCallBack(parent, onRecord, onComplete) {
        this.parent = parent;
        this.onRecord = onRecord;
        this.onComplete = onComplete;
        this.hasErr = false;
        this.counter = 0;
        this.allDone = false;
        this.call = this.call.bind(this);
    }
    SnapCallBack.prototype.call = function (data, done) {
        var _this = this;
        var that = this.parent;
        var wasmFNs2 = { "string": wasm.get_from_index_str, "int": wasm.get_from_index_int, "float": wasm.get_from_index };
        if (this.hasErr) {
            return;
        }
        if (done === 1) {
            this.allDone = true;
            if (that.memoryCache) {
                this.onComplete();
            }
        }
        else {
            if (that._cache[data]) {
                var thisKey = that.keyType !== "string" ? parseFloat(data) : Buffer.from(data, "hex").toString("utf8");
                this.onRecord(thisKey, that._cache[data]);
                return;
            }
            try {
                var dataLoc = wasmFNs2[that.keyType](that._indexNum, data);
                var dataInfo = dataLoc.split(",").map(function (s) { return parseInt(s); });
                var readBuffer = Buffer.alloc(dataInfo[2]);
                this.counter++;
                fs.read(that.dataFiles[dataInfo[0]], readBuffer, 0, dataInfo[2], dataInfo[1], function (err, bytesRead, buffer) {
                    if (err) {
                        _this.hasErr = true;
                        _this.onComplete(err);
                        return;
                    }
                    var thisKey = that.keyType !== "string" ? parseFloat(data) : Buffer.from(data, "hex").toString("utf8");
                    _this.onRecord(thisKey, buffer.toString());
                    _this.counter--;
                    if (_this.counter === 0 && _this.allDone === true) {
                        _this.onComplete();
                    }
                });
            }
            catch (e) {
                this.hasErr = true;
                this.onComplete(e);
            }
        }
    };
    return SnapCallBack;
}());
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
//# sourceMappingURL=index.js.map