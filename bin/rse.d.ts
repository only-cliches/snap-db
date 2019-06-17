export declare class ReallySmallEvents {
    eventListeners: {
        [event: string]: ((...args: any[]) => void)[];
    };
    on(event: string, callback: (...args: any[]) => void): void;
    off(event: string, callback: (...args: any[]) => void): void;
    trigger(event: string, ...args: any[]): void;
}
export declare const RSE: ReallySmallEvents;
