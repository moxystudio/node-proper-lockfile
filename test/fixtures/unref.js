'use strict';

const fs = require('fs');
const lockfile = require('../../');

const tmpDir = `${__dirname}/../tmp`;

fs.writeFileSync(`${tmpDir}/foo`, '');

lockfile.lockSync(`${tmpDir}/foo`);
