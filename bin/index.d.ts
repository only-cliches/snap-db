import * as fs from "fs";
export declare class SnapDB<K> {
    keyType: "string" | "float" | "int";
    memoryCache?: boolean | undefined;
    _isReady: boolean;
    _indexNum: number;
    _currentFileIdx: number;
    _currentFileLen: number;
    _path: string;
    dataFiles: number[];
    keyStream: fs.WriteStream;
    tombStream: fs.WriteStream;
    dataStreams: fs.WriteStream[];
    _cache: {
        [key: string]: string;
    };
    constructor(folderName: string, keyType: "string" | "float" | "int", memoryCache?: boolean | undefined);
    private _loadCache;
    private _checkWasmReady;
    private _loadIndexFromDisk;
    ready(): Promise<any>;
    do_compaction(complete: (err: any) => void): void;
    get(key: K, skipCache?: boolean): Promise<string>;
    delete(key: K): Promise<boolean>;
    private _makeKey;
    put(key: K, data: string): Promise<any>;
    getAllKeys(onRecord: (key: K) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    getCount(): number;
    getAll(onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    range(lower: K, higher: K, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
    offset(offset: number, limit: number, onRecord: (key: K, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
}
