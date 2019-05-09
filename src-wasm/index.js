mergeInto(LibraryManager.library, {
    random_int: function () {
        return Math.ceil(Math.random() * 2048);
    },
});