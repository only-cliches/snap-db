# Snap-DB
Simple Javascript/Webassembly key-value store

Get a running database in a snap!

SnapDB is a persistent key-value store that provides ordered mapping from keys to string values.  You can optionally also save values into memory, significantly increasing read performance.

## Features

- Zero dependencies.
- Zero compiling.
- Zero configuring.
- On-disk database stored in a single file.
- Constant time range & offset/limit queries.
- Optimized with WebAssembly indexes.
- Typescript & Babel friendly.
- Works in NodeJS or NodeJS like environments.
- Keys are sorted, allowing *very fast* range queries.
- Data is durable in the face of application or power failure.

## Installation

```
npm i snap-db --save
```

## Usage

```ts
import { SnapDB } from "snap-db";

const db = new SnapDB(
    "my_db", // database filename
    "int", // key type, can be "int", "string" or "float"
    false // enable or disable database value cache
);

// wait for db to be ready
db.ready().then(() => {
    // put a record
    db.put(20, "hello");
    // get a record
    console.log(db.get(20)); // "hello"
})
```

## API

The `SnapDB` class accepts up to 3 arguments in the constructor.

> **IMPORTANT** SnapDB stores all your keys in WebAssembly memory for performance reasons.  This means there's a maximum storage capacity of just under 4GB *for all keys*.

### Class Arguments

| Argument | Type                       | Details                                                                                                              |
|----------|----------------------------|----------------------------------------------------------------------------------------------------------------------|
| fileName | string                     | The file to persist data to.                                                     |
| keyType  | "int" \| "string" \| "float" | The database can only use one type of key at a time.  You cannot change the key after the database has been created. |
| useCache | bool                       | If enabled, data will be loaded to/from js memory in addition to being saved to disk, allowing MUCH faster reads.             |

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


#### .put(key: any, data: string):number
Puts data into the database at the provided key.

#### .get(key: any):string
Used to get the value of a single key.

#### .delete(key: any):number
Deletes a key and it's value from the database.

#### .getAllKeys(onKey: (key: any) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
Gets all the keys in the database, use the callback functions to capture the data.  Can optionally return the keys in reverse.

#### .getAll(onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean): void;
Gets all the keys & values in the database, use the callback functions to capture the data. Can optionally return the keys in reverse order.

#### .getCount(): number
Gets the total number of records in the database.  This uses a *very fast* lookup method.

#### .range(lower: any, higher: any, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a range of rows between the provided lower and upper values.  Can optionally return the results in reverse.  

#### .offset(offset: number, limit: number, onData: (key: any, data: string) => void, onComplete: (err?: any) => void, reverse?: boolean)
Gets a section of rows provided the offset and limit you'd like.  Can optionally return the results in reverse from the bottom of the key list.

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