var level = require('level');
var rimraf = require("rimraf");
const fs = require("fs");
const SnapDB = require("../bin/index.js").SnapDB;


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
        process.exit();
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

const testSnapDB = (sampleData) => {
    return new Promise((res, rej) => {
        try {
            fs.unlinkSync("my_db");
        } catch(e) {

        }
        
        var db = new SnapDB("my_db", "string");
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
            }, () => {
                res([
                    Math.round(count / (Date.now() - start) * 1000),
                    writeSpeed
                ]);
            })
        })
    })
}

// make 100,000 records for both databases

let data = [];
for (let i = 0; i < 10000; i++) {
    data.push([makeid(10), makeid()]);
}
const average = (array) => Math.round(array.reduce((a, b) => a + b) / array.length);
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
            // testLevelMany();
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
            testSnapDBMany();
        }
    })
}

testLevelMany();
// testSnapDBMany();

