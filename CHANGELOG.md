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