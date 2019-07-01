const level = require('level');
const rimraf = require("rimraf");
const fs = require("fs");
const path = require("path");
const SnapDB = require("../bin/index.js").SnapDB;
const diskDB = require('diskdb');

function makeid(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (var i = 0; i < (length || Math.ceil(Math.random() * 90) + 10); i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

const testLevelDB = (sampleData) => {
    return new Promise((res, rej) => {
        const dbName = makeid(10);
        
        
        var db = level(dbName);
        const sampleBatch = sampleData.map(s => {
            return {type: "put", key: s[0], value: s[1]};
        });

        let start = Date.now();
        db.batch(sampleBatch, (err) => {
            if (err) return console.log(err);
            
            let writeSpeed = Math.round(sampleData.length / (Date.now() - start) * 1000);
            start = Date.now();
            const read = db.createReadStream();
            let count = 0;
            read.on("data", () => {
                count++;
            }).on("end", () => {
                db.close();
                let end = Date.now();
                setTimeout(() => {
                    rimraf.sync(dbName);
                    res([
                        Math.round(count / (end - start) * 1000),
                        writeSpeed
                    ]);
                }, 100);
            })
        })
        
    })
}

const testDiskDB = (sampleData) => {
    return new Promise((res, rej) => {
        const dbName = makeid(10);

        fs.mkdirSync(path.join(__dirname, dbName));
        
        var db = diskDB.connect(path.join(__dirname, dbName), ['testing']);

        let start = Date.now();
        db.testing.save(sampleData.sort((a, b) => a[0] < b[0] ? 1 : -1).map(a => ({key: a[0], value: [1]})));
        let writeSpeed = Math.round(sampleData.length / (Date.now() - start) * 1000);
        start = Date.now();

        const rows = db.testing.find();
        let end = Date.now();

        rimraf.sync(path.join(__dirname, dbName));

        res([
            Math.round(rows.length / (end - start) * 1000),
            writeSpeed
        ]);
    })
}

const testSnapDB = (sampleData) => {
    return new Promise((res, rej) => {
        const dbName = makeid(10);
        
        var db = new SnapDB({dir: dbName, key: "string", cache: true, mainThread: true});
        let start = 0;
        let writeSpeed = 0;
        db.ready().then(() => {
            start = Date.now();
            return db.begin_transaction().then(() => {
                return Promise.all(sampleData.map(s => db.put(s[0], s[1])))
            }).then(() => {
                return db.end_transaction();
            }).then(() => {
                writeSpeed = Math.round(sampleData.length / (Date.now() - start) * 1000);
                return Promise.resolve();
            })
        }).then(() => {
            start = Date.now();
            let count = 0;
            db.getAll((key, data) => {
                count++;
            }, (err) => {
                const readSpead = Math.round(count / (Date.now() - start) * 1000);
                db.close().then(() => {
                    rimraf.sync(dbName);
                    res([
                        readSpead,
                        writeSpeed
                    ]);
                });
            })
        })
    })
}

// make 10,000 records for both databases

let data = [];
for (let i = 0; i < 10000; i++) {
    data.push([makeid(10), makeid()]);
}
const average = (array) => Math.round(array.reduce((a, b) => a + b) / array.length);

let results3 = [];
const testDiskDBMany = () => {
    testDiskDB(data.slice()).then((result) => {
        results3.push(result);
        if (results3.length < 5) {
            testDiskDBMany();
        } else {
            
            const writes = results3.map(s => s[1]);
            const reads = results3.map(s => s[0]);
            console.log("DiskDB");
            console.log(average(writes).toLocaleString(), "op/s (WRITE)");
            console.log(average(reads).toLocaleString(), "op/s (READ)");
        }
    })
}

let results2 = [];
const testSnapDBMany = () => {
    testSnapDB(data.slice()).then((result) => {
        results2.push(result);
        if (results2.length < 5) {
            testSnapDBMany();
        } else {
            
            const writes = results2.map(s => s[1]);
            const reads = results2.map(s => s[0]);
            console.log("SnapDB");
            console.log(average(writes).toLocaleString(), "op/s (WRITE)");
            console.log(average(reads).toLocaleString(), "op/s (READ)");
            testLevelMany();
        }
    })
}



let results = [];
const testLevelMany = () => {
    testLevelDB(data.slice()).then((result) => {
        results.push(result);
        if (results.length < 5) {
            testLevelMany();
        } else {
            rimraf.sync("my_db");
            console.log("LevelDB");
            const writes = results.map(s => s[1]);
            const reads = results.map(s => s[0]);
            console.log(average(writes).toLocaleString(), "op/s (WRITE)");
            console.log(average(reads).toLocaleString(), "op/s (READ)");
            testDiskDBMany();
        }
    })
}

// testLevelMany();
testSnapDBMany();

