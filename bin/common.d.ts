/// <reference types="node" />
import { RedBlackTree } from "./rbtree";
export declare const VERSION = 1.06;
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
export declare const tableGenerator: (level: number, manifest: SnapManifest, keyType: string, dbPath: string, index: RedBlackTree) => void;
