Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var wasm = require("./db.js");
var common_1 = require("./common");
var bloom_1 = require("./bloom");
var SnapCompactor = /** @class */ (function () {
    function SnapCompactor(path, keyType, cache) {
        var _this = this;
        this.path = path;
        this.keyType = keyType;
        this.cache = cache;
        this._manifestData = {
            v: common_1.VERSION,
            inc: 0,
            lvl: []
        };
        this._bloomCache = {};
        process.on("message", function (msg) {
            if (msg === "do-compact") {
                _this._runCompaction();
            }
        });
    }
    SnapCompactor.prototype._getBloom = function (fileID) {
        if (this._bloomCache[fileID]) {
            return this._bloomCache[fileID];
        }
        this._bloomCache[fileID] = JSON.parse(fs.readFileSync(path.join(this.path, common_1.fileName(fileID) + ".bom"), "utf-8"));
        return this._bloomCache[fileID];
    };
    SnapCompactor.prototype._runCompaction = function () {
        var _this = this;
        this._manifestData = JSON.parse((fs.readFileSync(path.join(this.path, "manifest.json")) || new Buffer([])).toString("utf-8") || '{"inc": 0, "lvl": []}');
        var wasmFNs = { "string": wasm.new_index_str, "int": wasm.new_index_int, "float": wasm.new_index };
        var compactIndex = wasmFNs[this.keyType]();
        var compactObj = {};
        var hasOlderValues = function (key, level) {
            var currentLevel = level + 1;
            var nextLevel = function () {
                if (_this._manifestData.lvl[currentLevel]) {
                    var i = _this._manifestData.lvl[currentLevel].files.length;
                    while (i--) {
                        var fileInfo = _this._manifestData.lvl[currentLevel].files[i];
                        if (fileInfo.range[0] <= key && fileInfo.range[1] >= key) {
                            var bloom = _this._getBloom(fileInfo.i);
                            if (bloom_1.BloomFilter.contains(bloom.vData, bloom.nHashFuncs, bloom.nTweak, String(key))) {
                                return true;
                            }
                        }
                    }
                    currentLevel++;
                    return nextLevel();
                }
                return false;
            };
            return nextLevel();
        };
        var loadFile = function (fileID, level) {
            var wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
            var index = JSON.parse(fs.readFileSync(path.join(_this.path, common_1.fileName(fileID) + ".idx"), "utf-8"));
            var data = fs.readFileSync(path.join(_this.path, common_1.fileName(fileID) + ".dta"), "utf-8");
            Object.keys(index.keys).forEach(function (key) {
                wasmFNs[_this.keyType](compactIndex, _this.keyType === "string" ? key : parseFloat(key));
                if (index.keys[key][0] === -1) { // tombstone
                    // if higher level has this key, keep tombstone.  Otherwise discard it
                    compactObj[key] = hasOlderValues(key, level) ? common_1.NULLBYTE : undefined;
                }
                else {
                    compactObj[key] = data.slice(index.keys[key][0], index.keys[key][0] + index.keys[key][1]);
                }
            });
        };
        var deleteFiles = [];
        this._manifestData.lvl.forEach(function (lvl, i) {
            var maxSizeMB = Math.pow(10, i + 1);
            var size = 0;
            lvl.files.forEach(function (file) {
                var fName = common_1.fileName(file.i);
                size += (fs.statSync(path.join(_this.path, fName) + ".dta").size / 1000000.0);
                size += (fs.statSync(path.join(_this.path, fName) + ".idx").size / 1000000.0);
                size += (fs.statSync(path.join(_this.path, fName) + ".bom").size / 1000000.0);
            });
            if (size > maxSizeMB) { // compact this level
                if (i === 0) { // level 0 to level 1, merge all files since keys probably overlap
                    // load older files first
                    if (_this._manifestData.lvl[1]) {
                        _this._manifestData.lvl[1].files.forEach(function (file) {
                            // mark all existing level 1 files for deletion
                            deleteFiles.push([1, file.i]);
                            loadFile(file.i, 1);
                        });
                    }
                    // then newer files
                    lvl.files.forEach(function (file) {
                        // mark all existing level 0 files for deletion
                        deleteFiles.push([i, file.i]);
                        loadFile(file.i, 0);
                    });
                    // write files to disk
                    common_1.tableGenerator(1, _this._manifestData, compactObj, _this.keyType, _this.path, compactIndex);
                }
                else { // level 1+, only merge some files
                    // loop compaction marker around
                    if (lvl.comp >= lvl.files.length) {
                        lvl.comp = 0;
                    }
                    // get keyrange for file we're compacting
                    var keyRange_1 = [];
                    lvl.files.forEach(function (file, k) {
                        if (lvl.comp === k) {
                            keyRange_1 = file.range;
                        }
                    });
                    // increment compaction marker for next compaction
                    lvl.comp++;
                    // find overlapping files in the next level
                    if (_this._manifestData.lvl[i + 1]) {
                        _this._manifestData.lvl[i + 1].files.forEach(function (file) {
                            if (file.range[0] >= keyRange_1[0] && file.range[1] <= keyRange_1[0]) { // is starting key in the range for this file?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            }
                            else if (file.range[0] >= keyRange_1[1] && file.range[1] <= keyRange_1[1]) { // is ending key in the range for this file?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            }
                            else if (file.range[0] >= keyRange_1[0] && file.range[1] <= keyRange_1[1]) { // are the keys in the file entirely overlapping?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            }
                        });
                    }
                    // grab newest changes
                    lvl.files.forEach(function (file, k) {
                        if (lvl.comp === k) {
                            // grab file at this level
                            deleteFiles.push([i, file.i]);
                            loadFile(file.i, i);
                        }
                    });
                    // write files to disk
                    common_1.tableGenerator(i + 1, _this._manifestData, compactObj, _this.keyType, _this.path, compactIndex);
                }
                var wasmClearFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                wasmClearFns[_this.keyType](compactIndex);
                compactObj = {};
            }
        });
        // clear old files from manifest
        deleteFiles.forEach(function (fileInfo) {
            if (_this._manifestData.lvl[fileInfo[0]]) {
                _this._manifestData.lvl[fileInfo[0]].files = _this._manifestData.lvl[fileInfo[0]].files.filter(function (file) {
                    if (file.i === fileInfo[1]) {
                        return false;
                    }
                    return true;
                });
            }
        });
        this._bloomCache = {};
        // Safe manifest update
        common_1.writeManifestUpdate(this.path, this._manifestData);
        if (process.send)
            process.send({ type: "compact-done", files: deleteFiles.map(function (f) { return f[1]; }) });
    };
    return SnapCompactor;
}());
exports.SnapCompactor = SnapCompactor;
process.on('message', function (msg) {
    switch (msg.type) {
        case "snap-compact":
            new SnapCompactor(msg.path, msg.keyType, msg.cache);
            break;
    }
});
//# sourceMappingURL=compact.js.map