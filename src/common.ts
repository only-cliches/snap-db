import * as fs from "fs";
import * as path from "path";
import { IbloomFilterObj, BloomFilter, MurmurHash3 } from "./lib_bloom";
import { RedBlackTree } from "./lib_rbtree";
import { Sha1 } from "./lib_sha1";

export const VERSION = 1.17;

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
        [key: string]: [number, number, number?]
    },
    hash: string;
}

export const isBufferLike = (value: any): boolean => {
    if (Buffer.isBuffer(value)) return true;
    return !!(value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data));
};

export const toBuffer = (value: any): Buffer => {
    if (Buffer.isBuffer(value)) return value;
    if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    return Buffer.from(value);
};

const keyKindOrder = (value: any): number => {
    if (typeof value === "number") return 0;
    if (typeof value === "string") return 1;
    if (Buffer.isBuffer(value)) return 2;
    return 3;
};

export const compareKeys = (a: any, b: any): number => {
    if (a === b) return 0;
    if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) {
        return Buffer.compare(a, b);
    }

    const aKind = keyKindOrder(a);
    const bKind = keyKindOrder(b);
    if (aKind !== bKind) {
        return aKind > bKind ? 1 : -1;
    }

    if (a > b) return 1;
    return -1;
};

export const keyInRange = (key: any, low: any, high: any): boolean => {
    return compareKeys(low, key) <= 0 && compareKeys(high, key) >= 0;
};

export const encodeKey = (keyType: string, key: any): string => {
    if (keyType === "any") {
        if (typeof key === "number") return "n>" + String(key);
        if (isBufferLike(key)) return "b>" + toBuffer(key).toString("hex");
        return "s>" + String(key);
    }
    if (keyType === "buffer") {
        return "b>" + toBuffer(key).toString("hex");
    }
    if (keyType === "int") {
        return String(parseInt(key));
    }
    if (keyType === "float") {
        return String(parseFloat(key));
    }
    return String(key);
};

export const decodeKey = (keyType: string, encoded: string): any => {
    if (keyType === "any") {
        if (encoded.slice(0, 2) === "n>") return parseFloat(encoded.slice(2));
        if (encoded.slice(0, 2) === "b>") return Buffer.from(encoded.slice(2), "hex");
        if (encoded.slice(0, 2) === "s>") return encoded.slice(2);
        return encoded;
    }
    if (keyType === "buffer") {
        if (encoded.slice(0, 2) === "b>") return Buffer.from(encoded.slice(2), "hex");
        return Buffer.from(encoded);
    }
    if (keyType === "int") return parseInt(encoded);
    if (keyType === "float") return parseFloat(encoded);
    return encoded;
};

export const encodeValue = (value: string | Buffer): { data: string, type: number } => {
    if (Buffer.isBuffer(value)) {
        return { data: value.toString("base64"), type: 1 };
    }
    return { data: String(value), type: 0 };
};

export const decodeValue = (data: string, type?: number): string | Buffer => {
    if (type === 1) {
        return Buffer.from(data, "base64");
    }
    return data;
};

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

export const tableGenerator = (level: number, manifest: SnapManifest, dbPath: string, index: RedBlackTree, keyType: string, done: () => void) => {
    
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
                
                const strKey = encodeKey(keyType, nextKey);
                keys.push(strKey);

                const data: string | Buffer | {fileID: number, offset: [number, number, number?]} = it.value();
        
                if (data === NULLBYTE) { // tombstone
                    // write index
                    indexJSON.keys[strKey] = [-1, 0]; // tombstone
                    totalLen += strKey.length;

                    it.next();
                    nextKey = it.key();
                    keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
        
                } else if (typeof data !== "string" && !Buffer.isBuffer(data) && data.fileID) { // file location
                    let dataStart = data.offset[0];
                    let dataLength = data.offset[1];
                    const dataType = data.offset[2] || 0;

                    const readFile = fs.createReadStream(path.join(dbPath, data.fileID === -1 ? "LOG" : fileName(data.fileID) + ".dta"), {start: dataStart, end: dataStart + dataLength - 1, autoClose: true});
                    const writeFile = fs.createWriteStream(path.join(dbPath, fileName(nextFile) + ".dta"), {fd: levelFileDta, autoClose: false});
                    readFile.on("error", (err) => {
                        console.error("FLUSH OR COMPACTION ERROR");
                        console.error(err);
                    });
                    readFile.pipe(writeFile).on("finish", () => {
                        // write index
                        indexJSON.keys[strKey] = [dataLen, dataLength, dataType];

                        dataLen += dataLength;
                        totalLen += strKey.length + dataLength;

                        it.next();
                        nextKey = it.key();
                        keys.length % 250 === 0 ? setTimeout(getNextKey, 0) : getNextKey();
                    }).on("error", (err) => {
                        console.error("FLUSH OR COMPACTION ERROR");
                        console.error(err);
                    })
    
                } else if (typeof data === "string" || Buffer.isBuffer(data)) { // actual data is in index
                    const writeData = Buffer.isBuffer(data) ? data.toString("utf-8") : data;
                    // write index
                    indexJSON.keys[strKey] = [dataLen, writeData.length, 0];
                    
                    // write data
                    fs.writeSync(levelFileDta, writeData);
                    dataHash.update(writeData);
                    dataLen += writeData.length;
                    totalLen += strKey.length + writeData.length;

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
