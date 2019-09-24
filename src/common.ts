import * as fs from "fs";
import * as path from "path";
import { IbloomFilterObj, BloomFilter, MurmurHash3 } from "./lib_bloom";
import { RedBlackTree } from "./lib_rbtree";
import { Sha1 } from "./lib_sha1";

export const VERSION = 1.16;

export const NULLBYTE = Buffer.from([0]);

export interface SnapManifest {
    v: number;
    inc: number,
    lvl: {
        comp: number,
        files: {i: number, range: [any, any]}[]
    }[];
};

export interface QueryArgs<K> {
    gt?: K;
    gte?: K;
    lt?: K;
    lte?: K;
    offset?: number;
    limit?: number;
    keys?: boolean;
    values?: boolean;
    reverse?: boolean;
}

export interface SnapIndex {
    keys: {
        [key: string]: [number, number]
    },
    hash: string;
}

export const rand = () => {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < 6; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

export const writeManifestUpdate = (dbPath: string, manifest: SnapManifest) => {
    // write manifest to temp
    fs.writeFileSync(path.join(dbPath, "manifest-temp.json"), JSON.stringify(manifest));
    const fd = fs.openSync(path.join(dbPath, "manifest-temp.json"), "rs+");
    fs.fsyncSync(fd);
    fs.closeSync(fd);

    // write to actual file
    fs.writeFileSync(path.join(dbPath, "manifest.json"), JSON.stringify(manifest));
    const fd2 = fs.openSync(path.join(dbPath, "manifest.json"), "rs+");
    fs.fsyncSync(fd2);
    fs.closeSync(fd2);

    // remove temp
    fs.unlinkSync(path.join(dbPath, "manifest-temp.json"));
}

export const fileName = (idx: number) => {
    if (String(idx).length > 9) {
        return String(idx);
    }
    return `000000000${idx}`.slice(-9);
}

export const throttle = (scope: any, func: any, limit: number) => {
    let waiting = false;
    return (...args: any[]) => {
        if (waiting) return;
        waiting = true;
        setTimeout(() => {
            func.apply(scope, args);
            waiting = false;
        }, limit);
    };
};

export const tableGenerator = (level: number, manifest: SnapManifest, dbPath: string, index: RedBlackTree, done: () => void) => {
    
    const it = index.begin();

    const writeNextFile = () => {

        const nextFile = manifest.inc + 1;

        try {
            // remove possible partial files from previous run
            fs.unlinkSync(path.join(dbPath, fileName(nextFile) + ".idx"));
            fs.unlinkSync(path.join(dbPath, fileName(nextFile) + ".dta"));
            fs.unlinkSync(path.join(dbPath, fileName(nextFile) + ".bom"));
        } catch (e) {
            // no need to catch this error or care about it, happens if files don't exist.
        }
    
        let dataLen = 0;
        let totalLen = 0;
        let dataHash = new Sha1();
    
        let indexJSON: SnapIndex = {
            keys: {},
            hash: ""
        }
        let keys: any[] = [];

        let firstKey: any = undefined;
        let lastKey: any = undefined;

        let nextKey = it.key();
        let levelFileDta: number = -1;
        let levelFileIdx: number = -1;
        let levelFileBloom: number = -1;

        const closeFile = () => {
            if (keys.length) {

                const bloom = BloomFilter.create(keys.length, 0.1);

                let k = keys.length;
                while(k--) {
                    bloom.insert(keys[k]);
                }

                fs.fsyncSync(levelFileDta);
                
                let fd = fs.createReadStream(path.join(dbPath, fileName(nextFile) + ".dta"));

                fd.on("data", (chunk: Buffer) => {
                    dataHash.update(chunk.toString("utf-8"));
                }).on('end', () => {

                    // checksums for integrity
                    fs.writeSync(levelFileDta, NULLBYTE);
                    fs.writeSync(levelFileDta, NULLBYTE);
                    fs.writeSync(levelFileDta, dataHash.hex());
                
                    indexJSON.hash = String(MurmurHash3(0, JSON.stringify(indexJSON.keys)));
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
                });

            } else {
                done();
            }
        }
        
        const getNextKey = () => {
            // split files at 2 megabytes
            if(it.valid() && totalLen < 2000000) {
                if (levelFileDta === -1) {
                    levelFileDta =  fs.openSync(path.join(dbPath, fileName(nextFile) + ".dta"), "a+");
                    levelFileIdx = fs.openSync(path.join(dbPath, fileName(nextFile) + ".idx"), "a+");
                    levelFileBloom = fs.openSync(path.join(dbPath, fileName(nextFile) + ".bom"), "a+");
                }
    
                if (firstKey === undefined) {
                    firstKey = nextKey;
                }
    
                lastKey = nextKey;
                
                const strKey = String(nextKey);
                keys.push(strKey);

                const data: string | Buffer | {fileID: number, offset: [number, number]} = it.value();
        
                if (data === NULLBYTE) { // tombstone
                    // write index
                    indexJSON.keys[nextKey] = [-1, 0]; // tombstone
                    totalLen += strKey.length;

                    it.next();
                    nextKey = it.key();
                    keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
        
                } else if (typeof data !== "string" && !Buffer.isBuffer(data) && data.fileID) { // file location
                    let dataStart = data.offset[0];
                    let dataLength = data.offset[1];

                    const readFile = fs.createReadStream(path.join(dbPath, data.fileID === -1 ? "LOG" : fileName(data.fileID) + ".dta"), {start: dataStart, end: dataStart + dataLength, autoClose: true});
                    const writeFile = fs.createWriteStream(path.join(dbPath, fileName(nextFile) + ".dta"), {fd: levelFileDta, autoClose: false});
                    readFile.pipe(writeFile).on("finish", () => {
                        // write index
                        indexJSON.keys[nextKey] = [dataLen, dataLength];

                        dataLen += dataLength;
                        totalLen += strKey.length + dataLength;

                        it.next();
                        nextKey = it.key();
                        keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
                    }).on("error", (err) => {
                        console.error("FLUSH OR COMPACTION ERROR");
                        console.error(err);
                    })
    
                } else if (typeof data === "string") { // actual data is in index
                    // write index
                    indexJSON.keys[nextKey] = [dataLen, data.length];
                    
                    // write data
                    fs.writeSync(levelFileDta, data);
                    dataHash.update(data);
                    dataLen += data.length;
                    totalLen += strKey.length + data.length;

                    it.next();
                    nextKey = it.key();
                    keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
                } else {
                    it.next();
                    nextKey = it.key();
                    keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
                }  
            } else {
                if (keys.length) {
                    closeFile();
                } else {
                    done();
                }
            }
        }
        getNextKey();
    
    }
    writeNextFile();


}