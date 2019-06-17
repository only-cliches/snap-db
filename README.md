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

const db = new SnapDB(
    "my_db", // database folder
    "int", // key type, can be "int", "string" or "float"
    false // enable or disable value cache
);

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

The `SnapDB` class accepts 3 arguments in the constructor.

### Class Arguments

| Argument | Type                       | Details                                                                                                              |
|----------|----------------------------|----------------------------------------------------------------------------------------------------------------------|
| folderName | string                     | The folder to persist data into.                |
| keyType  | "int" \| "string" \| "float" | The database can only use one type of key at a time.  You cannot change the key after the database has been created. |
| useCache | bool                       | If enabled, data will be loaded to/from js memory in addition to being saved to disk, allowing MUCH faster reads.             |



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
- Larger transactions take more memory to compact, if you run out of memory durring a transaction then break it up into smaller chunks.  Transactions in the tens of thousands should be fine, hundreds of thousands will likely be problematic.

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