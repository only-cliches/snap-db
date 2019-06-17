Object.defineProperty(exports, "__esModule", { value: true });
var ReallySmallEvents = /** @class */ (function () {
    function ReallySmallEvents() {
        this.eventListeners = {};
    }
    ReallySmallEvents.prototype.on = function (event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    };
    ReallySmallEvents.prototype.off = function (event, callback) {
        var _this = this;
        if (this.eventListeners[event] && this.eventListeners[event].length) {
            this.eventListeners[event].forEach(function (cb, idx) {
                if (cb === callback) {
                    _this.eventListeners[event].splice(idx, 1);
                }
            });
        }
    };
    ReallySmallEvents.prototype.trigger = function (event) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(function (cb) { return cb.apply(void 0, args); });
        }
    };
    return ReallySmallEvents;
}());
exports.ReallySmallEvents = ReallySmallEvents;
exports.RSE = new ReallySmallEvents();
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
//# sourceMappingURL=rse.js.map