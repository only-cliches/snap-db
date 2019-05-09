import { expect, assert } from "chai";
import "mocha";
import { SnapDB } from "../src/index";

function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

const db_str = new SnapDB("testDB1", "string");
const db_int = new SnapDB("testDB2", "int");
const db_flt = new SnapDB("testDB3", "float");

let data: {
    [key: string]: [any, any][];
} = {};


describe("SnapDB Tests", () => {
    it("Put Data", (done: MochaDone) => {
        Promise.all([db_str, db_int, db_flt].map((s, i) => {
            return s.ready().then(() => {
                const dataKey = ["str", "int", "flt"][i];
                data[dataKey] = [];
                for(let k = 1; k < 10000; k++) {
                    switch(i) {
                        case 0:
                            data[dataKey].push([makeid(), makeid()]);
                        break;
                        case 1:
                            data[dataKey].push([k, makeid()]);
                        break;
                        case 2:
                            data[dataKey].push([k + (Math.round(Math.random() * 8)/10), makeid()]);
                        break;
                    }
                }
                // scramble for insert
                data[dataKey] = data[dataKey].sort((a, b) => Math.random() > 0.5 ? 1 : -1);
                return Promise.all(data[dataKey].map(k => {
                    return s.put(k[0], k[1]);
                }))
            });
        })).then(() => {
            try {
                expect([
                    db_str.getCount(),
                    db_int.getCount(),
                    db_flt.getCount(),
                ]).to.deep.equal([
                    9999,
                    9999,
                    9999
                ], "Put failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Integer: Sorted Keys", (done: MochaDone) => {
        data["int"] = data["int"].sort((a, b) => a[0] > b[0] ? 1 : -1);
        let dataFromDB: any[] = [];
        db_int.getAll((key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["int"], "Integers not sorted!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Integer: Delete Key", (done: MochaDone) => {
        const thisValue = data["int"].splice(42, 1).pop() as [any, any];

        db_int.delete(thisValue[0]).then(() => {
            let dataFromDB: any[] = [];
            db_int.getAll((key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["int"], "Integer key not deleted!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        }).catch((e) => {
            done(e);
        });
    });

    it("Integer: Offset Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_int.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["int"].slice(99, 109);
                expect(dataFromDB).to.deep.equal(genData, "Integer offset select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Integer: Offset Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_int.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const len = db_int.getCount();
                const genData = data["int"].slice().reverse().slice(99, 109);
                expect(dataFromDB).to.deep.equal(genData, "Integer offset reverse select failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });

    it("Integer: Range Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_int.range(20, 50, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["int"].filter((v) => v[0] >= 20 && v[0] <= 50);
                expect(dataFromDB).to.deep.equal(genData, "Integer range select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Integer: Range Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_int.range(20, 50, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["int"].slice().filter((v) => v[0] >= 20 && v[0] <= 50).reverse();
                expect(dataFromDB).to.deep.equal(genData, "Integer range select reverse failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });






    it("Float: Sorted Keys", (done: MochaDone) => {
        data["flt"] = data["flt"].sort((a, b) => a[0] > b[0] ? 1 : -1);
        let dataFromDB: any[] = [];
        db_flt.getAll((key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["flt"], "Floats not sorted!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Float: Delete Key", (done: MochaDone) => {
        const thisValue = data["flt"].splice(42, 1).pop() as [any, any];

        db_flt.delete(thisValue[0]).then(() => {
            let dataFromDB: any[] = [];
            db_flt.getAll((key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["flt"], "Float key not deleted!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        }).catch((e) => {
            done(e);
        });
    });

    it("Float: Offset Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_flt.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["flt"].slice(99, 109), "Float offset select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Float: Offset Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_flt.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const len = db_flt.getCount();
                const genData = data["flt"].slice().reverse().slice(99, 109);
                expect(dataFromDB).to.deep.equal(genData, "Float offset reverse select failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });

    it("Float: Range Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_flt.range(20.5, 50.5, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["flt"].filter((v) => v[0] >= 20.5 && v[0] <= 50.5);
                expect(dataFromDB).to.deep.equal(genData, "Float range select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("Float: Range Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_flt.range(20.5, 50.5, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["flt"].slice().filter((v) => v[0] >= 20.5 && v[0] <= 50.5).reverse();
                expect(dataFromDB).to.deep.equal(genData, "Float range select reverse failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });







    it("String: Sorted Keys", (done: MochaDone) => {
    
        data["str"] = data["str"].sort((a, b) => a[0] > b[0] ? 1 : -1);
        let dataFromDB: any[] = [];
        db_str.getAll((key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["str"], "Strings not sorted!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("String: Delete Key", (done: MochaDone) => {
        const thisValue = data["str"].splice(42, 1).pop() as [any, any];

        db_str.delete(thisValue[0]).then(() => {
            let dataFromDB: any[] = [];
            db_str.getAll((key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["str"], "String key not deleted!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        }).catch((e) => {
            done(e);
        });
    });

    it("String: Offset Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_str.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["str"].slice(99, 109), "String offset select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("String: Offset Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_str.offset(100, 10, (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const len = db_str.getCount();
                expect(dataFromDB).to.deep.equal(data["str"].slice().reverse().slice(99, 109), "String offset reverse select failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });

    it("String: Range Select", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_str.range("a", "b", (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                expect(dataFromDB).to.deep.equal(data["str"].filter((v) => v[0] > "a" && v[0] < "b"), "String range select failed!");
                done();
            } catch (e) {
                done(e);
            }
        });
    });

    it("String: Range Select (Reverse)", (done: MochaDone) => {
        let dataFromDB: any[] = [];
        db_str.range("a", "b", (key, value) => {
            dataFromDB.push([key, value]);
        }, () => {
            try {
                const genData = data["str"].slice().filter((v) => v[0] > "a" && v[0] < "b").reverse();
                expect(dataFromDB).to.deep.equal(genData, "String range select reverse failed!");
                done();
            } catch (e) {
                done(e);
            }
        }, true);
    });

});