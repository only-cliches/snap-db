import * as fs from "fs";
import * as path from "path";
import { SnapManifest, writeManifestUpdate, fileName, VERSION, SnapIndex, tableGenerator, NULLBYTE } from "./common";
import { BloomFilter, IbloomFilterObj } from "./lib_bloom";
import { createRBTree } from "./lib_rbtree";

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

    private _indexFileCache: {
        [fileNum: number]: { cache: SnapIndex, lastUsed: number }
    } = {};

    private _getBloom(fileID: number) {
        if (this._bloomCache[fileID]) {
            return this._bloomCache[fileID];
        }
        this._bloomCache[fileID] = JSON.parse(fs.readFileSync(path.join(this.path, fileName(fileID) + ".bom"), "utf-8"));
        return this._bloomCache[fileID];
    }

    private _runCompaction() {
        this._manifestData = JSON.parse((fs.readFileSync(path.join(this.path, "manifest.json")) || Buffer.from([])).toString("utf-8") || '{"inc": 0, "lvl": []}');

        let compactIndex = createRBTree();

        this._indexFileCache = {};

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
            
            const index: SnapIndex = JSON.parse(fs.readFileSync(path.join(this.path, fileName(fileID) + ".idx"), "utf-8"));
            // const data = fs.readFileSync(path.join(this.path, fileName(fileID) + ".dta"), "utf-8");

            const keys = Object.keys(index.keys);
            let i = 0;
            while(i < keys.length) {
                const key = this.keyType === "any" ? (keys[i].slice(0, 2) === "n>" ? parseFloat(keys[i].slice(2)) : keys[i].slice(2)) : (this.keyType === "string" ? keys[i] : parseFloat(keys[i]));

                if (compactIndex.get(key) !== undefined) {
                    compactIndex = compactIndex.remove(key);
                }

                if (index.keys[keys[i]][0] === -1) { // tombstone
                    // if higher level has this key, keep tombstone.  Otherwise discard it
                    if (hasOlderValues(key, level)) {
                        compactIndex = compactIndex.insert(key, NULLBYTE);
                    } else {
                        compactIndex = compactIndex.remove(key);
                    }
                } else {
                    // data.slice(index.keys[key][0], index.keys[key][0] + index.keys[key][1])
                    compactIndex = compactIndex.insert(key, {fileID: fileID, offset: index.keys[keys[i]]});
                }

                i++;
            };
        }



        let deleteFiles: [number, number][] = [];

        const finishCompact = () => {
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
            this._indexFileCache = {};

            // Safe manifest update
            writeManifestUpdate(this.path, this._manifestData);

            if (process.send) process.send({type: "compact-done", files: deleteFiles.map(f => f[1])});
        }

        if (this._manifestData.lvl && this._manifestData.lvl.length) {

            let i = 0;
            let didCompact = false;

            // loop compaction until all levels are within limits
            const maybeFinishCompact = () => {
                if (didCompact) {
                    i = 0;
                    didCompact = false;
                    nextLevel();
                } else {
                    finishCompact();
                }
            }

            // compact a specific level
            const nextLevel = () => {

                if(i < this._manifestData.lvl.length) {
                    const lvl = this._manifestData.lvl[i];
        
                    const maxSizeMB = Math.pow(10, i + 1);
                    let size = 0;
                    let k = 0;
    
                    while(k < lvl.files.length) {
                        const file = lvl.files[k];
                        const fName = fileName(file.i);
                        size += (fs.statSync(path.join(this.path, fName) + ".dta").size / 1000000.0);
                        size += (fs.statSync(path.join(this.path, fName) + ".idx").size / 1000000.0);
                        size += (fs.statSync(path.join(this.path, fName) + ".bom").size / 1000000.0);
                        k++;
                    }
    
                    if (size > maxSizeMB) { // compact this level
                        
                        didCompact = true;
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
                        tableGenerator(i + 1, this._manifestData, this.path, compactIndex, () => {
                            compactIndex = createRBTree();
                            i++;
                            nextLevel();
                        });
                        
                    } else {
                        maybeFinishCompact();
                    }
                } else {
                    maybeFinishCompact();
                }
            }
            nextLevel();
        } else {
            finishCompact();
        }
    }
}

process.on('message', (msg) => { // got message from master
    switch (msg.type) {
        case "snap-compact":
            new SnapCompactor(msg.path, msg.keyType, msg.cache);
            break;
    }
});