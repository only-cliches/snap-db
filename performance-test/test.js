var level = require('level');
var rimraf = require("rimraf");
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

        rimraf.sync("my_db");
        
        var db = level("my_db");
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
        rimraf.sync("my_db");
        var db = new SnapDB("my_db", "int", true);
        let start = 0;
        db.ready().then(() => {
            start = Date.now();
            return Promise.all(sampleData.map((s, i) => db.put(i, s[1])));
        }).then(() => {
            let writeSpeed = Math.round(sampleData.length / (Date.now() - start) * 1000);
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
for (let i = 0; i < 100000; i++) {
    data.push([makeid(10), makeid()]);
}

let results2 = [];
const testSnapDBMany = () => {
    testSnapDB(data).then((result) => {
        results2.push(result);
        if (results2.length < 5) {
            testSnapDBMany();
        } else {
            rimraf.sync("my_db");
            console.log("Snap DB");
            console.log(Math.round(results2.reduce((p, c) => (p[1] || 0) + c[1])/results2.length).toLocaleString(), "op/s (WRITE)");
            console.log(Math.round(results2.reduce((p, c) => (p[0] || 0) + c[0])/results2.length).toLocaleString(), "op/s (READ)");
            testLevelMany();
        }
    })
}



let results = [];
const testLevelMany = () => {
    testLevelDB(data).then((result) => {
        results.push(result);
        if (results.length < 5) {
            testLevelMany();
        } else {
            rimraf.sync("my_db");
            console.log("Level DB");
            console.log(Math.round(results.reduce((p, c) => (p[1] || 0) + c[1])/results.length).toLocaleString(), "op/s (WRITE)");
            console.log(Math.round(results.reduce((p, c) => (p[0] || 0) + c[0])/results.length).toLocaleString(), "op/s (READ)");
            // testSnapDBMany();
        }
    })
}

// testLevelMany();
testSnapDBMany();

