export interface IbloomFilterObj {
    vData: number[];
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
}
export declare class BloomFilter {
    static BLOOM_UPDATE_NONE: number;
    static BLOOM_UPDATE_ALL: number;
    static BLOOM_UPDATE_P2PUBKEY_ONLY: number;
    static MAX_BLOOM_FILTER_SIZE: number;
    static MAX_HASH_FUNCS: number;
    static MIN_HASH_FUNCS: number;
    static LN2SQUARED: number;
    static LN2: number;
    vData: number[];
    nHashFuncs: number;
    nTweak: number;
    nFlags: number;
    constructor(arg: IbloomFilterObj);
    toObject(): IbloomFilterObj;
    static create(elements: number, falsePositiveRate: number, nTweak?: number, nFlags?: number): BloomFilter;
    static hash(dataLength: number, nHashNum: number, nTweak: number, vDataToHash: string): number;
    insert(data: string): BloomFilter;
    /**
     * Static contain method to use without initializing bloom class.
     *
     * @static
     * @param {number[]} vData
     * @param {number} nHashFuncs
     * @param {number} nTweak
     * @param {string} data
     * @returns {boolean}
     * @memberof BloomFilter
     */
    static contains(vData: number[], nHashFuncs: number, nTweak: number, data: string): boolean;
    /**
     * @param {Buffer} Data to check if exists in the filter
     * @returns {Boolean} If the data matches
     */
    contains(data: string): boolean;
    clear(): void;
}
export declare function MurmurHash3(seed: any, data: any): number;
