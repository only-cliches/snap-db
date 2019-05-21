Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var child_process_1 = require("child_process");
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
        this._path = fileName === ":memory:" ? fileName : (path.isAbsolute(fileName) ? fileName : path.join(process.cwd(), fileName));
        this._worker = child_process_1.fork(path.join(__dirname, "child.js"));
        this._worker.on("message", function (msg) {
            switch (msg.type) {
                case "snap-ready":
                    _this._isReady = true;
                    break;
                case "snap-res":
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    break;
                case "snap-res-done":
                    messageBuffer[msg.id].apply(null, [msg.data]);
                    delete messageBuffer[msg.id];
                    break;
            }
        });
        this._worker.send({ type: "snap-connect", path: this._path, cache: this.memoryCache, keyType: this.keyType });
    }
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

    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

const db = new SnapDB<number>("my-db-test", "int");
db.ready().then(() => {
    console.log("READY");

    let arr: any[] = [];
    let count = 10000;
    for (let i = 0; i < count; i++) {
        arr.push([i + 1, makeid(), makeid()]);
    }

    arr = arr.sort((a, b) => Math.random() > 0.5 ? 1 : -1);
    const writeStart = Date.now();
    let last: any;
    db.begin_transaction().then(() => {
        return Promise.all(arr.map(r => db.put(r[0], r[2])))
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
            });
        }, false);
    })
});*/ 
//# sourceMappingURL=index.js.map