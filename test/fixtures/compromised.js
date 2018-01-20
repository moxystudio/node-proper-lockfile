'use strict';

const fs = require('fs');
const lockfile = require('../..');

const tmpDir = `${__dirname}/../tmp`;

fs.writeFileSync(`${tmpDir}/foo`, '');

lockfile.lockSync(`${tmpDir}/foo`, { update: 1000 });

fs.rmdirSync(`${tmpDir}/foo.lock`);

// Do not let the process exit
setInterval(() => {}, 1000);

process.on('uncaughtException', (err) => {
    err.code && process.stderr.write(`${err.code}\n\n`);
    throw err;
});
