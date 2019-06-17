export declare class RBNode {
    _color: any;
    key: any;
    value: any;
    left: any;
    right: any;
    _count: any;
    constructor(color: any, key: any, value: any, left: any, right: any, count: any);
}
export declare class RedBlackTree {
    private _compare;
    private root;
    constructor(compare: (a: any, b: any) => number, root?: any);
    keys(): any[];
    values(): any[];
    length(): any;
    insert(key: any, value: any): RedBlackTree;
    forEach(visit?: any, lo?: any, hi?: any): any;
    begin(): RedBlackTreeIterator;
    end(): RedBlackTreeIterator;
    at(idx: any): RedBlackTreeIterator;
    ge(key: any): RedBlackTreeIterator;
    gt(key: any): RedBlackTreeIterator;
    lt(key: any): RedBlackTreeIterator;
    le(key: any): RedBlackTreeIterator;
    find(key: any): RedBlackTreeIterator;
    remove(key: any): any;
    get(key: any): any;
}
export declare class RedBlackTreeIterator {
    tree: any;
    _stack: any;
    constructor(tree: any, stack: any);
    valid(): boolean;
    node(): any;
    clone(): RedBlackTreeIterator;
    remove(): any;
    key(): any;
    value(): any;
    index(): any;
    next(): void;
    hasNext(): boolean;
    update(value: any): RedBlackTree;
    prev(): void;
    hasPrev(): boolean;
}
export declare function createRBTree(compare?: (a: any, b: any) => number): RedBlackTree;
