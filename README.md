# Snap-DB
Fast & Durable key-value store for NodeJS/Electron

Get a running database in a snap!

<p>
  <a href="https://badge.fury.io/js/snap-db">
    <img src="https://badge.fury.io/js/snap-db.svg">
  </a>
  <a href="https://www.npmjs.com/package/snap-db">
    <img src="https://img.shields.io/npm/dm/snap-db.svg">
  </a>
</p>

SnapDB is a pure javascript persistent key-value store that provides ordered mapping from keys to string values. Data is persisted to disk using a Log Structure Merge Tree (LSM Tree) inspired by LevelDB / RocksDB.

Uses synchronous filesystem methods to only perform append writes to disk, this puts the performance of SnapDB near the theoretical maximum write performance for ACID javascript databases.

## Features

- Zero dependencies.
- Zero compiling.
- Zero configuring.
- ACID Compliant with transaction support.
- Optionally control compaction manually.
- Constant time range & offset/limit queries.
- Typescript & Babel friendly.
- Works in NodeJS and Electron.
- Keys are sorted, allowing *very fast* range queries.
- Data is durable in the face of application or power failure.
- Runs in it's own thread to prevent blocking.
- Includes event system.

## Installation

```
npm i snap-db --save
```

## Usage

```ts
import { SnapDB } from "snap-db";

const db = new SnapDB({
    dir: "my_db", // database folder
    key: "int", // key type, can be "int", "string" or "float"
    cache: false, // enable or disable value cache,
    autoFlush: true // automatically flush the log and perform compaction
});

// wait for db to be ready
db.ready().then(() => {
    // put a record
    return db.put(20, "hello");
}).then(() => {
    // get a record
    return db.get(20);
}).then((data) => {
    console.log(data) // "hello"
})
```

## API

The `SnapDB` class accepts a single argument which is an object that has the following properties: 

### Arguments

| Argument | Required | Type                       | Details                                                                                                              |
|----------|------|----------------------------|----------------------------------------------------------------------------------------------------------------------|
| dir | true | string                     | The folder to persist data into.                |
| key  | true | "int" \| "string" \| "float" | The database can only use one type of key at a time.  You cannot change the key after the database has been created. |
| cache | false | bool                       | If enabled, data will be loaded to/from js memory in addition to being saved to disk, allowing MUCH faster reads at the cost of having the entire database in memory.             |
| autoFlush | false | bool\|number | The database automatically flushes the log and memtable to SSTables once the log/memtable reaches 2MB or greater in size.  Set this to `false` to disable automatic flushes/compaction entirely.  Set this to a number (in MB) to control how large the log/memtable should get before a flush/compaction is performed.



### Properties

#### .version: number
The current version of SnapDB being used.

#### .isCompacting: boolean
This is `true` when the database is performing compaction in the background, `false` otherwise. Compactions are performed in a separate thread so should only affect write throughput.

#### .isTx: boolean
This is `true` when a transaction is active, `false` otherwise.


### Methods

#### .ready():Promise\<void\>
Call on database initialization to know when the database is ready.

#### .put(key: any, data: string): Promise\<void\>
Puts data into the database at the provided key.

#### .get(key: any):Promise\<string\>
Used to get the value of a single key.

#### .delete(key: any): Promise\<void\>
Deletes a key and it's value from the database.

#### .getAllKeys(onKey: (key: any) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
Gets all the keys in the database, use the callback functions to capture the data.  Can optionally return the keys in reverse.  This is orders of magnitude faster than the `getAll` method.

#### .getAll(onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
Gets all the keys & values in the database, use the callback functions to capture the data. Can optionally return the keys/values in reverse order.

#### .range(lower: any, higher: any, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a range of rows between the provided lower and upper values.  Can optionally return the results in reverse.  

#### .offset(offset: number, limit: number, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a section of rows provided the offset and limit you'd like.  Can optionally return the results in reverse from the bottom of the key list.

#### .getCount(): Promise\<number\>
Gets the total number of records in the database.  This uses a *very fast* lookup method.

#### .empty(): Promise\<void\>
Clears all keys and values from the datastore.  All other query types will fail while the database is being emptied, wait for this to complete before attempting to write new data to the database.

#### .close(): Promise\<void\>
Closes the datastore, clears the keys from memory and kills the worker threads.  This isn't reversible, you have to create a new `SnapDB` instance to get things going again.

#### .flushLog(): Promise\<void\>
Forces the log to be flushed into database files and clears the memtable.  Normally the database waits until the log/memtable is 2MB or larger before flushing them.  Once the log is flushed into disk files a compaction is performed if it's needed.

The log files and database files are both written to disk in a safe, robust manner so this method isn't needed for normal activity or to make writes more reliable.  You *might* use this method to perform compactions at times that are more convinient than waiting for the system to perform the compactions when the log fills up.  Also if you have `autoFlush` off you'll need this method to flush the log/memtable.

#### .begin_transaction(): Promise\<void\>
Start a database transaction.

#### .end_transaction(): Promise\<void\>
End a database transaction, making sure it's been flushed to the filesystem.

#### .on(event: string, callback: (eventData) => void): void
Subscribe to a specific event.

#### .off(event: string, callback: (eventData) => void): void
Unsubscribe from a specific event.

### Supported Events
You can listen for the following events:

