Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var bloom_1 = require("./bloom");
var wasm = require("./db.js");
exports.VERSION = 1.06;
exports.NULLBYTE = new Buffer([0]);
;
exports.writeManifestUpdate = function (dbPath, manifest) {
    // write manifest to temp
    fs.writeFileSync(path.join(dbPath, "manifest-temp.json"), JSON.stringify(manifest));
    var fd = fs.openSync(path.join(dbPath, "manifest-temp.json"), "rs+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    // write to actual file
    fs.writeFileSync(path.join(dbPath, "manifest.json"), JSON.stringify(manifest));
    var fd2 = fs.openSync(path.join(dbPath, "manifest.json"), "rs+");
    fs.fsyncSync(fd2);
    fs.closeSync(fd2);
    // remove temp
    fs.unlinkSync(path.join(dbPath, "manifest-temp.json"));
};
exports.fileName = function (idx) {
    if (String(idx).length > 9) {
        return String(idx);
    }
    return ("000000000" + idx).slice(-9);
};
exports.throttle = function (scope, func, limit) {
    var waiting = false;
    return function () {
        var args = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            args[_i] = arguments[_i];
        }
        if (waiting)
            return;
        waiting = true;
        setTimeout(function () {
            func.apply(scope, args);
            waiting = false;
        }, limit);
    };
};
exports.tableGenerator = function (level, manifest, keyType, dbPath, index) {
    var it = index.begin();
    var writeNextFile = function () {
        var nextFile = manifest.inc + 1;
        try {
            // remove possible partial files from previous run
            fs.unlinkSync(exports.fileName(nextFile) + ".idx");
            fs.unlinkSync(exports.fileName(nextFile) + ".dta");
            fs.unlinkSync(exports.fileName(nextFile) + ".bom");
        }
        catch (e) {
            // no need to catch this error or care about it, happens if files don't exist.
        }
        var dataLen = 0;
        var totalLen = 0;
        var dataHash = crypto.createHash("sha1");
        var indexJSON = {
            keys: {},
            hash: ""
        };
        var keys = [];
        var firstKey = undefined;
        var lastKey = undefined;
        var valueData = "";
        var nextKey = it.key();
        // split files at 2 megabytes
        while (it.valid() && totalLen < 2000000) {
            if (firstKey === undefined) {
                firstKey = nextKey;
            }
            lastKey = nextKey;
            var strKey = String(nextKey);
            keys.push(strKey);
            var data = it.value();
            if (data === exports.NULLBYTE) { // tombstone
                // write index
                indexJSON.keys[nextKey] = [-1, 0]; // tombstone
                totalLen += strKey.length;
            }
            else {
                // write index
                indexJSON.keys[nextKey] = [dataLen, data.length];
                // write data
                valueData += data;
                dataHash.update(data);
                dataLen += data.length;
                totalLen += strKey.length + data.length;
            }
            it.next();
            nextKey = it.key();
        }
        if (keys.length) {
            var levelFileIdx = fs.openSync(path.join(dbPath, exports.fileName(nextFile) + ".idx"), "a+");
            var levelFileDta = fs.openSync(path.join(dbPath, exports.fileName(nextFile) + ".dta"), "a+");
            var levelFileBloom = fs.openSync(path.join(dbPath, exports.fileName(nextFile) + ".bom"), "a+");
            var bloom = bloom_1.BloomFilter.create(keys.length, 0.1);
            var i = keys.length;
            while (i--) {
                bloom.insert(keys[i]);
            }
            fs.writeSync(levelFileDta, valueData);
            // checksums for integrity
            fs.writeSync(levelFileDta, exports.NULLBYTE);
            fs.writeSync(levelFileDta, exports.NULLBYTE);
            fs.writeSync(levelFileDta, dataHash.digest("hex"));
            indexJSON.hash = crypto.createHash("sha1").update(JSON.stringify(indexJSON.keys)).digest("hex");
            fs.writeSync(levelFileIdx, JSON.stringify(indexJSON));
            fs.writeSync(levelFileBloom, JSON.stringify(bloom.toObject()));
            // flush to disk
            fs.fsyncSync(levelFileDta);
            fs.fsyncSync(levelFileIdx);
            fs.fsyncSync(levelFileBloom);
            fs.closeSync(levelFileDta);
            fs.closeSync(levelFileIdx);
            fs.closeSync(levelFileBloom);
            // update manifest
            if (!manifest.lvl[level]) {
                manifest.lvl[level] = {
                    comp: 0,
                    files: []
                };
            }
            manifest.lvl[level].files.push({ i: nextFile, range: [firstKey, lastKey] });
            manifest.inc = nextFile;
            writeNextFile();
        }
    };
    writeNextFile();
};
//# sourceMappingURL=common.js.map