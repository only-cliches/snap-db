/*
https://github.com/bitpay/bloom-filter/blob/master/LICENSE

Copyright (c) 2015 BitPay, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

export interface IbloomFilterObj {
    vData: number[],
    nHashFuncs: number,
    nTweak: number,
    nFlags: number
}


export class BloomFilter {

    public static BLOOM_UPDATE_NONE = 0;
    public static BLOOM_UPDATE_ALL = 1;
    public static BLOOM_UPDATE_P2PUBKEY_ONLY = 2;
    public static MAX_BLOOM_FILTER_SIZE = 36000; // bytes
    public static MAX_HASH_FUNCS = 50;
    public static MIN_HASH_FUNCS = 1;
    public static LN2SQUARED = Math.pow(Math.log(2), 2); // 0.4804530139182014246671025263266649717305529515945455
    public static LN2 = Math.log(2); // 0.6931471805599453094172321214581765680755001343602552

    public vData: number[];
    public nHashFuncs: number;
    public nTweak: number;
    public nFlags: number;

    constructor(arg: IbloomFilterObj) {
        if (typeof (arg) === 'object') {
            if (!arg.vData) {
                throw new TypeError('Data object should include filter data "vData"');
            }
            if (arg.vData.length > BloomFilter.MAX_BLOOM_FILTER_SIZE * 8) {
                throw new TypeError('"vData" exceeded max size "' + BloomFilter.MAX_BLOOM_FILTER_SIZE + '"');
            }
            this.vData = arg.vData;
            if (!arg.nHashFuncs) {
                throw new TypeError('Data object should include number of hash functions "nHashFuncs"');
            }
            if (arg.nHashFuncs > BloomFilter.MAX_HASH_FUNCS) {
                throw new TypeError('"nHashFuncs" exceeded max size "' + BloomFilter.MAX_HASH_FUNCS + '"');
            }
            this.nHashFuncs = arg.nHashFuncs;
            this.nTweak = arg.nTweak || 0;
            this.nFlags = arg.nFlags || BloomFilter.BLOOM_UPDATE_NONE;
        } else {
            throw new TypeError('Unrecognized argument');
        }

    }

    toObject(): IbloomFilterObj {
        return {
            vData: this.vData,
            nHashFuncs: this.nHashFuncs,
            nTweak: this.nTweak,
            nFlags: this.nFlags
        };
    };

    static create(elements: number, falsePositiveRate: number, nTweak?: number, nFlags?: number) {
        /* jshint maxstatements: 18 */

        let info: IbloomFilterObj = {
            vData: [],
            nHashFuncs: 0,
            nTweak: 0,
            nFlags: 0
        };

        // The ideal size for a bloom filter with a given number of elements and false positive rate is:
        // * - nElements * log(fp rate) / ln(2)^2
        // See: https://github.com/bitcoin/bitcoin/blob/master/src/bloom.cpp
        let size = -1.0 / BloomFilter.LN2SQUARED * elements * Math.log(falsePositiveRate);
        let filterSize = Math.floor(size / 8);
        let max = BloomFilter.MAX_BLOOM_FILTER_SIZE * 8;
        if (filterSize > max) {
            filterSize = max;
        }

        for (let i = 0; i < filterSize; i++) {
            info.vData.push(0);
        }

        // The ideal number of hash functions is:
        // filter size * ln(2) / number of elements
        // See: https://github.com/bitcoin/bitcoin/blob/master/src/bloom.cpp
        let nHashFuncs = Math.floor(info.vData.length * 8 / elements * BloomFilter.LN2);
        if (nHashFuncs > BloomFilter.MAX_HASH_FUNCS) {
            nHashFuncs = BloomFilter.MAX_HASH_FUNCS;
        }
        if (nHashFuncs < BloomFilter.MIN_HASH_FUNCS) {
            nHashFuncs = BloomFilter.MIN_HASH_FUNCS;
        }

        info.nHashFuncs = nHashFuncs;
        info.nTweak = nTweak || 0;
        info.nFlags = nFlags || BloomFilter.BLOOM_UPDATE_NONE;

        return new BloomFilter(info);

    };

    static hash(dataLength: number, nHashNum: number, nTweak: number, vDataToHash: string): number {
        let h = MurmurHash3(((nHashNum * 0xFBA4C795) + nTweak) & 0xFFFFFFFF, vDataToHash);
        return h % (dataLength * 8);
    };

    insert(data: string): BloomFilter {
        for (let i = 0; i < this.nHashFuncs; i++) {
            let index = BloomFilter.hash(this.vData.length, i, this.nTweak, data);
            let position = (1 << (7 & index));
            this.vData[index >> 3] |= position;
        }
        return this;
    };

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
    static contains(vData: number[], nHashFuncs: number, nTweak: number, data: string): boolean {
        if (!vData.length) {
            return false;
        }
        for (let i = 0; i < nHashFuncs; i++) {
            let index = BloomFilter.hash(vData.length, i, nTweak, data);
            if (!(vData[index >> 3] & (1 << (7 & index)))) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param {Buffer} Data to check if exists in the filter
     * @returns {Boolean} If the data matches
     */
    contains(data: string): boolean {
        if (!this.vData.length) {
            return false;
        }
        for (let i = 0; i < this.nHashFuncs; i++) {
            let index = BloomFilter.hash(this.vData.length, i, this.nTweak, data);
            if (!(this.vData[index >> 3] & (1 << (7 & index)))) {
                return false;
            }
        }
        return true;
    };

    clear() {
        this.vData = [];
    };
}

export function MurmurHash3(seed, data) {

    var c1 = 0xcc9e2d51;
    var c2 = 0x1b873593;
    var r1 = 15;
    var r2 = 13;
    var m = 5;
    var n = 0x6b64e654;

    var hash = seed;

    function mul32(a, b) {
        return (a & 0xffff) * b + (((a >>> 16) * b & 0xffff) << 16) & 0xffffffff;
    }

    function sum32(a, b) {
        return (a & 0xffff) + (b >>> 16) + (((a >>> 16) + b & 0xffff) << 16) & 0xffffffff;
    }

    function rotl32(a, b) {
        return (a << b) | (a >>> (32 - b));
    }

    var k1;

    for (var i = 0; i + 4 <= data.length; i += 4) {
        k1 = data[i] |
            (data[i + 1] << 8) |
            (data[i + 2] << 16) |
            (data[i + 3] << 24);

        k1 = mul32(k1, c1);
        k1 = rotl32(k1, r1);
        k1 = mul32(k1, c2);

        hash ^= k1;
        hash = rotl32(hash, r2);
        hash = mul32(hash, m);
        hash = sum32(hash, n);
    }

    k1 = 0;

    switch (data.length & 3) {
        case 3:
            k1 ^= data[i + 2] << 16;
        /* falls through */
        case 2:
            k1 ^= data[i + 1] << 8;
        /* falls through */
        case 1:
            k1 ^= data[i];
            k1 = mul32(k1, c1);
            k1 = rotl32(k1, r1);
            k1 = mul32(k1, c2);
            hash ^= k1;
    }

    hash ^= data.length;
    hash ^= hash >>> 16;
    hash = mul32(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = mul32(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return hash >>> 0;
}