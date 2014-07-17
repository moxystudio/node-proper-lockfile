'use strict';

var fs = require('fs');
var lockfile = require('../../');

fs.unlinkSync(__dirname + '/../tmp.lock/.uid');
fs.rmdirSync(__dirname + '/../tmp.lock');

lockfile.lock(__dirname + '/../tmp', function (err) {
    if (err) throw err;

    process.exit();
});
