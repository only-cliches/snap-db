/// <reference types="node" />
export declare const VERSION = 1.04;
export declare const NULLBYTE: Buffer;
export interface SnapManifest {
    v: number;
    inc: number;
    lvl: {
        comp: number;
        files: {
            i: number;
            range: [any, any];
        }[];
    }[];
}
export interface SnapIndex {
    keys: {
        [key: string]: [number, number];
    };
    hash: string;
}
export declare const writeManifestUpdate: (dbPath: string, manifest: SnapManifest) => void;
export declare const fileName: (idx: number) => string;
export declare const throttle: (scope: any, func: any, limit: number) => (...args: any[]) => void;
export declare const tableGenerator: (level: number, manifest: SnapManifest, jsonData: any, keyType: string, dbPath: string, wasmIndex: number) => void;
