import { expect, assert } from "chai";
import "mocha";
import { SnapDB } from "./index";

function makeid() {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < Math.ceil(Math.random() * 40) + 10; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

export const runTests = (testName: string, new_str: () => SnapDB<any>, new_int: () => SnapDB<any>, new_flt: () => SnapDB<any>, new_any: () => SnapDB<any>) => {

    let data: {
        [key: string]: [any, any][];
    } = {};

    const db_str = new_str();
    const db_int = new_int();
    const db_flt = new_flt();
    const db_any = new_any();

    describe(testName, () => {
        it("Put Data", (done: MochaDone) => {
            const size = 1000;
            Promise.all([db_str, db_int, db_flt, db_any].map((s, i) => {

                const dataKey = ["str", "int", "flt", "any"][i];
                data[dataKey] = [];
                for (let k = 0; k < size; k++) {
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
                        case 3:
                            const dice = Math.floor(Math.random() * 3);
                            switch(dice) {
                                case 0:
                                    data[dataKey].push([k, makeid()]);
                                break;
                                case 1:
                                    data[dataKey].push([k + (Math.round(Math.random() * 8) / 10), makeid()]);
                                break;
                                case 2:
                                    data[dataKey].push([makeid(), makeid()]);
                                break;
                            }
                            break;
                    }
                }
                // scramble for insert
                data[dataKey] = data[dataKey].sort((a, b) => Math.random() > 0.5 ? 1 : -1);
                return Promise.all(data[dataKey].map(k => s.put(k[0], k[1])))

            })).then(() => {
                Promise.all([
                    db_str.getCount(),
                    db_int.getCount(),
                    db_flt.getCount()
                ]).then((result) => {
                    try {
                        expect(result).to.deep.equal([
                            size,
                            size,
                            size
                        ], "Put failed!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                })

            });
        }).timeout(30000);

        it("Get non-exist key", (done: MochaDone) => {
            db_str.get('non-exist-key').then((val) => {
                try {
                    expect(val).to.equal(undefined, "get a non-exist key should return undefined");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);

        });

        it("Call close() for multiple times", (done: MochaDone) => {
            const db = new SnapDB<string>({ dir: "testDB-close", key: "string" })
            db.close()
                .then(() => db.close())
                .then(() => done())
                .catch(done);
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

        it("Integer: Key Exists", (done: MochaDone) => {
            const randomKey = data["int"][Math.floor(Math.random() * data["int"].length)][0];
            db_int.exists(randomKey).then((exists) => {
                try {
                    expect(exists).to.equal(true, "Integer key doesn't exist!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Integer: Key Doesn't Exist", (done: MochaDone) => {
            const impossibleKey = Date.now();
            db_int.exists(impossibleKey).then((exists) => {
                try {
                    expect(exists).to.equal(false, "Integer key exists!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Integer: Delete Key", (done: MochaDone) => {
            const thisValue = data["int"].splice(42, 1).pop() as [any, any];

            db_int.delete(thisValue[0]);
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

        });

        it("Integer: Offset Select", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_int.offset(100, 10, (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    const genData = data["int"].slice(100, 110);
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
                    const genData = data["int"].slice().reverse().slice(100, 110);
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
                db_int.close();
            }, true);
        });

        it("Integer: Loading From Log Works", (done: MochaDone) => {

            db_int.close().then(() => {

                const db2 = new_int();
                let dataFromDB: any[] = [];
                db2.getAll((key, value) => {
                    dataFromDB.push([key, value]);
                }, () => {
                    try {
                        expect(dataFromDB).to.deep.equal(data["int"], "Failed to load database from logs!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            });
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

        it("Float: Key Exists", (done: MochaDone) => {
            const randomKey = data["flt"][Math.floor(Math.random() * data["flt"].length)][0];
            db_flt.exists(randomKey).then((exists) => {
                try {
                    expect(exists).to.equal(true, "Float key doesn't exist!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Float: Key Doesn't Exist", (done: MochaDone) => {
            const impossibleKey = Date.now();
            db_flt.exists(impossibleKey).then((exists) => {
                try {
                    expect(exists).to.equal(false, "Float key exists!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Float: Delete Key", (done: MochaDone) => {
            const thisValue = data["flt"].splice(42, 1).pop() as [any, any];

            db_flt.delete(thisValue[0]);

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

        });

        it("Float: Offset Select", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_flt.offset(100, 10, (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["flt"].slice(100, 110), "Float offset select failed!");
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
                    const genData = data["flt"].slice().reverse().slice(100, 110);
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
                db_flt.close();
            }, true);
        });

        it("Float: Loading From Log Works", (done: MochaDone) => {

            db_flt.close().then(() => {

                const db2 = new_flt();
                let dataFromDB: any[] = [];
                db2.getAll((key, value) => {
                    dataFromDB.push([key, value]);
                }, () => {
                    try {
                        expect(dataFromDB).to.deep.equal(data["flt"], "Failed to load database from logs!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            });
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

        it("String: Key Exists", (done: MochaDone) => {
            const randomKey = data["str"][Math.floor(Math.random() * data["str"].length)][0];
            db_str.exists(randomKey).then((exists) => {
                try {
                    expect(exists).to.equal(true, "String key doesn't exist!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("String: Key Doesn't Exist", (done: MochaDone) => {
            const impossibleKey = "There is no way this combination of letters and spaces will happen.";
            db_str.exists(impossibleKey).then((exists) => {
                try {
                    expect(exists).to.equal(false, "String key exists!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("String: Delete Key", (done: MochaDone) => {
            const thisValue = data["str"].splice(42, 1).pop() as [any, any];

            db_str.delete(thisValue[0])
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

        });

        it("String: Offset Select", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_str.offset(100, 10, (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["str"].slice(100, 110), "String offset select failed!");
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
                    expect(dataFromDB).to.deep.equal(data["str"].slice().reverse().slice(100, 110), "String offset reverse select failed!");
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

                db_str.close();

            }, true);
        });

        it("String: Loading From Log Works", (done: MochaDone) => {

            db_str.close().then(() => {

                const db2 = new_str();
                let dataFromDB: any[] = [];
                db2.getAll((key, value) => {
                    dataFromDB.push([key, value]);
                }, () => {
                    try {
                        expect(dataFromDB).to.deep.equal(data["str"], "Failed to load database from logs!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            });
        });




        it("Any: Sorted Keys", (done: MochaDone) => {
            data["any"] = data["any"].sort((a, b) => {
                if (a[0] === b[0]) return 0;
                if (typeof a[0] === typeof b[0]) return a[0] > b[0] ? 1 : -1;
                return typeof a[0] > typeof b[0] ? 1 : -1;
            });
            let dataFromDB: any[] = [];
            db_any.getAll((key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["any"], "Any not sorted!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });


        it("Any: Key Exists", (done: MochaDone) => {
            const randomKey = data["any"][Math.floor(Math.random() * data["any"].length)][0];
            db_any.exists(randomKey).then((exists) => {
                try {
                    expect(exists).to.equal(true, "Any key doesn't exist!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Any: Key Doesn't Exist", (done: MochaDone) => {
            const impossibleKey = "There is no way this combination of letters and spaces will happen.";
            db_any.exists(impossibleKey).then((exists) => {
                try {
                    expect(exists).to.equal(false, "Any key exists!");
                    done();
                } catch (e) {
                    done(e);
                }
            }).catch(done);
        });

        it("Any: Delete Key", (done: MochaDone) => {
            const thisValue = data["any"].splice(42, 1).pop() as [any, any];

            db_any.delete(thisValue[0]).then(() => {
                let dataFromDB: any[] = [];
                db_any.getAll((key, value) => {
                    dataFromDB.push([key, value]);
                }, () => {
                    try {
                        expect(dataFromDB).to.deep.equal(data["any"], "Any key not deleted!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                });
            })
        });

        it("Any: Offset Select", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_any.offset(100, 10, (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["any"].slice(100, 110), "Any offset select failed!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it("Any: Offset Select (Reverse)", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_any.offset(100, 10, (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    const len = db_any.getCount();
                    expect(dataFromDB).to.deep.equal(data["any"].slice().reverse().slice(100, 110), "Any offset reverse select failed!");
                    done();
                } catch (e) {
                    done(e);
                }
            }, true);
        });

        it("Any: Range Select", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_any.range("a", "b", (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    expect(dataFromDB).to.deep.equal(data["any"].filter((v) => v[0] > "a" && v[0] < "b"), "Any range select failed!");
                    done();
                } catch (e) {
                    done(e);
                }
            });
        });

        it("Any: Range Select (Reverse)", (done: MochaDone) => {
            let dataFromDB: any[] = [];
            db_any.range("a", "b", (key, value) => {
                dataFromDB.push([key, value]);
            }, () => {
                try {
                    const genData = data["any"].slice().filter((v) => v[0] > "a" && v[0] < "b").reverse();
                    expect(dataFromDB).to.deep.equal(genData, "Any range select reverse failed!");
                    done();
                } catch (e) {
                    done(e);
                }

                db_any.close();

            }, true);
        });

        it("Any: Loading From Log Works", (done: MochaDone) => {

            db_any.close().then(() => {

                const db2 = new_any();
                let dataFromDB: any[] = [];
                db2.getAll((key, value) => {
                    dataFromDB.push([key, value]);
                }, () => {
                    db2.close();
                    try {
                        expect(dataFromDB).to.deep.equal(data["any"], "Failed to load database from logs!");
                        done();
                    } catch (e) {
                        done(e);
                    }
                    process.exit();
                });
            });
        });

    });

}