| Event          | Trigger Details                                             |
|----------------|-------------------------------------------------------------|
| ready          | After the database is ready to query.                       |
| get            | After a value is retrieved with `.get`.                     |
| put            | After a value is set with `.put`.                           |
| delete         | After a value is deleted with `.delete`.                    |
| get-keys       | For every key when `.getAllKeys` is called.                 |
| get-keys-end   | After the end of a `.getAllKeys` query.                     |
| get-count      | After `.getCount` is query is returned.                     |
| get-all        | For every key value pair returned when `.getAll` is called. |
| get-all-end    | After the end of a `.getAll` query.                         |
| get-offset     | For every key value pair returned when `.offset` is called. |
| get-offset-end | After the end of a `.offset` query.                         |
| get-range      | For every key value pair returned when `.range` is called.  |
| get-range-end  | After the end of a `.range` query.                          |
| tx-start       | After a transaction is started.                             |
| tx-end         | After a transaction completes.                              |
| close          | After the database is closed.                               |
| clear          | After the database is cleared.                              |
| compact-start  | When a compaction is starting.                              |
| compact-end    | After a compaction has completed.                           |

### Tips / Limitations
- Keys and values can technically be almost any size, but try to keep them under 10 megabytes.
- Using transactions will batch writes/deletes together into a single disk seek, use them when you can.
- Transactions cannot be nested.  Make sure you close each transaction before starting a new one.
- Keys are kept in javascript memory for performance, in practice the size of the database you can have with SnapDB will be limited by how much memory nodejs/electron has access to.
- Larger transactions take more memory to compact, if you run out of memory durring a transaction then break it up into smaller chunks.  Transactions in the tens of thousands of puts/deletes should be fine, hundreds of thousands will likely be problematic.
- If you need to store millions of rows or terabytes of data RocksDB/LevelDB is a much better choice.

## How LSM Tree Databases Work
The architecture of SnapDB is heavily borrowed from LevelDB/RocksDB and shares many of their advantages and limitations.

### Writes
When you perform a write the data is loaded into an in memory cache (memtable) and appended to a log file.  Once the data is stored in the log file the write is considered to be commited to the database.  Deletes work much the same, except they write a special "tombstone" record so that we know the record is deleted and to ignore older writes of that same key.

The logfile and memtable always share the same data/state.  When the database is loaded the log file is played back and it's data is saved to the memtable before the database is ready to use.

#### Log Flushing/Compaction
Compactions are only possibly performed following a log flush or when manually triggered. 

Once the logfile/memtable reach a threshold in size (2MB by default) all it's data is flushed to the first of many "Levels" of database files.  Each database file is an immutable SSTable containing a bloom filter, a sorted index, and a data file containing the actual values. Database/Level files are never overwritten, modified or larger than 2MB unless database keys or values are larger than 2MB.  

> A limitation to the size limiter for log/memtable involves transactions.  A single transaction, regardless of it's size, is commited entirley to the log before compaction begins.  This gaurantees that transactions are ACID but limits the transaction size to available memory.

Log flushes involve rewriting all files at Level 0 and merging them with the contents of the memtable.  Once Level 0 contains more than 10MB of data one of the files in Level 0 is selected and it's contents are merged with files in Level 1 that overlap the keys in the selected Level 0 file.  After the merge all data in the selectd Level 0 file is now in Level 1.  

This cycle continues with every subsequent Level, each Level being limited to a maximum of 10^L+1 MB worth of files. (Level 0 = 10MB, Level 1 = 100MB, etc)

Since data is sorted into SSTables for each level, it's easy to discover overlapping keys between Levels after Level 0 and perform compactions that only handle data in the 10s of megabytes, even if the data being stored in the database is orders of magnitude larger.  Additionally compactions will merge redudant key values (only keeping the newest value) and drop tombstones if no older values for a given key exist.

Each compaction normally won't touch more than one Level.  The result ends up being all log/compaction writes and reads are sequential and relatively minor in size.

Once a log flush/comapction completes these actions are performed, in this order:

1. A new manifest file is written describing the new Level files with the expired ones removed.
2. The log file is deleted/emptied.
3. The memtable is emptied. 
4. Expired Level files are deleted.

The order of operations gaurantees that if there is a crash at any point the database remains in a state that can easily be recovered from with no possiblitiy of data loss.  The absolute worst case is a compaction is performed that ends up being discarded and must be done again.

Additionally, individual log writes and database files are stored with checksums to gaurantee file integrity.

### Reads
Reads are performed in this order:
1. If cache is enabled, that's checked first.
2. If the value/tombstone is in the memtable that's returned.
3. The manifest file is checked to discover which Level files contain a key range that include the requested key.  The files are then sorted from newest to oldest.  Each file's bloom filter is checked against the requested key.  If the bloom filter returns a positive result, we attempt to load the data from that Level file.  If the data/tombstone isn't in the Level file we move to progressively older Level files until a result is found.  Finally, if the key isn't found in any files we return an error that the key isn't in the database.

One of the main ways SnapDB is different from LevelDB/RocksDB is the database keys are stored in a sorted red/black tree to make key traversal faster.  This allows fast `.offset` and `.getCount` methods in the API that aren't typically availalbe for LevelDB/RocksDB stores.  The tradeoff is that all keys must fit in javascript memory.

# MIT License

Copyright (c) 2019 Scott Lott

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