# [1.1.6] 09-24-2019
- Readme tweaks.
- Fixed issue with log loading.
- Added additional tests for log loading.
- GET performance improvements.
- Minor refactoring.

# [1.1.5] 08-16-2019
- Readme tweaks.
- Added `exists` method.
- Added `any` key type support.

# [1.1.3] 08-16-2019
- Resolved issue [#8](https://github.com/ClickSimply/snap-db/issues/8), `ready` is called right away if the database is already ready.
- Resolved issue [#10](https://github.com/ClickSimply/snap-db/issues/10), `close` does not do a promise reject on subsequent calls.
- Merged PR [#11](https://github.com/ClickSimply/snap-db/pull/11), added travis CI support to project.
- Conditionally removed `Buffer()` calls to suppress warnings in new nodeJS versions.
- Added Travis CI badge to README.

# [1.1.2] 08-14-2019
- Resolved issue [#2](https://github.com/ClickSimply/snap-db/issues/2), `.ready` no longer needs to be called to start using the database.
- Resolved issue [#1](https://github.com/ClickSimply/snap-db/issues/1), added async iterable versions of all looping functions.
- Resolved issue [#3](https://github.com/ClickSimply/snap-db/issues/3), keys that don't exist will now return undefined on `get` queries.
- Resolved issue [#5](https://github.com/ClickSimply/snap-db/issues/5), node will always exit after the database is closed.
- Cleaned up API to make it more consistent.  Old methods are kept around to prevent breaking changes.
- Major refactoring.
- Improved documentation and code comments.
- Added stream api.
- Added LevelDB methods to make SnapDB API compatible with LevelDB/RocksDB.

# [1.1.1] 07-17-2019
- **BREAKING CHANGE** Removed old WASM code entirely.  If you're migrating from SQLite based install you'll have to install an older version first to migrate.
- Compaction will now loop until all levels are within the desired limits.
- More complete handling of different states of manifest.json files.
- Added optional single threaded mode for improved performance at the cost of blocking behavior.

# [1.1.0] 06-24-2019
- Compaction now takes significantly less memory.
- Fixed a few issues with level 0 compaction.
- Memtable now references logfile for reads, reducing memory cost of transactions significantly.
- Logfile is no longer loaded entirely into memory on database open, reducing memory usage significantly.

# [1.0.9] 06-24-2019
- Fixed issue with manifest delete.
- Fixed issue with opening existing databases.
- Fixed issue with log restoring.
- Fixed issue with memtable updating.

# [1.0.8] 06-21-2019
- Readme tweaks.
- Added backwards compatibility for breaking change in `1.0.7`.

# [1.0.7] 06-19-2019
- *BREAKING CHANGE* the arguments for the class is now an object.
- Small performance optimizations.
- Fixed key type casting in compaction function.
- Added `flushLog` method.
- Added ability to control the databse flushing.

# [1.0.6] 06-17-2019
- Removed Webassembly requirement, keyspace is now limited to javascript memory.
- Fixed a bug with compaction.
- Fixed a bug with offset/limit.

# [1.0.5] 06-17-2019
- Readme typo fix.
- A few code adjustments.
- Added intelligent tombstone purging.

# [1.0.4] 06-17-2019
- Resolved issue with SnapDB not working on Windows hosts.
- Replaced SQLite with custom javascript LSM database.
- Added an automated migration script to move SQLite databases into new LSM backend.
- Added event system.

# [1.0.3] 05-21-2019
- Fixed issue with zero length indexes.

# [1.0.2] 05-16-2019
- Fixed offset/limit bug.
- Fixed possibly undefined object bug.

# [1.0.1] 05-16-2019
- Added changes to handle blank value keys like `""` and `0`.

# [1.0.0] 05-15-2019
- Moved query code to worker thread.
- All APIs are now ASYNC.
- Added SQLite Error Handling.
- Added transaction API.
- Added empty and close API.
- Only bugfixes planned from here on out.
- Added typings to package.json

# [0.0.4] 05-14-2019
- Switched to SQLite storage backend.
- Added tests.
- WASM is now in one file.

# [0.0.3] 5-9-2019
- Reduced memory footprint in WebAssembly.
- Added key data storage to javascript for faster access.
- Fixed issue with string keys not loading from memory correctly.
- Various performance improvements.
- Added integration tests and comments.

# [0.0.2] 5-8-2019
- Adjusted data types in C++ to take up less memory.

# [0.0.1] 5-8-2019
- Initial Release