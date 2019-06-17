import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { IbloomFilterObj, BloomFilter } from "./bloom";
const wasm = require("./db.js");

export const VERSION = 1.04;

export const NULLBYTE = new Buffer([0]);

export interface SnapManifest {
    v: number;
    inc: number,
    lvl: {
        comp: number,
        files: {i: number, range: [any, any]}[]
    }[];
};

export interface SnapIndex {
    keys: {
        [key: string]: [number, number]
    },
    hash: string;
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

export const tableGenerator = (level: number, manifest: SnapManifest, jsonData: any, keyType: string, dbPath: string, wasmIndex: number) => {
    

    const wasmFNs3 = { "string": wasm.read_index_str, "int": wasm.read_index_int, "float": wasm.read_index };
    const wasmFNs4 = { "string": wasm.read_index_str_next, "int": wasm.read_index_int_next, "float": wasm.read_index_next };

    const it = wasmFNs3[keyType](wasmIndex, 0).split(",").map(s => parseInt(s));
    let key: any;
    let count = 0;

    const writeNextFile = () => {

        
        const nextFile = manifest.inc + 1;

        try {
            // remove possible partial files from previous run
            fs.unlinkSync(fileName(nextFile) + ".idx");
            fs.unlinkSync(fileName(nextFile) + ".dta");
            fs.unlinkSync(fileName(nextFile) + ".bom");
        } catch (e) {
            // no need to catch this error or care about it, happens if files don't exist.
        }
    
        let dataLen = 0;
        let totalLen = 0;
        let dataHash = crypto.createHash("sha1");
    
        let indexJSON: SnapIndex = {
            keys: {},
            hash: ""
        }
        let keys: any[] = [];

        let firstKey: any = undefined;
        let lastKey: any = undefined;
        let valueData: string = "";
        
        // split files at 2 megabytes
        while (count < it[1] && totalLen < 2000000) {
            key = wasmFNs4[keyType](wasmIndex, it[0], 0, count);
            if (firstKey === undefined) {
                firstKey = key;
            }
            lastKey = key;
            
            const strKey = String(key);
            keys.push(strKey);
            const data: string | Buffer = jsonData[key];
    
            if (data === NULLBYTE) { // tombstone
                // write index
                indexJSON.keys[key] = [-1, 0]; // tombstone
                totalLen += strKey.length;
    
            } else {
                // write index
                indexJSON.keys[key] = [dataLen, data.length];
                
                // write data
                valueData += data;
                dataHash.update(data);
                dataLen += data.length;

                totalLen += String(strKey + dataLen + data.length).length;
            }
            count++;
        }

        if (keys.length) {
            const levelFileIdx = fs.openSync(path.join(dbPath, fileName(nextFile) + ".idx"), "a+");
            const levelFileDta = fs.openSync(path.join(dbPath, fileName(nextFile) + ".dta"), "a+");
            const levelFileBloom = fs.openSync(path.join(dbPath, fileName(nextFile) + ".bom"), "a+");

            const bloom = BloomFilter.create(keys.length, 0.1);
            let i = keys.length;
            while(i--) {
                bloom.insert(keys[i]);
            }

            fs.writeSync(levelFileDta, valueData);
            // checksums for integrity
            fs.writeSync(levelFileDta, NULLBYTE);
            fs.writeSync(levelFileDta, NULLBYTE);
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
    }
    writeNextFile();


}