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

SnapDB is a pure javascript persistent key-value store that provides ordered mapping from keys to string values. Data is persisted to disk using an Log Structure Merge Tree (LSM) inspired by LevelDB. You can optionally also save values into memory, significantly increasing read performance.

## Features

- Zero dependencies.
- Zero compiling.
- Zero configuring.
- ACID Compliant with transaction support.
- Constant time range & offset/limit queries.
- Optimized with WebAssembly indexes.
- Typescript & Babel friendly.
- Works in NodeJS and NodeJS like environments like Electron.
- Keys are sorted, allowing *very fast* range queries.
- Data is durable in the face of application or power failure.
- Runs in it's own thread to prevent blocking.

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

The `SnapDB` class accepts up to 3 arguments in the constructor.

### Class Arguments

| Argument | Type                       | Details                                                                                                              |
|----------|----------------------------|----------------------------------------------------------------------------------------------------------------------|
| folderName | string                     | The folder to persist data to.                |
| keyType  | "int" \| "string" \| "float" | The database can only use one type of key at a time.  You cannot change the key after the database has been created. |
| useCache | bool                       | If enabled, data will be loaded to/from js memory in addition to being saved to disk, allowing MUCH faster reads.             |

SnapDB stores all your keys in WebAssembly memory for performance reasons.  This means there's a maximum storage capacity of just under 4GB *for all keys*.

The three `keyType`s correspond to different data types in WebAssembly.  Larger keys give you more flexibility but cost more space and thus further limit the maximum number of keys you can have.

### Key Types

| Type   | Bytes | Range                                | Details                                                                                                                                            |
|--------|-------|--------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| int    | 4     | 0 - 4,294,967,295                    | The smallest and fastest index type.                                                                                                               |
| float  | 8     | 1.7E +/- 308                         | Equivelant to `double` type in C/C++, use this if you need decimal numbers.                                                                                 |
| string | 1+    |  Up to 1 billion characters long | Allows you to use almost any size string as a key, memory usage is the same as the length of the key. |

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
Gets all the keys & values in the database, use the callback functions to capture the data. Can optionally return the keys in reverse order.

#### .range(lower: any, higher: any, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a range of rows between the provided lower and upper values.  Can optionally return the results in reverse.  

#### .offset(offset: number, limit: number, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a section of rows provided the offset and limit you'd like.  Can optionally return the results in reverse from the bottom of the key list.

#### .getCount(): Promise\<number\>
Gets the total number of records in the database.  This uses a *very fast* lookup method.

#### .empty(): Promise\<void\>
Clears all keys and values from the datastore.

#### .close(): Promise\<void\>
Closes the underlying datastore and clears the keys from memory.  This isn't reversible, you have to create a new `SnapDB` instance to get things going again.

#### .begin_transaction(): Promise\<void\>
Start a database transaction.

#### .end_transaction(): Promise\<void\>
End a database transaction, committing it to the database.

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