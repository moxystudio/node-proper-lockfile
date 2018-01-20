'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterEach(async () => {
    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

it('should release the lock', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const release = await lockfile.lock(`${tmpDir}/foo`);

    await release();

    await lockfile.lock(`${tmpDir}/foo`);
});

it('should remove the lockfile', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const release = await lockfile.lock(`${tmpDir}/foo`);

    await release();

    expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
});

it('should fail when releasing twice', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(1);

    const release = await lockfile.lock(`${tmpDir}/foo`);

    await release();

    try {
        await release();
    } catch (err) {
        expect(err.code).toBe('ERELEASED');
    }
});
