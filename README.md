# Snap-DB
Simple Javascript/Webassembly key-value store

Get a running database in a snap!

SnapDB is a persistent key-value store that provides ordered mapping from keys to string values.  You can optionally also save values into memory, significantly increasing read performance.

## Features

- Zero dependencies.
- Zero compiling.
- Constant time range & offset/limit queries.
- Optimized with WebAssembly.
- Works in NodeJS or NodeJS like environments.
- Typescript & Babel friendly.
- Keys are sorted, allowing *very fast* range queries.

## Installation

```
npm i snap-db --save
```

## Usage

```ts
import { SnapDB } from "snap-db";

const db = new SnapDB(
    "my_db", // folder to drop the database files into
    "int", // key type, can be "int", "string" or "float"
    false // enable database value cache
);

const runDB = async () => {
    // wait for the database to be ready
    await db.ready();
    // values are always strings
    await db.put(20, "hello");
    // get value from database
    const value = await db.get(20);
}
runDB();
```

## API

The `SnapDB` class accepts up to 3 arguments in the constructor.

> **IMPORTANT** SnapDB stores all your keys in WebAssembly memory for performance reasons.  This means there's a maximum storage capacity of just under 4GB *for all keys*.

### Class Arguments

| Argument | Type                       | Details                                                                                                              |
|----------|----------------------------|----------------------------------------------------------------------------------------------------------------------|
| fileName | string                     | The folder to store the database files in, can be absolute path.                                                     |
| keyType  | "int" \| "string" \| "float" | The database can only use one type of key at a time.  You cannot change the key after the database has been created. |
| useCache | bool                       | If enabled, data will be saved to memory in addition to being saved to disk, allowing MUCH faster reads.             |

The three `keyType`s correspond to different data types in WebAssembly.  Larger keys give you more flexibility but cost more space and thus further limit the maximum number of keys you can have.

### Key Types

| Type   | Bytes | Range                                | Details                                                                                                                                            |
|--------|-------|--------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| int    | 4     | 0 - 4,294,967,295                    | The smallest and fastest index type.                                                                                                               |
| float  | 8     | 1.7E +/- 308                         | Equivelant to `double` type in C/C++, use this if you need decimal numbers.                                                                                 |
| string | 1+    |  Up to 4,294,967,295 characters long | Allows you to use almost any size string as a key, memory usage is the same as the length of the key. |

### Methods

#### .ready():Promise\<void\>
Call on database initialization to know when the database is ready.

#### .get(key: any):Promise\<any\>
Used to get a single key, returns a promise with the value of the key or rejects the promise if no key is found or there was an error getting the value requested.

#### .delete(key: any):Promise\<any\>
Deletes a key from the database, returns succesfull promise if the key is deleted, rejects the promise if no key was found or if there was an error deleting it.

#### .put(key: any, data: string):Promise\<any\>
Puts data into the database at the provided key, returns a successfull promise if the key and value are committed to disk, otherwise rejects the promise with an error.

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