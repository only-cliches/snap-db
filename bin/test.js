Object.defineProperty(exports, "__esModule", { value: true });
var chai_1 = require("chai");
require("mocha");
var index_1 = require("./index");
function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
var db_str = new index_1.SnapDB("testDB1", "string");
var db_int = new index_1.SnapDB("testDB2", "int");
var db_flt = new index_1.SnapDB("testDB3", "float");
var data = {};
describe("SnapDB Tests", function () {
    it("Put Data", function (done) {
        Promise.all([db_str, db_int, db_flt].map(function (s, i) {
            return s.ready().then(function () {
                var dataKey = ["str", "int", "flt"][i];
                data[dataKey] = [];
                for (var k = 1; k < 1000; k++) {
                    switch (i) {
                        case 0:
                            data[dataKey].push([makeid(), makeid()]);
                            break;
                        case 1:
                            data[dataKey].push([k, makeid()]);
                            break;
                        case 2:
                            data[dataKey].push([k + (Math.round(Math.random() * 8) / 10), makeid()]);
                            break;
                    }
                }
                // scramble for insert
                data[dataKey] = data[dataKey].sort(function (a, b) { return Math.random() > 0.5 ? 1 : -1; });
                return Promise.all(data[dataKey].map(function (k) { return s.put(k[0], k[1]); }));
            });
        })).then(function () {
            Promise.all([
                db_str.getCount(),
                db_int.getCount(),
                db_flt.getCount()
            ]).then(function (result) {
                try {
                    chai_1.expect(result).to.deep.equal([
                        999,
                        999,
                        999
                    ], "Put failed!");
                    done();
                }
                catch (e) {
                    done(e);
                }
            });
        });
    }).timeout(5000);
    it("Integer: Sorted Keys", function (done) {
        data["int"] = data["int"].sort(function (a, b) { return a[0] > b[0] ? 1 : -1; });
        var dataFromDB = [];
        db_int.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["int"], "Integers not sorted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Integer: Delete Key", function (done) {
        var thisValue = data["int"].splice(42, 1).pop();
        db_int.delete(thisValue[0]);
        var dataFromDB = [];
        db_int.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["int"], "Integer key not deleted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Integer: Offset Select", function (done) {
        var dataFromDB = [];
        db_int.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["int"].slice(99, 109);
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Integer offset select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Integer: Offset Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_int.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var len = db_int.getCount();
                var genData = data["int"].slice().reverse().slice(99, 109);
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Integer offset reverse select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
    it("Integer: Range Select", function (done) {
        var dataFromDB = [];
        db_int.range(20, 50, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["int"].filter(function (v) { return v[0] >= 20 && v[0] <= 50; });
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Integer range select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Integer: Range Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_int.range(20, 50, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["int"].slice().filter(function (v) { return v[0] >= 20 && v[0] <= 50; }).reverse();
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Integer range select reverse failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
    it("Float: Sorted Keys", function (done) {
        data["flt"] = data["flt"].sort(function (a, b) { return a[0] > b[0] ? 1 : -1; });
        var dataFromDB = [];
        db_flt.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["flt"], "Floats not sorted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Float: Delete Key", function (done) {
        var thisValue = data["flt"].splice(42, 1).pop();
        db_flt.delete(thisValue[0]);
        var dataFromDB = [];
        db_flt.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["flt"], "Float key not deleted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Float: Offset Select", function (done) {
        var dataFromDB = [];
        db_flt.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["flt"].slice(99, 109), "Float offset select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Float: Offset Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_flt.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var len = db_flt.getCount();
                var genData = data["flt"].slice().reverse().slice(99, 109);
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Float offset reverse select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
    it("Float: Range Select", function (done) {
        var dataFromDB = [];
        db_flt.range(20.5, 50.5, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["flt"].filter(function (v) { return v[0] >= 20.5 && v[0] <= 50.5; });
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Float range select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("Float: Range Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_flt.range(20.5, 50.5, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["flt"].slice().filter(function (v) { return v[0] >= 20.5 && v[0] <= 50.5; }).reverse();
                chai_1.expect(dataFromDB).to.deep.equal(genData, "Float range select reverse failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
    it("String: Sorted Keys", function (done) {
        data["str"] = data["str"].sort(function (a, b) { return a[0] > b[0] ? 1 : -1; });
        var dataFromDB = [];
        db_str.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["str"], "Strings not sorted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("String: Delete Key", function (done) {
        var thisValue = data["str"].splice(42, 1).pop();
        db_str.delete(thisValue[0]);
        var dataFromDB = [];
        db_str.getAll(function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["str"], "String key not deleted!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("String: Offset Select", function (done) {
        var dataFromDB = [];
        db_str.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["str"].slice(99, 109), "String offset select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("String: Offset Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_str.offset(100, 10, function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var len = db_str.getCount();
                chai_1.expect(dataFromDB).to.deep.equal(data["str"].slice().reverse().slice(99, 109), "String offset reverse select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
    it("String: Range Select", function (done) {
        var dataFromDB = [];
        db_str.range("a", "b", function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                chai_1.expect(dataFromDB).to.deep.equal(data["str"].filter(function (v) { return v[0] > "a" && v[0] < "b"; }), "String range select failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        });
    });
    it("String: Range Select (Reverse)", function (done) {
        var dataFromDB = [];
        db_str.range("a", "b", function (key, value) {
            dataFromDB.push([key, value]);
        }, function () {
            try {
                var genData = data["str"].slice().filter(function (v) { return v[0] > "a" && v[0] < "b"; }).reverse();
                chai_1.expect(dataFromDB).to.deep.equal(genData, "String range select reverse failed!");
                done();
            }
            catch (e) {
                done(e);
            }
        }, true);
    });
});
//# sourceMappingURL=test.js.map