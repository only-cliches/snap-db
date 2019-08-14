/*
https://github.com/ClickSimply/really-small-events/blob/master/LICENSE

MIT License

Copyright (c) 2017 Scott Lott

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

export class ReallySmallEvents {

    public eventListeners: {
        [event: string]: ((...args: any[]) => void)[];
    } = {};

    public on(event: string, callback:(...args: any[]) => void) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    public off(event: string, callback:(...args: any[]) => void) {
        if (this.eventListeners[event] && this.eventListeners[event].length) {
            this.eventListeners[event].forEach((cb, idx) => {
                if (cb === callback) {
                    this.eventListeners[event].splice(idx, 1);
                }
            })
        }
    }

    public trigger(event: string, ...args: any[]) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(cb => cb(...args));
        }
    }
}

export const RSE = new ReallySmallEvents();