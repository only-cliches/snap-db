import * as fs from "fs";
import * as path from "path";
const wasm = require("./db.js");
import { SnapManifest, writeManifestUpdate, fileName, VERSION, SnapIndex, tableGenerator, NULLBYTE } from "./common";
import { BloomFilter, IbloomFilterObj } from "./bloom";

export class SnapCompactor {

    private _manifestData: SnapManifest = {
        v: VERSION,
        inc: 0,
        lvl: []
    };

    private _bloomCache: {
        [fileName: number]: IbloomFilterObj;
    } = {};

    constructor(
        public path: string,
        public keyType: string,
        public cache: boolean
    ) {
        process.on("message", (msg) => {
            if (msg === "do-compact") {
                this._runCompaction();
            }
        })
    }

    private _getBloom(fileID: number) {
        if (this._bloomCache[fileID]) {
            return this._bloomCache[fileID];
        }
        this._bloomCache[fileID] = JSON.parse(fs.readFileSync(path.join(this.path, fileName(fileID) + ".bom"), "utf-8"));
        return this._bloomCache[fileID];
    }

    private _runCompaction() {
        this._manifestData = JSON.parse((fs.readFileSync(path.join(this.path, "manifest.json")) || new Buffer([])).toString("utf-8") || '{"inc": 0, "lvl": []}');

        const wasmFNs = { "string": wasm.new_index_str, "int": wasm.new_index_int, "float": wasm.new_index };
        const compactIndex = wasmFNs[this.keyType]();
        let compactObj: {
            [key: string]: any;
        } = {};

        const hasOlderValues = (key, level: number): boolean => {
            let currentLevel = level + 1;
            const nextLevel = () => {
                if (this._manifestData.lvl[currentLevel]) {
                    let i = this._manifestData.lvl[currentLevel].files.length;
                    while(i--) {
                        const fileInfo = this._manifestData.lvl[currentLevel].files[i];
                        if (fileInfo.range[0] <= key && fileInfo.range[1] >= key) {
                            const bloom = this._getBloom(fileInfo.i);
                            if (BloomFilter.contains(bloom.vData, bloom.nHashFuncs, bloom.nTweak, String(key))) {
                                return true;
                            }
                        }
                    }
                    currentLevel++;
                    return nextLevel();
                }
                return false;
            }

            return nextLevel();
        }

        const loadFile = (fileID: number, level: number) => {
            const wasmFNs = { "string": wasm.add_to_index_str, "int": wasm.add_to_index_int, "float": wasm.add_to_index };
            const index: SnapIndex = JSON.parse(fs.readFileSync(path.join(this.path, fileName(fileID) + ".idx"), "utf-8"));
            const data = fs.readFileSync(path.join(this.path, fileName(fileID) + ".dta"), "utf-8");
            Object.keys(index.keys).forEach((key) => {
                wasmFNs[this.keyType](compactIndex, this.keyType === "string" ? key : parseFloat(key));
                if (index.keys[key][0] === -1) { // tombstone
                    // if higher level has this key, keep tombstone.  Otherwise discard it
                    compactObj[key] = hasOlderValues(key, level) ? NULLBYTE : undefined;
                } else {
                    compactObj[key] = data.slice(index.keys[key][0], index.keys[key][0] + index.keys[key][1]);
                }
            });
        }

        let deleteFiles: [number, number][] = [];

        this._manifestData.lvl.forEach((lvl, i) => {
            const maxSizeMB = Math.pow(10, i + 1);
            let size = 0;
            lvl.files.forEach((file) => {
                const fName = fileName(file.i);
                size += (fs.statSync(path.join(this.path, fName) + ".dta").size / 1000000.0);
                size += (fs.statSync(path.join(this.path, fName) + ".idx").size / 1000000.0);
                size += (fs.statSync(path.join(this.path, fName) + ".bom").size / 1000000.0);
            });
            if (size > maxSizeMB) { // compact this level
                if (i === 0) { // level 0 to level 1, merge all files since keys probably overlap

                    // load older files first
                    if(this._manifestData.lvl[1]) {
                        this._manifestData.lvl[1].files.forEach((file) => {
                            // mark all existing level 1 files for deletion
                            deleteFiles.push([1, file.i]);
                            loadFile(file.i, 1);
                        });
                    }

                    // then newer files
                    lvl.files.forEach((file) => {
                        // mark all existing level 0 files for deletion
                        deleteFiles.push([i, file.i]);
                        loadFile(file.i, 0);
                    });

                    // write files to disk
                    tableGenerator(1, this._manifestData, compactObj, this.keyType, this.path, compactIndex);

                } else { // level 1+, only merge some files

                    // loop compaction marker around
                    if (lvl.comp >= lvl.files.length) {
                        lvl.comp = 0;
                    }

                    // get keyrange for file we're compacting
                    let keyRange: any[] = [];
                    lvl.files.forEach((file, k) => {
                        if (lvl.comp === k) {
                            keyRange = file.range;
                        }
                    });
                    
                    // increment compaction marker for next compaction
                    lvl.comp++;

                    // find overlapping files in the next level
                    if(this._manifestData.lvl[i + 1]) {
                        this._manifestData.lvl[i + 1].files.forEach((file) => {
                            if (file.range[0] >= keyRange[0] && file.range[1] <= keyRange[0]) { // is starting key in the range for this file?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            } else if (file.range[0] >= keyRange[1] && file.range[1] <= keyRange[1]) { // is ending key in the range for this file?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            } else if (file.range[0] >= keyRange[0] && file.range[1] <= keyRange[1]) { // are the keys in the file entirely overlapping?
                                deleteFiles.push([i + 1, file.i]);
                                loadFile(file.i, i + 1);
                            }
                        });
                    }

                    // grab newest changes
                    lvl.files.forEach((file, k) => {
                        if (lvl.comp === k) {
                            // grab file at this level
                            deleteFiles.push([i, file.i]);
                            loadFile(file.i, i);
                        }
                    });

                    // write files to disk
                    tableGenerator(i + 1, this._manifestData, compactObj, this.keyType, this.path, compactIndex);
                }

                const wasmClearFns = { "string": wasm.empty_index_str, "int": wasm.empty_index_int, "float": wasm.empty_index };
                wasmClearFns[this.keyType](compactIndex);
                compactObj = {};
            }
        });

        // clear old files from manifest
        deleteFiles.forEach((fileInfo) => {
            if (this._manifestData.lvl[fileInfo[0]]) {
                this._manifestData.lvl[fileInfo[0]].files = this._manifestData.lvl[fileInfo[0]].files.filter((file) => {
                    if (file.i === fileInfo[1]) {
                        return false;
                    }
                    return true;
                });
            }
        });

        this._bloomCache = {};

        // Safe manifest update
        writeManifestUpdate(this.path, this._manifestData);

        if (process.send) process.send({type: "compact-done", files: deleteFiles.map(f => f[1])});
    }
}

process.on('message', (msg) => { // got message from master
    switch (msg.type) {
        case "snap-compact":
            new SnapCompactor(msg.path, msg.keyType, msg.cache);
            break;
    }
});