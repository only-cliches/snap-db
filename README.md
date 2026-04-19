# SnapDB
Fast, durable, embedded key-value storage for Node.js and Electron.

Get Level-style APIs, ACID transactions, sorted keys, and LSM-tree persistence without running an external database process.

<p>
  <a href="https://badge.fury.io/js/snap-db">
    <img src="https://badge.fury.io/js/snap-db.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/snap-db">
    <img src="https://img.shields.io/npm/dm/snap-db.svg" alt="npm downloads">
  </a>
</p>

## Why SnapDB
- Embedded and simple: no server process, no setup, no runtime dependencies.
- Durable by design: append-only log + LSM compaction + crash recovery.
- ACID transactions: `startTx` / `endTx` / `abortTx`, plus atomic `batch`.
- Sorted keys for efficient range/offset queries.
- Worker-thread mode by default to avoid blocking your main app thread.
- Supports both ESM and CommonJS.
- Supports `Buffer` values and `Buffer` keys.

## Installation
```bash
npm i snap-db
```

## Module Usage
```ts
// ESM
import { SnapDB } from "snap-db";
```

```js
// CommonJS
const { SnapDB } = require("snap-db");
```

## Quick Start
```ts
import { SnapDB } from "snap-db";

const db = new SnapDB({
  dir: "./my-db",
  key: "string"
});

await db.ready();

await db.put("user:1", "Alice");
console.log(await db.get("user:1")); // "Alice"

await db.close();
```

## Buffer Support
SnapDB supports Buffer data and keys.

### Buffer values
```ts
const db = new SnapDB({ dir: "./bin-db", key: "string" });
await db.ready();

await db.put("blob:1", Buffer.from([0, 1, 2, 3, 254, 255]));
const value = await db.get("blob:1");
console.log(Buffer.isBuffer(value)); // true
```

### Buffer keys
Use either `key: "buffer"` or `key: "any"`.

```ts
const db = new SnapDB({ dir: "./buf-keys", key: "buffer" });
await db.ready();

const key = Buffer.from([0x00, 0x10, 0x20]);
await db.put(key, "payload");
console.log(await db.get(Buffer.from([0x00, 0x10, 0x20]))); // "payload"
```

## Constructor
```ts
new SnapDB({
  dir: string,
  key?: "string" | "int" | "float" | "any" | "buffer",
  cache?: boolean,
  autoFlush?: boolean | number,
  mainThread?: boolean
})

// shorthand:
new SnapDB(dir: string, keyType?: "string" | "int" | "float" | "any" | "buffer", cache?: boolean)
```

### Options
| Option | Type | Default | Notes |
|---|---|---|---|
| `dir` | `string` | required | Directory used for persistence. |
| `key` | `"string" \| "int" \| "float" \| "any" \| "buffer"` | `"any"` | Key mode for parsing/sorting/serialization. |
| `cache` | `boolean` | `false` | In-memory value cache (faster reads, higher RAM). |
| `autoFlush` | `boolean \| number` | `true` | `false` disables auto flush; number = MB threshold. |
| `mainThread` | `boolean` | `false` | If `true`, DB operations run in-process (faster but blocking). |

### Key-mode behavior
| Mode | Accepted keys |
|---|---|
| `string` | cast to string |
| `int` | cast with `parseInt` |
| `float` | cast with `parseFloat` |
| `buffer` | cast to `Buffer` |
| `any` | `number`, `string`, `Buffer` (other values stringified) |

When using `any`, key sort precedence is: `number` -> `string` -> `Buffer`.

## Core API
All APIs support Promise style; many also support callbacks.

### State / lifecycle
- `ready(callback?) => Promise<void>`
- `isOpen() => boolean`
- `isClosed() => boolean`
- `close(callback?) => Promise<void>`
- `empty(callback?) => Promise<void>`
- `flushLog(callback?) => Promise<void>`

### CRUD
- `put(key, value: string | Buffer, callback?) => Promise<any>`
- `get(key, callback?) => Promise<string | Buffer | undefined>`
- `delete(key, callback?) => Promise<any>`
- `del(key, callback?) => Promise<any>` (alias)
- `exists(key, callback?) => Promise<boolean>`
- `getCount(callback?) => Promise<number>`

### Transactions
- `startTx(callback?) => Promise<number>`
- `endTx(callback?) => Promise<number>`
- `abortTx(callback?) => Promise<number>`
- `begin_transaction() => Promise<any>` (legacy alias)
- `end_transaction() => Promise<any>` (legacy alias)

### Batch
- `batch(ops, callback?) => Promise<void>`
- `batch().put(...).del(...).write(callback?)`

`batch(ops)` executes atomically by wrapping operations in a transaction.

## Query API
### Callback queries
- `query(args, onRecord, onComplete)`
- `getAll(onRecord, onComplete, reverse?)`
- `getAllKeys(onRecord, onComplete, reverse?)`
- `range(lower, higher, onRecord, onComplete, reverse?)`
- `offset(offset, limit, onRecord, onComplete, reverse?)`

### Async iterable queries
- `queryIt(args)`
- `getAllIt(reverse?)`
- `getAllKeysIt(reverse?)`
- `rangeIt(lower, higher, reverse?)`
- `offsetIt(offset, limit, reverse?)`

### Stream queries
- `queryStream(args)`
- `getAllStream(reverse?)`
- `getAllKeysStream(reverse?)`
- `rangeStream(lower, higher, reverse?)`
- `offsetStream(offset, limit, reverse?)`
- `createReadStream(args)` (Level-style)
- `createKeyStream(args)` (Level-style)
- `createValueStream(args)` (Level-style)

### QueryArgs
```ts
type QueryArgs<K> = {
  gt?: K;
  gte?: K;
  lt?: K;
  lte?: K;
  offset?: number;
  limit?: number;
  keys?: boolean;
  values?: boolean;
  reverse?: boolean;
}
```

Notes:
- `offset` mode should not be mixed with `gt/gte/lt/lte`.
- `range(lower, higher)` uses lower-inclusive / upper-exclusive behavior in forward mode.
- `values: false` avoids loading values and can be significantly faster.

## Events
```ts
db.on("compact-start", (ev) => {});
db.on("compact-end", (ev) => {});
db.off("compact-start", handler);
```

Supported event names:
- `ready`
- `get`
- `put`
- `delete`
- `get-keys`
- `get-keys-end`
- `get-count`
- `get-query`
- `get-query-end`
- `get-all`
- `get-all-end`
- `get-offset`
- `get-offset-end`
- `get-range`
- `get-range-end`
- `read-stream`
- `read-stream-end`
- `read-key-stream`
- `read-key-stream-end`
- `read-value-stream`
- `read-value-stream-end`
- `tx-start`
- `tx-end`
- `tx-abort`
- `close`
- `clear`
- `compact-start`
- `compact-end`

## Level-style Compatibility
SnapDB provides Level-style APIs (`batch`, streams, range/query patterns) while also adding transaction controls (`startTx/endTx/abortTx`), worker-mode operation, and manual compaction control (`flushLog`).

## Operational Guidance
- For highest throughput and least app blocking, keep `mainThread: false` (default).
- For lower latency and no worker serialization overhead, use `mainThread: true` in controlled environments.
- If you disable `autoFlush`, call `flushLog()` periodically.
- `cache: true` can improve read latency for hot datasets but increases memory usage.

## Development
```bash
npm run build
npm test
```

## Links
- Repo: https://github.com/only-cliches/snap-db
- Issues: https://github.com/only-cliches/snap-db/issues
- npm: https://www.npmjs.com/package/snap-db
