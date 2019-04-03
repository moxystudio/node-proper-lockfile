'use strict';

const fs = require('graceful-fs');
const rimraf = require('rimraf');
const pDelay = require('delay');
const mkdirp = require('mkdirp');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(async () => {
    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

it('should fail if the file does not exist by default', async () => {
    expect.assertions(1);

    try {
        await lockfile.check(`${tmpDir}/some-file-that-will-never-exist`);
    } catch (err) {
        expect(err.code).toBe('ENOENT');
    }
});

it('should not fail if the file does not exist and realpath is false', async () => {
    await lockfile.check(`${tmpDir}/some-file-that-will-never-exist`, { realpath: false });
});

it('should return a promise', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const promise = lockfile.check(`${tmpDir}/foo`);

    expect(typeof promise.then).toBe('function');

    await promise;
});

it('should resolve with true if file is locked', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    await lockfile.lock(`${tmpDir}/foo`);

    const isLocked = await lockfile.check(`${tmpDir}/foo`);

    expect(isLocked).toBe(true);
});

it('should resolve with false if file is not locked', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const isLocked = await lockfile.check(`${tmpDir}/foo`);

    expect(isLocked).toBe(false);
});

it('should use the custom fs', async () => {
    const customFs = {
        ...fs,
        realpath: (path, callback) => callback(new Error('foo')),
    };

    expect.assertions(1);

    try {
        await lockfile.check(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should resolve symlinks by default', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    await lockfile.lock(`${tmpDir}/bar`);

    let isLocked = await lockfile.check(`${tmpDir}/bar`);

    expect(isLocked).toBe(true);

    isLocked = await lockfile.check(`${tmpDir}/foo`);

    expect(isLocked).toBe(true);
});

it('should not resolve symlinks if realpath is false', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    await lockfile.lock(`${tmpDir}/bar`, { realpath: false });

    let isLocked = await lockfile.check(`${tmpDir}/bar`, { realpath: false });

    expect(isLocked).toBe(true);

    isLocked = await lockfile.check(`${tmpDir}/foo`, { realpath: false });

    expect(isLocked).toBe(false);
});

it('should fail if stating the lockfile errors out when verifying staleness', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const mtime = new Date(Date.now() - 60000);
    const customFs = {
        ...fs,
        stat: (path, callback) => callback(new Error('foo')),
    };

    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    expect.assertions(1);

    try {
        await lockfile.check(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should set stale to a minimum of 2000', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);

    expect.assertions(2);

    await pDelay(200);

    let isLocked = await lockfile.check(`${tmpDir}/foo`, { stale: 100 });

    expect(isLocked).toBe(true);

    await pDelay(2000);

    isLocked = await lockfile.check(`${tmpDir}/foo`, { stale: 100 });

    expect(isLocked).toBe(false);
});

it('should set stale to a minimum of 2000 (falsy)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);

    expect.assertions(2);

    await pDelay(200);

    let isLocked = await lockfile.check(`${tmpDir}/foo`, { stale: false });

    expect(isLocked).toBe(true);

    await pDelay(2000);

    isLocked = await lockfile.check(`${tmpDir}/foo`, { stale: false });

    expect(isLocked).toBe(false);
});
