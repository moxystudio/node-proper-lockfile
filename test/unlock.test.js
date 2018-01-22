'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const pDelay = require('delay');
const clearTimeouts = require('@segment/clear-timeouts');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

clearTimeouts.install();

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(async () => {
    clearTimeouts();

    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

it('should fail if the lock is not acquired', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(1);

    try {
        await lockfile.unlock(`${tmpDir}/foo`);
    } catch (err) {
        expect(err.code).toBe('ENOTACQUIRED');
    }
});

it('should return a promise', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const promise = lockfile.unlock(`${tmpDir}/foo`);

    expect(typeof promise.then).toBe('function');

    await promise.catch(() => {});
});

it('should release the lock', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    await lockfile.lock(`${tmpDir}/foo`);

    await lockfile.unlock(`${tmpDir}/foo`);

    await lockfile.lock(`${tmpDir}/foo`);
});

it('should remove the lockfile', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    await lockfile.lock(`${tmpDir}/foo`);

    await lockfile.unlock(`${tmpDir}/foo`);

    expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
});

it('should fail if removing the lockfile errors out', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        rmdir: (path, callback) => callback(new Error('foo')),
    };

    expect.assertions(1);

    await lockfile.lock(`${tmpDir}/foo`);

    try {
        await lockfile.unlock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should ignore ENOENT errors when removing the lockfile', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        rmdir: jest.fn((path, callback) => callback(Object.assign(new Error(), { code: 'ENOENT' }))),
    };

    await lockfile.lock(`${tmpDir}/foo`);

    await lockfile.unlock(`${tmpDir}/foo`, { fs: customFs });

    expect(customFs.rmdir).toHaveBeenCalledTimes(1);
});

it('should stop updating the lockfile mtime', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        utimes: jest.fn((path, atime, mtime, callback) => callback()),
    };

    await lockfile.lock(`${tmpDir}/foo`, { update: 2000, fs: customFs });

    await lockfile.unlock(`${tmpDir}/foo`);

    // First update occurs at 2000ms
    await pDelay(2500);

    expect(customFs.utimes).toHaveBeenCalledTimes(0);
}, 10000);

it('should stop updating the lockfile mtime (slow fs)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        utimes: jest.fn((...args) => setTimeout(() => fs.utimes(...args), 2000)),
    };

    await lockfile.lock(`${tmpDir}/foo`, { fs: customFs, update: 2000 });

    await pDelay(3000);

    await lockfile.unlock(`${tmpDir}/foo`);

    await pDelay(3000);

    expect(customFs.utimes).toHaveBeenCalledTimes(1);
}, 10000);

it('should stop updating the lockfile mtime (slow fs + new lock)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        utimes: jest.fn((...args) => setTimeout(() => fs.utimes(...args), 2000)),
    };

    await lockfile.lock(`${tmpDir}/foo`, { fs: customFs, update: 2000 });

    await pDelay(3000);

    await lockfile.unlock(`${tmpDir}/foo`);

    await lockfile.lock(`${tmpDir}/foo`);

    await pDelay(3000);

    expect(customFs.utimes).toHaveBeenCalledTimes(1);
}, 10000);

it('should resolve symlinks by default', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    await lockfile.lock(`${tmpDir}/foo`);

    await lockfile.unlock(`${tmpDir}/bar`);

    expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
});

it('should not resolve symlinks if realpath is false', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    expect.assertions(1);

    await lockfile.lock(`${tmpDir}/foo`);

    try {
        await lockfile.unlock(`${tmpDir}/bar`, { realpath: false });
    } catch (err) {
        expect(err.code).toBe('ENOTACQUIRED');
    }
});

it('should use a custom fs', async () => {
    const customFs = {
        ...fs,
        realpath: (path, callback) => callback(new Error('foo')),
    };

    expect.assertions(1);

    try {
        await lockfile.unlock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});
