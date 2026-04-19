import * as fs from "fs";
import * as path from "path";
import { SnapDB } from "../src";

type Pair = [any, any];

function makeid() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < Math.ceil(Math.random() * 40) + 10; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const collectRows = (run: (onRecord: (key: any, value: any) => void, onComplete: (err?: any) => void) => void): Promise<Pair[]> => {
    const rows: Pair[] = [];
    return new Promise((resolve, reject) => {
        run((key, value) => rows.push([key, value]), (err) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

const getAllRows = (db: SnapDB<any>, reverse?: boolean) => collectRows((onRecord, onComplete) => db.getAll(onRecord, onComplete, reverse));
const offsetRows = (db: SnapDB<any>, offset: number, limit: number, reverse?: boolean) => collectRows((onRecord, onComplete) => db.offset(offset, limit, onRecord, onComplete, reverse));
const rangeRows = (db: SnapDB<any>, lower: any, higher: any, reverse?: boolean) => collectRows((onRecord, onComplete) => db.range(lower, higher, onRecord, onComplete, reverse));

const streamToArray = (readable: NodeJS.ReadableStream): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const rows: any[] = [];
        readable.on("data", (row) => rows.push(row));
        readable.on("error", reject);
        readable.on("end", () => resolve(rows));
    });
};

const expectReject = async (fn: () => Promise<any>, expectedMessage: string) => {
    let err;
    try {
        await fn();
    } catch (e) {
        err = e;
    }
    expect(String(err)).to.contain(expectedMessage);
};

const readManifest = (dbDir: string) => {
    return JSON.parse(fs.readFileSync(path.join(dbDir, "manifest.json"), "utf-8"));
};

export const runTests = (
    testName: string,
    new_str: () => SnapDB<any>,
    new_int: () => SnapDB<any>,
    new_flt: () => SnapDB<any>,
    new_any: () => SnapDB<any>
) => {
    let data: { [key: string]: Pair[] } = {};
    const runHeavyLSMTests = testName.indexOf("Single Thread") !== -1;
    const isolatedMainThread = runHeavyLSMTests;

    const db_str = new_str();
    const db_int = new_int();
    const db_flt = new_flt();
    const db_any = new_any();

    describe(testName, () => {
        it("Put Data", async () => {
            const size = 1000;

            await Promise.all([db_str, db_int, db_flt, db_any].map(async (db, i) => {
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
                        case 3: {
                            const dice = Math.floor(Math.random() * 3);
                            switch (dice) {
                                case 0:
                                    data[dataKey].push([k, makeid()]);
                                    break;
                                case 1:
                                    data[dataKey].push([k + (Math.round(Math.random() * 8) / 10), makeid()]);
                                    break;
                                default:
                                    data[dataKey].push([makeid(), makeid()]);
                                    break;
                            }
                            break;
                        }
                    }
                }

                data[dataKey] = data[dataKey].sort(() => Math.random() > 0.5 ? 1 : -1);
                await Promise.all(data[dataKey].map((pair) => db.put(pair[0], pair[1])));
            }));

            const result = await Promise.all([
                db_str.getCount(),
                db_int.getCount(),
                db_flt.getCount()
            ]);

            expect(result).to.deep.equal([size, size, size], "Put failed!");
        });

        it("The count should be zero after puting then deleting", async () => {
            const isolatedDB = new SnapDB<string>({ dir: "testDB-put-del", key: "string", mainThread: true });
            try {
                await isolatedDB.put("key", "val");
                await isolatedDB.delete("key");
                expect(await isolatedDB.getCount()).to.equal(0, "put/del size failed!");
            } finally {
                await isolatedDB.close();
            }
        });

        it("The count should be 1 after put data to the same key multiple times", async () => {
            const isolatedDB = new SnapDB<string>({ dir: "testDB-re-put", key: "string", mainThread: true });
            try {
                await isolatedDB.put("key", "val");
                await isolatedDB.put("key", "val");
                await isolatedDB.put("key", "val");
                expect(await isolatedDB.getCount()).to.equal(1, "Re-put failed!");
            } finally {
                await isolatedDB.close();
            }
        });

        it("Get non-exist key", async () => {
            expect(await db_str.get("non-exist-key")).to.equal(undefined);
        });

        it("Call close() for multiple times", async () => {
            const db = new SnapDB<string>({ dir: "testDB-close", key: "string" });
            await db.close();
            await db.close();
        });

        it("Rejects invalid writes", async () => {
            await expectReject(() => db_str.put(undefined as any, "value"), "Write Error: Key can't be null or undefined!");
            await expectReject(() => db_str.put("valid", undefined as any), "Write Error: Data must be a string or Buffer!");
            await expectReject(() => db_str.put("valid", 123 as any), "Write Error: Data must be a string or Buffer!");
            await expectReject(() => db_str.delete(undefined as any), "Write Error: Key can't be null or undefined!");
        });

        it("Buffer: value round-trips for string keys", async () => {
            const db = new SnapDB<string>({ dir: "testDB-buffer-value", key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            const payload = Buffer.from([0, 1, 2, 3, 254, 255]);

            await db.put("buf", payload);
            const value = await db.get("buf");

            expect(Buffer.isBuffer(value)).to.equal(true);
            expect((value as Buffer).equals(payload)).to.equal(true);
            await db.close();
        });

        it("Buffer: key+value round-trip in any mode", async () => {
            const db = new SnapDB<any>({ dir: "testDB-buffer-any", key: "any", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            const key = Buffer.from([0, 10, 20, 30, 40]);
            const payload = Buffer.from([9, 8, 7, 6, 5, 4]);

            await db.put(key, payload);
            const value = await db.get(Buffer.from([0, 10, 20, 30, 40]));
            expect(Buffer.isBuffer(value)).to.equal(true);
            expect((value as Buffer).equals(payload)).to.equal(true);

            const rows = await getAllRows(db);
            expect(Buffer.isBuffer(rows[0][0])).to.equal(true);
            expect((rows[0][0] as Buffer).equals(key)).to.equal(true);

            await db.close();
        });

        it("Buffer: dedicated buffer key mode supports ordered iteration", async () => {
            const db = new SnapDB<any>({ dir: "testDB-buffer-key-mode", key: "buffer", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            const k1 = Buffer.from([0x00, 0x01]);
            const k2 = Buffer.from([0x00, 0x02]);
            const k3 = Buffer.from([0x00, 0x03]);

            await db.put(k2, "v2");
            await db.put(k1, "v1");
            await db.put(k3, "v3");

            const rows = await getAllRows(db);
            expect((rows[0][0] as Buffer).equals(k1)).to.equal(true);
            expect((rows[1][0] as Buffer).equals(k2)).to.equal(true);
            expect((rows[2][0] as Buffer).equals(k3)).to.equal(true);
            expect(rows.map(r => r[1])).to.deep.equal(["v1", "v2", "v3"]);

            await db.close();
        });

        it("ACID: transaction writes are isolated until commit", async () => {
            const db = new SnapDB<string>({ dir: "testDB-acid-isolation", key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("shared", "v1");

            await db.startTx();
            await db.put("shared", "v2");
            await db.put("new-key", "nv");

            expect(await db.get("shared")).to.equal("v1");
            expect(await db.get("new-key")).to.equal(undefined);

            await db.endTx();

            expect(await db.get("shared")).to.equal("v2");
            expect(await db.get("new-key")).to.equal("nv");
            await db.close();
        });

        it("ACID: nested transaction start is rejected", async () => {
            const db = new SnapDB<string>({ dir: "testDB-acid-nested", key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();

            await db.startTx();
            await expectReject(() => db.startTx(), "Can't do nested transactions, finish the current one first!");
            expect(db.isTx).to.equal(true);

            await db.put("inside", "ok");
            await db.endTx();
            expect(await db.get("inside")).to.equal("ok");
            await db.close();
        });

        it("ACID: batch rollback on failure is atomic", async () => {
            const db = new SnapDB<string>({ dir: "testDB-acid-batch-rollback", key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("seed", "stable");

            await expectReject(() => db.batch([
                { type: "put", key: "good", value: "value" },
                { type: "del", key: undefined as any }
            ] as any), "Write Error: Key can't be null or undefined!");

            expect(await db.get("seed")).to.equal("stable");
            expect(await db.get("good")).to.equal(undefined);
            expect(db.isTx).to.equal(false);
            await db.close();
        });

        it("ACID: abortTx discards staged writes", async () => {
            const db = new SnapDB<string>({ dir: "testDB-acid-abort", key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("stable", "v1");

            await db.startTx();
            await db.put("stable", "v2");
            await db.put("temp", "v-temp");
            await db.abortTx();

            expect(await db.get("stable")).to.equal("v1");
            expect(await db.get("temp")).to.equal(undefined);
            expect(db.isTx).to.equal(false);
            await db.close();
        });

        it("ACID: aborted transaction is durable across restart", async () => {
            const dbDir = "testDB-acid-abort-durable";
            const db = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("stable", "v1");

            await db.startTx();
            await db.put("stable", "v2");
            await db.put("ephemeral", "v-temp");
            await db.abortTx();
            await db.close();

            const db2 = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db2.ready();
            expect(await db2.get("stable")).to.equal("v1");
            expect(await db2.get("ephemeral")).to.equal(undefined);
            await db2.close();
        });

        it("ACID: incomplete transaction is ignored on restart", async () => {
            const dbDir = "testDB-acid-recovery";
            const db = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("stable", "v1");

            await db.startTx();
            await db.put("stable", "v2");
            await db.put("ephemeral", "v-temp");
            await db.close();

            const db2 = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: true, cache: false });
            await db2.ready();
            expect(await db2.get("stable")).to.equal("v1");
            expect(await db2.get("ephemeral")).to.equal(undefined);
            await db2.close();
        });

        it("ACID: committed transaction is durable after restart", async () => {
            const dbDir = "testDB-acid-commit-durable";
            const db = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("stable", "v1");

            await db.startTx();
            await db.put("stable", "v2");
            await db.put("new-key", "nv");
            await db.endTx();
            await db.close();

            const db2 = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db2.ready();
            expect(await db2.get("stable")).to.equal("v2");
            expect(await db2.get("new-key")).to.equal("nv");
            await db2.close();
        });

        it("ACID: mixed put/delete transaction is atomic and durable", async () => {
            const dbDir = "testDB-acid-mixed-durable";
            const db = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db.ready();
            await db.put("a", "a1");
            await db.put("b", "b1");
            await db.put("c", "c1");

            await db.startTx();
            await db.put("a", "a2");
            await db.delete("b");
            await db.put("d", "d1");
            await db.endTx();
            await db.close();

            const db2 = new SnapDB<string>({ dir: dbDir, key: "string", mainThread: isolatedMainThread, cache: false });
            await db2.ready();
            expect(await db2.get("a")).to.equal("a2");
            expect(await db2.get("b")).to.equal(undefined);
            expect(await db2.get("c")).to.equal("c1");
            expect(await db2.get("d")).to.equal("d1");
            expect(await db2.getCount()).to.equal(3);
            await db2.close();
        });

        it("Integer: Sorted Keys", async () => {
            data["int"] = data["int"].sort((a, b) => a[0] > b[0] ? 1 : -1);
            expect(await getAllRows(db_int)).to.deep.equal(data["int"], "Integers not sorted!");
        });

        it("Integer: Key Exists", async () => {
            const randomKey = data["int"][Math.floor(Math.random() * data["int"].length)][0];
            expect(await db_int.exists(randomKey)).to.equal(true, "Integer key doesn't exist!");
        });

        it("Integer: Key Doesn't Exist", async () => {
            expect(await db_int.exists(Date.now())).to.equal(false, "Integer key exists!");
        });

        it("Integer: Delete Key", async () => {
            const thisValue = data["int"].splice(42, 1).pop() as Pair;
            await db_int.delete(thisValue[0]);
            expect(await getAllRows(db_int)).to.deep.equal(data["int"], "Integer key not deleted!");
        });

        it("Integer: Offset Select", async () => {
            expect(await offsetRows(db_int, 100, 10)).to.deep.equal(data["int"].slice(100, 110), "Integer offset select failed!");
        });

        it("Integer: Offset Select (Reverse)", async () => {
            expect(await offsetRows(db_int, 100, 10, true)).to.deep.equal(data["int"].slice().reverse().slice(100, 110), "Integer offset reverse select failed!");
        });

        it("Integer: Range Select", async () => {
            expect(await rangeRows(db_int, 20, 50)).to.deep.equal(data["int"].filter((v) => v[0] >= 20 && v[0] <= 50), "Integer range select failed!");
        });

        it("Integer: Range Select (Reverse)", async () => {
            expect(await rangeRows(db_int, 20, 50, true)).to.deep.equal(data["int"].filter((v) => v[0] >= 20 && v[0] <= 50).reverse(), "Integer range select reverse failed!");
            await db_int.close();
        });

        it("Integer: Loading From Log Works", async () => {
            await db_int.close();
            const db2 = new_int();
            const dataFromDB = await getAllRows(db2);
            expect(dataFromDB).to.deep.equal(data["int"], "Failed to load database from logs!");
        });

        it("Float: Sorted Keys", async () => {
            data["flt"] = data["flt"].sort((a, b) => a[0] > b[0] ? 1 : -1);
            expect(await getAllRows(db_flt)).to.deep.equal(data["flt"], "Floats not sorted!");
        });

        it("Float: Key Exists", async () => {
            const randomKey = data["flt"][Math.floor(Math.random() * data["flt"].length)][0];
            expect(await db_flt.exists(randomKey)).to.equal(true, "Float key doesn't exist!");
        });

        it("Float: Key Doesn't Exist", async () => {
            expect(await db_flt.exists(Date.now())).to.equal(false, "Float key exists!");
        });

        it("Float: Delete Key", async () => {
            const thisValue = data["flt"].splice(42, 1).pop() as Pair;
            await db_flt.delete(thisValue[0]);
            expect(await getAllRows(db_flt)).to.deep.equal(data["flt"], "Float key not deleted!");
        });

        it("Float: Offset Select", async () => {
            expect(await offsetRows(db_flt, 100, 10)).to.deep.equal(data["flt"].slice(100, 110), "Float offset select failed!");
        });

        it("Float: Offset Select (Reverse)", async () => {
            expect(await offsetRows(db_flt, 100, 10, true)).to.deep.equal(data["flt"].slice().reverse().slice(100, 110), "Float offset reverse select failed!");
        });

        it("Float: Range Select", async () => {
            expect(await rangeRows(db_flt, 20.5, 50.5)).to.deep.equal(data["flt"].filter((v) => v[0] >= 20.5 && v[0] <= 50.5), "Float range select failed!");
        });

        it("Float: Range Select (Reverse)", async () => {
            expect(await rangeRows(db_flt, 20.5, 50.5, true)).to.deep.equal(data["flt"].filter((v) => v[0] >= 20.5 && v[0] <= 50.5).reverse(), "Float range select reverse failed!");
            await db_flt.close();
        });

        it("Float: Loading From Log Works", async () => {
            await db_flt.close();
            const db2 = new_flt();
            const dataFromDB = await getAllRows(db2);
            expect(dataFromDB).to.deep.equal(data["flt"], "Failed to load database from logs!");
        });

        it("String: Sorted Keys", async () => {
            data["str"] = data["str"].sort((a, b) => a[0] > b[0] ? 1 : -1);
            expect(await getAllRows(db_str)).to.deep.equal(data["str"], "Strings not sorted!");
        });

        it("String: Key Exists", async () => {
            const randomKey = data["str"][Math.floor(Math.random() * data["str"].length)][0];
            expect(await db_str.exists(randomKey)).to.equal(true, "String key doesn't exist!");
        });

        it("String: Key Doesn't Exist", async () => {
            const impossibleKey = "There is no way this combination of letters and spaces will happen.";
            expect(await db_str.exists(impossibleKey)).to.equal(false, "String key exists!");
        });

        it("String: Delete Key", async () => {
            const thisValue = data["str"].splice(42, 1).pop() as Pair;
            await db_str.delete(thisValue[0]);
            expect(await getAllRows(db_str)).to.deep.equal(data["str"], "String key not deleted!");
        });

        it("String: Offset Select", async () => {
            expect(await offsetRows(db_str, 100, 10)).to.deep.equal(data["str"].slice(100, 110), "String offset select failed!");
        });

        it("String: Offset Select (Reverse)", async () => {
            expect(await offsetRows(db_str, 100, 10, true)).to.deep.equal(data["str"].slice().reverse().slice(100, 110), "String offset reverse select failed!");
        });

        it("String: Range Select", async () => {
            expect(await rangeRows(db_str, "a", "b")).to.deep.equal(data["str"].filter((v) => v[0] > "a" && v[0] < "b"), "String range select failed!");
        });

        it("String: Range Select (Reverse)", async () => {
            expect(await rangeRows(db_str, "a", "b", true)).to.deep.equal(data["str"].filter((v) => v[0] > "a" && v[0] < "b").reverse(), "String range select reverse failed!");
            await db_str.close();
        });

        it("String: Loading From Log Works", async () => {
            await db_str.close();
            const db2 = new_str();
            const dataFromDB = await getAllRows(db2);
            expect(dataFromDB).to.deep.equal(data["str"], "Failed to load database from logs!");
        });

        it("Any: Sorted Keys", async () => {
            data["any"] = data["any"].sort((a, b) => {
                if (a[0] === b[0]) return 0;
                if (typeof a[0] === typeof b[0]) return a[0] > b[0] ? 1 : -1;
                return typeof a[0] > typeof b[0] ? 1 : -1;
            });
            expect(await getAllRows(db_any)).to.deep.equal(data["any"], "Any not sorted!");
        });

        it("Any: Key Exists", async () => {
            const randomKey = data["any"][Math.floor(Math.random() * data["any"].length)][0];
            expect(await db_any.exists(randomKey)).to.equal(true, "Any key doesn't exist!");
        });

        it("Any: Key Doesn't Exist", async () => {
            const impossibleKey = "There is no way this combination of letters and spaces will happen.";
            expect(await db_any.exists(impossibleKey)).to.equal(false, "Any key exists!");
        });

        it("Any: Delete Key", async () => {
            const thisValue = data["any"].splice(42, 1).pop() as Pair;
            await db_any.delete(thisValue[0]);
            expect(await getAllRows(db_any)).to.deep.equal(data["any"], "Any key not deleted!");
        });

        it("Any: Offset Select", async () => {
            expect(await offsetRows(db_any, 100, 10)).to.deep.equal(data["any"].slice(100, 110), "Any offset select failed!");
        });

        it("Any: Offset Select (Reverse)", async () => {
            expect(await offsetRows(db_any, 100, 10, true)).to.deep.equal(data["any"].slice().reverse().slice(100, 110), "Any offset reverse select failed!");
        });

        it("Any: Range Select", async () => {
            expect(await rangeRows(db_any, "a", "b")).to.deep.equal(data["any"].filter((v) => v[0] > "a" && v[0] < "b"), "Any range select failed!");
        });

        it("Any: Range Select (Reverse)", async () => {
            expect(await rangeRows(db_any, "a", "b", true)).to.deep.equal(data["any"].filter((v) => v[0] > "a" && v[0] < "b").reverse(), "Any range select reverse failed!");
            await db_any.close();
        });

        it("Any: Loading From Log Works", async () => {
            await db_any.close();
            const db2 = new_any();
            const dataFromDB = await getAllRows(db2);
            await db2.close();
            expect(dataFromDB).to.deep.equal(data["any"], "Failed to load database from logs!");
        });

        it("Batch operations update state correctly", async () => {
            const db = new SnapDB<string>({ dir: "testDB-batch", key: "string", mainThread: true });
            await db.ready();
            await db.batch([
                { type: "put", key: "a", value: "1" },
                { type: "put", key: "b", value: "2" },
                { type: "del", key: "a" }
            ]);
            expect(await db.get("a")).to.equal(undefined);
            expect(await db.get("b")).to.equal("2");
            expect(await db.getCount()).to.equal(1);
            await db.close();
        });

        it("Chained batch helper runs and clears queued ops", async () => {
            const db = new SnapDB<string>({ dir: "testDB-batch-chain", key: "string", mainThread: true });
            await db.ready();
            const chain = db.batch();
            chain.put("x", "1").put("y", "2").del("x");
            expect(chain.length).to.equal(3);
            await chain.write();
            expect(await db.get("x")).to.equal(undefined);
            expect(await db.get("y")).to.equal("2");

            const cleared = db.batch().put("will-clear", "1").clear();
            expect(cleared.length).to.equal(0);
            await cleared.write();
            expect(await db.get("will-clear")).to.equal(undefined);
            await db.close();
        });

        it("Stream APIs return expected key/value shapes", async () => {
            const db = new SnapDB<string>({ dir: "testDB-streams", key: "string", mainThread: true });
            await db.ready();
            await db.put("aa", "11");
            await db.put("bb", "22");

            const readRows = await streamToArray(db.createReadStream({ gte: "aa", lte: "zz" }));
            const keyRows = await streamToArray(db.createKeyStream({ gte: "aa", lte: "zz" }));
            const valueRows = await streamToArray(db.createValueStream({ gte: "aa", lte: "zz" }));

            expect(readRows).to.deep.equal([
                { key: "aa", value: "11" },
                { key: "bb", value: "22" }
            ]);
            expect(keyRows).to.deep.equal(["aa", "bb"]);
            expect(valueRows).to.deep.equal(["11", "22"]);
            await db.close();
        });

        it("`del` alias and `empty` clear data", async () => {
            const db = new SnapDB<string>({ dir: "testDB-empty", key: "string", mainThread: true });
            await db.ready();
            await db.put("k1", "v1");
            await db.put("k2", "v2");
            await db.del("k1");
            expect(await db.exists("k1")).to.equal(false);
            expect(await db.getCount()).to.equal(1);
            await db.empty();
            expect(await db.getCount()).to.equal(0);
            await db.close();
        });

        if (runHeavyLSMTests) {
            it("LSM: compaction preserves newest values and tombstones across levels", async () => {
                const dbDir = "testDB-lsm-compaction";
                const largePayload = (tag: string) => tag + ":" + "x".repeat(300000);

                const db = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db.ready();

                for (let i = 0; i < 40; i++) {
                    await db.put(i, largePayload("v1-" + i));
                }
                await db.flushLog();

                const manifestAfterWave1 = readManifest(dbDir);
                expect((manifestAfterWave1.lvl[1]?.files?.length || 0) > 0).to.equal(true);

                for (let i = 0; i < 34; i++) {
                    await db.put(i, largePayload("v2-" + i));
                }
                for (let i = 0; i < 5; i++) {
                    await db.delete(i);
                }
                await db.flushLog();
                await db.close();

                const db2 = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db2.ready();

                const updated = await db2.get(10);
                const preserved = await db2.get(38);
                const deleted = await db2.get(2);

                expect(updated && updated.indexOf("v2-10:") === 0).to.equal(true);
                expect(preserved && preserved.indexOf("v1-38:") === 0).to.equal(true);
                expect(deleted).to.equal(undefined);

                await db2.close();
            }, 90000);

            it("LSM: multi-wave writes keep newest generation per key after restart", async () => {
                const dbDir = "testDB-lsm-multi-wave";
                const largePayload = (tag: string) => tag + ":" + "x".repeat(250000);

                const db = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db.ready();

                for (let i = 0; i < 60; i++) {
                    await db.put(i, largePayload("v1-" + i));
                }
                await db.flushLog();

                for (let i = 0; i < 50; i++) {
                    await db.put(i, largePayload("v2-" + i));
                }
                for (let i = 0; i < 10; i++) {
                    await db.delete(i);
                }
                await db.flushLog();

                for (let i = 20; i < 40; i++) {
                    await db.put(i, largePayload("v3-" + i));
                }
                await db.flushLog();
                await db.close();

                const db2 = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db2.ready();

                const deleted = await db2.get(5);
                const latestV3 = await db2.get(25);
                const latestV2 = await db2.get(45);
                const originalV1 = await db2.get(58);

                expect(deleted).to.equal(undefined);
                expect(latestV3 && latestV3.indexOf("v3-25:") === 0).to.equal(true);
                expect(latestV2 && latestV2.indexOf("v2-45:") === 0).to.equal(true);
                expect(originalV1 && originalV1.indexOf("v1-58:") === 0).to.equal(true);

                await db2.close();
            }, 90000);

            it("LSM: restart preserves key count with updates, inserts, and tombstones", async () => {
                const dbDir = "testDB-lsm-counts";
                const largePayload = (tag: string) => tag + ":" + "x".repeat(220000);

                const db = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db.ready();

                for (let i = 0; i < 80; i++) {
                    await db.put(i, largePayload("v1-" + i));
                }
                await db.flushLog();

                for (let i = 0; i < 60; i++) {
                    await db.put(i, largePayload("v2-" + i));
                }
                for (let i = 0; i < 15; i++) {
                    await db.delete(i);
                }
                await db.flushLog();

                for (let i = 80; i < 110; i++) {
                    await db.put(i, largePayload("v3-" + i));
                }
                await db.flushLog();
                await db.close();

                const db2 = new SnapDB<number>({ dir: dbDir, key: "int", mainThread: true, autoFlush: false, cache: false });
                await db2.ready();

                expect(await db2.getCount()).to.equal(95);
                const deleted = await db2.get(4);
                const updated = await db2.get(30);
                const original = await db2.get(70);
                const inserted = await db2.get(100);

                expect(deleted).to.equal(undefined);
                expect(updated && updated.indexOf("v2-30:") === 0).to.equal(true);
                expect(original && original.indexOf("v1-70:") === 0).to.equal(true);
                expect(inserted && inserted.indexOf("v3-100:") === 0).to.equal(true);

                await db2.close();
            }, 90000);
        }
    });
};
