mergeInto(LibraryManager.library, {
    loopcb: function (idx, data, done) {
        if (global.snapDB && global.snapDB.cbs[idx]) {
            global.snapDB.cbs[idx](data, done);
        }
    },
    loopcb_str: function (idx, data, done) {
        if (global.snapDB && global.snapDB.cbs[idx]) {
            global.snapDB.cbs[idx](data, done);
        }
    },
    loopcb_int: function (idx, data, done) {
        if (global.snapDB && global.snapDB.cbs[idx]) {
            global.snapDB.cbs[idx](data, done);
        }
    },
});