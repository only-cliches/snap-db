Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var child_process_1 = require("child_process");
var common_1 = require("./common");
var really_small_events_1 = require("really-small-events");
var fs = require("fs");
var messageBuffer = {};
exports.rand = function () {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 6; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
};
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
        var _this = this;
        this.keyType = keyType;
        this.memoryCache = memoryCache;
        this.version = common_1.VERSION;
        this._hasEvents = false;
        this.isCompacting = false;
        this.isTx = false;
        this._path = path.resolve(fileName);
        this._rse = new really_small_events_1.ReallySmallEvents();
        this._worker = child_process_1.fork(path.join(__dirname, "database.js"));
        this._compactor = child_process_1.fork(path.join(__dirname, "compact.js"));
        var clearCompactFiles = [];
        this._worker.on("message", function (msg) {
            switch (msg.type) {
                case "snap-ready":
                    _this._isReady = true;
                    break;
                case "snap-compact":
                    _this.isCompacting = true;
                    _this._compactor.send("do-compact");
                    if (_this._hasEvents)
                        _this._rse.trigger("compact-start", { target: _this, time: Date.now() });
                    break;
                case "snap-compact-done":
                    _this.isCompacting = false;
                    // safe to remove old files now
                    clearCompactFiles.forEach(function (fileID) {
                        try {
                            fs.unlinkSync(path.join(_this._path, common_1.fileName(fileID) + ".dta"));
                            fs.unlinkSync(path.join(_this._path, common_1.fileName(fileID) + ".idx"));
                            fs.unlinkSync(path.join(_this._path, common_1.fileName(fileID) + ".bom"));
                        }
                        catch (e) {
                        }
                    });
                    clearCompactFiles = [];
                    if (_this._hasEvents)
                        _this._rse.trigger("compact-end", { target: _this, time: Date.now() });
                    break;
                case "snap-res":
                    if (msg.event && _this._hasEvents) {
                        _this._rse.trigger(msg.event, { target: _this, time: Date.now(), data: msg.data });
                    }
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    break;
                case "snap-res-done":
                    if (msg.event && _this._hasEvents) {
                        _this._rse.trigger(msg.event, { target: _this, time: Date.now(), data: msg.data });
                    }
                    if (msg.event === "tx-start") {
                        _this.isTx = true;
                    }
                    if (msg.event === "tx-end") {
                        _this.isTx = false;
                    }
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    break;
                case "snap-clear-done":
                    _this._isReady = true;
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    if (_this._hasEvents)
                        _this._rse.trigger("clear", { target: _this, time: Date.now() });
                    break;
                case "snap-close-done":
                    _this._isReady = false;
                    _this._compactor.kill();
                    _this._worker.kill();
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    if (_this._hasEvents)
                        _this._rse.trigger("close", { target: _this, time: Date.now() });
                    break;
            }
        });
        this._compactor.on("message", function (msg) {
            if (msg.type === "compact-done") {
                clearCompactFiles = msg.files;
                _this._worker.send({ type: "compact-done" });
            }
        });
        this._worker.send({ type: "snap-connect", path: this._path, cache: this.memoryCache, keyType: this.keyType });
        this._compactor.send({ type: "snap-compact", path: this._path, cache: this.memoryCache, keyType: this.keyType });
    }
    /**
     * Listen for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    SnapDB.prototype.on = function (event, callback) {
        this._hasEvents = true;
        this._rse.on(event, callback);
    };
    /**
     * Turn off listener for events
     *
     * @param {string} event
     * @param {() => void} callback
     * @memberof SnapDB
     */
    SnapDB.prototype.off = function (event, callback) {
        this._rse.off(event, callback);
    };
    SnapDB.prototype.doCompaction = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (_this.isCompacting === true) {
                rej("Already compacting!");
                return;
            }
            rej("Not implemented yet!");
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
                    _this._rse.trigger("ready", { target: _this, time: Date.now() });
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
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res(data[1]);
                }
            };
            _this._worker.send({ type: "snap-get", key: key, id: msgId });
        });
    };
    /**
     * Delete a key and it's value from the data store.
     *
     * @param {K} key
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.delete = function (key) {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res(data[1]);
                }
            };
            _this._worker.send({ type: "snap-del", key: key, id: msgId });
        });
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
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res(data[1]);
                }
            };
            _this._worker.send({ type: "snap-put", key: key, value: data, id: msgId });
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
        var msgId = exports.rand();
        while (messageBuffer[msgId]) {
            msgId = exports.rand();
        }
        messageBuffer[msgId] = function (data) {
            if (data[0] === "response") {
                onRecord(data[1]);
            }
            else {
                onComplete();
            }
        };
        this._worker.send({ type: "snap-get-all-keys", id: msgId, reverse: reverse });
    };
    /**
     * Starts a transaction.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.begin_transaction = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res();
                }
            };
            _this._worker.send({ type: "snap-start-tx", id: msgId });
        });
    };
    /**
     * Ends a transaction.
     *
     * @returns
     * @memberof SnapDB
     */
    SnapDB.prototype.end_transaction = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res();
                }
            };
            _this._worker.send({ type: "snap-end-tx", id: msgId });
        });
    };
    /**
     * Get the total number of keys in the data store.
     *
     * @returns {Promise<number>}
     * @memberof SnapDB
     */
    SnapDB.prototype.getCount = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                rej("Database not ready!");
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res(parseInt(data[1]));
                }
            };
            _this._worker.send({ type: "snap-count", id: msgId });
        });
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
        var msgId = exports.rand();
        while (messageBuffer[msgId]) {
            msgId = exports.rand();
        }
        messageBuffer[msgId] = function (data) {
            if (data[0] === "response") {
                onRecord(data[1], data[2]);
            }
            else {
                onComplete();
            }
        };
        this._worker.send({ type: "snap-get-all", id: msgId, reverse: reverse });
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
        var msgId = exports.rand();
        while (messageBuffer[msgId]) {
            msgId = exports.rand();
        }
        messageBuffer[msgId] = function (data) {
            if (data[0] === "response") {
                onRecord(data[1], data[2]);
            }
            else {
                onComplete();
            }
        };
        this._worker.send({ type: "snap-get-range", id: msgId, lower: lower, higher: higher, reverse: reverse });
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
        var msgId = exports.rand();
        while (messageBuffer[msgId]) {
            msgId = exports.rand();
        }
        messageBuffer[msgId] = function (data) {
            if (data[0] === "response") {
                onRecord(data[1], data[2]);
            }
            else {
                onComplete();
            }
        };
        this._worker.send({ type: "snap-get-offset", id: msgId, offset: offset, limit: limit, reverse: reverse });
    };
    /**
     * Closes database
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.close = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                res();
                return;
            }
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                _this._worker.kill();
                _this._isReady = false;
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res();
                }
            };
            _this._worker.send({ type: "snap-close", id: msgId });
        });
    };
    /**
     * Empty all keys and values from database.
     *
     * @returns {Promise<any>}
     * @memberof SnapDB
     */
    SnapDB.prototype.empty = function () {
        var _this = this;
        return new Promise(function (res, rej) {
            if (!_this._isReady) {
                res();
                return;
            }
            _this._isReady = false;
            var msgId = exports.rand();
            while (messageBuffer[msgId]) {
                msgId = exports.rand();
            }
            messageBuffer[msgId] = function (data) {
                if (data[0]) {
                    rej(data[0]);
                }
                else {
                    res();
                }
            };
            // kill compactor thread (don't care what it's doing)
            _this._compactor.kill();
            // spin up new compactor thread
            _this._compactor = child_process_1.fork(path.join(__dirname, "compact.js"));
            _this._compactor.on("message", function (msg) {
                if (msg === "compcact-done") {
                    _this._worker.send({ type: "compact-done" });
                }
            });
            _this._compactor.send({ type: "snap-compact", path: _this._path, cache: _this.memoryCache, keyType: _this.keyType });
            _this._worker.send({ type: "snap-clear", id: msgId });
        });
    };
    return SnapDB;
}());
exports.SnapDB = SnapDB;
/*
function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < Math.ceil(Math.random() * 400) + 100; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

const db = new SnapDB<number>("my-db-test", "int", true);
db.ready().then(() => {
    console.log("READY");

    let arr: any[] = [];
    let count = 100000;
    for (let i = 0; i < count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }

    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
    const start = Date.now();
    let ct = 0;
    let read = false;
    if (read) {
        db.getAll((key, data) => {
            ct++;
            // console.log(key, data);
        }, (err) => {
            if (err) {
                console.log(err);
            }
            const time = (Date.now() - start);
            db.getCount().then((ct) => {
                console.log(((ct / time) * 1000).toLocaleString(), "Records Per Second (READ)");
                return db.close();
            });
        }, false);
    } else {
        db.begin_transaction().then(() => {
            return Promise.all(arr.map(r => {
                return db.put(r[0], r[2]);
            }))
        }).then(() => {
            return db.end_transaction();
        }).then(() => {
            console.log((count / (Date.now() - writeStart) * 1000).toLocaleString(), "Records Per Second (WRITE)");
            const start = Date.now();
            let ct = 0;
            db.getAll((key, data) => {
                ct++;
                // console.log(key, data);
            }, (err) => {
                if (err) {
                    console.log(err);
                }
                const time = (Date.now() - start);
                db.getCount().then((ct) => {
                    console.log(((ct / time) * 1000).toLocaleString(), "Records Per Second (READ)");
                    return db.close();
                });
            }, false);
        }).catch((err) => {
            console.trace()
        })
    }
});*/ 
//# sourceMappingURL=index.js.map