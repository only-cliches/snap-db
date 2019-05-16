const wasm = require("./db.js");

class SnapWorker {

    private _cache: {
        [key: string]: string;
    } = {};

    public _indexNum: number;
    public _dbNum: number;

    constructor(
        public _path: string,
        public keyType: string,
        public memoryCache: boolean
    ) {
        const checkReady = () => {
            if (wasm.loaded) {
                this._getReady();
            } else {
                setTimeout(checkReady, 100);
            }
        }
        checkReady();

    }

    private _getReady() {

        const dbData = wasm.database_create(this._path, { "float": 0, "string": 1, "int": 2 }[this.keyType]);
        if (!dbData) {
            throw new Error("Unable to connect to database at " + this._path);
        }
        this._indexNum = parseInt(dbData.split(",")[1]);
        this._dbNum = parseInt(dbData.split(",")[0]);

        this._loadKeys();

        process.on('message', (msg) => { // got message from master
            const key = msg.key;
            const msgId = msg.id;
            switch (msg.type) {
                case "snap-get":

                    if (this._cache[String(key)] && this._cache[String(key)].length) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, this._cache[String(key)]] })
                    } else {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [undefined, wasm.database_get(this._dbNum, String(key))] })
                    }
                    break;
                case "snap-del":
                    // delete key from memory
                    const wasmFNs2 = { "string": wasm.del_key_str, "int": wasm.del_key_int, "float": wasm.del_key };
                    wasmFNs2[this.keyType](this._indexNum, key);

                    // delete key from database
                    const result2 = wasm.database_del(this._dbNum, String(key));
                    delete this._cache[String(key)];
                    if (result2 === 1) {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: ["Unable to delete key! " + key] })
                    } else {
                        if (process.send) process.send({ type: "snap-res-done", id: msgId, data: [] })
                    }

                    break;
                case "snap-put":
                    // write key to memory
                    const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
                    wasmFNs[this.keyType](this._indexNum, key);

                    // write data to database
                    const result = wasm.database_put(this._dbNum, this._cache[String(key)] === undefined ? 1 : 0, String(key), msg.value);

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

                    const wasmFNs3 = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
                    const wasmFNs4 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };

                    const it = wasmFNs3[this.keyType](this._indexNum, msg.reverse ? 1 : 0).split(",").map(s => parseInt(s));
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
                    const wasmCountFns = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [undefined, wasmCountFns[this.keyType](this._indexNum)] })
                    break;
                case "snap-start-tx":
                    wasm.database_start_tx(this._indexNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-end-tx":
                    wasm.database_end_tx(this._indexNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] });
                    break;
                case "snap-get-all":
                    const getAllFNS = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
                    const getALLFNS2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };

                    const itALL = getAllFNS[this.keyType](this._indexNum, msg.reverse ? 1 : 0).split(",").map(s => parseInt(s));
                    let nextKeyALL: any;
                    let countALL = 0;

                    while (countALL < itALL[1]) {
                        nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], msg.reverse ? 1 : 0, countALL);
                        if (this._cache[String(nextKeyALL)] && this._cache[String(nextKeyALL)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, this._cache[String(nextKeyALL)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyALL, wasm.database_get(this._dbNum, String(nextKeyALL))] })
                        }
                        countALL++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                    break;
                case "snap-get-offset":
                    const offsetWasmFN = { "string": wasm.read_index_offset_str, "int": wasm.read_index_offset_int, "float": wasm.read_index_offset };
                    const offsetWasmFN2 = { "string": wasm.read_index_offset_str_next, "int": wasm.read_index_offset_int_next, "float": wasm.read_index_offset_next };

                    const offsetIT = offsetWasmFN[this.keyType](this._indexNum, msg.reverse ? 1 : 0, msg.offset);
                    let nextKeyOffset: any = 0;
                    let countOffset = 0;

                    while (countOffset < msg.limit) {
                        nextKeyOffset = offsetWasmFN2[this.keyType](this._indexNum, offsetIT, msg.reverse ? 1 : 0, msg.limit, countOffset);
                        if (this._cache[String(nextKeyOffset)] && this._cache[String(nextKeyOffset)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, this._cache[String(nextKeyOffset)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyOffset, wasm.database_get(this._dbNum, String(nextKeyOffset))] })
                        }
                        countOffset++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })
                    break;
                case "snap-get-range":
                    const wasmFNsRange = { "string": wasm.read_index_range_str, "int": wasm.read_index_range_int, "float": wasm.read_index_range };
                    const wasmFNsRange2 = { "string": wasm.read_index_range_str_next, "int": wasm.read_index_range_int_next, "float": wasm.read_index_range_next };

                    const rangeIT = wasmFNsRange[this.keyType](this._indexNum, msg.lower, msg.higher, msg.reverse ? 1 : 0).split(",").map(s => parseInt(s));

                    let nextKeyRange: any;
                    let isDoneRange = false;
                    let countRange = 0;

                    while (countRange < rangeIT[1]) {
                        nextKeyRange = wasmFNsRange2[this.keyType](this._indexNum, rangeIT[0], msg.reverse ? 1 : 0, countRange);
                        if (this._cache[String(nextKeyRange)] && this._cache[String(nextKeyRange)].length) {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, this._cache[String(nextKeyRange)]] })
                        } else {
                            if (process.send) process.send({ type: "snap-res", id: msg.id, data: ["response", nextKeyRange, wasm.database_get(this._dbNum, String(nextKeyRange))] })
                        }
                        countRange++;
                    }
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: [] })

                    break;
                case "snap-close":
                    const wasmDelFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                    // clear index
                    wasmDelFns[this.keyType](this._indexNum);

                    // close database
                    wasm.database_close(this._dbNum);
                    if (process.send) process.send({ type: "snap-res-done", id: msg.id, data: []})
                    break;
                case "snap-clear":
                    const wasmClearFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                    // clear index
                    wasmClearFns[this.keyType](this._indexNum);

                    // clear database
                    const resultClear = wasm.database_clear(this._dbNum);
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

        const wasmFNs = { "string": wasm.get_total_str, "int": wasm.get_total_int, "float": wasm.get_total };
        const total = wasmFNs[this.keyType](this._indexNum);

        if (total === 0 || !this.memoryCache) {
            complete();
            return;
        }
        const getAllFNS = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
        const getALLFNS2 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };
        
        const itALL = getAllFNS[this.keyType](this._indexNum, 0).split(",").map(s => parseInt(s));
        let nextKeyALL: any = 0;
        let countALL = 0;

        while (countALL < itALL[1]) {
            nextKeyALL = getALLFNS2[this.keyType](this._indexNum, itALL[0], 0, countALL);
            this._cache[String(nextKeyALL)] = wasm.database_get(this._dbNum, String(nextKeyALL)) || "";
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

        const ptr = wasm.database_cursor(this._dbNum);
        let nextKey: any = 0;
        let lastKey: any;
        let isDone = false;
        let count = 0;

        while (!isDone) {
            nextKey = wasm.database_cursor_next(this._dbNum, ptr, count);
            if (count === 0 && !nextKey) {
                isDone = true;
            } else {
                if (nextKey === lastKey) {
                    isDone = true;
                } else {
                    const dataKey = this.keyType === "string" ? nextKey : parseFloat(nextKey);
                    // write key to memory
                    const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
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
            this._loadCache(() => {
                if (process.send) process.send({ type: "snap-ready" });
            }, (err) => {
                throw new Error(err);
            })
        } else {
            if (process.send) process.send({ type: "snap-ready" });
        }

    }
}

process.on('message', (msg) => { // got message from master
    switch (msg.type) {
        case "snap-connect":
            new SnapWorker(msg.path, msg.keyType, msg.cache);
            break;
    }
});