'use strict';

const { getLocks } = require('../../lib/lockfile');
const { unlock } = require('../..');

function unlockAll() {
    const locks = getLocks();
    const promises = Object.keys(locks).map((file) => unlock(file, { realpath: false }));

    return Promise.all(promises);
}

module.exports = unlockAll;
