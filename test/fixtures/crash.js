'use strict';

var fs = require('fs');
var lockfile = require('../../');

fs.rmdirSync(__dirname + '/../tmp.lock');

lockfile.lock(__dirname + '/../tmp', function (err) {
    if (err) {
        process.exit(25);
    }

    throw new Error('crash');
});
