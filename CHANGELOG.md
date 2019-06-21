# TODO
- Cluster support with support for parallel reads.

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