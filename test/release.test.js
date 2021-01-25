'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');
const { waitUntil } = require('./util/wait');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

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

it('shouldnt error on releasing compromised lock', async () => {
    const lockPath = `${tmpDir}/foo`;
    const lockDir = `${lockPath}.lock`;
    const stale = 10;
    const onCompromised = jest.fn();

    jest.useFakeTimers();
    fs.writeFileSync(lockPath, '');

    const release = await lockfile.lock(lockPath, { stale, onCompromised });
    const mtime = (new Date().getTime() / 1000) - stale;

    fs.utimesSync(lockDir, mtime, mtime);

    // Advance timers to trigger the updateTimeout so the lock gets compromised
    jest.advanceTimersByTime(stale * 2 * 1000);

    // switch back to use realTimers to wait max 5 seconds as there is no
    // other way to wait for all callbacks from the internal timeout to return
    jest.useRealTimers();
    await waitUntil(() => onCompromised.mock.calls.length, 5, 50);

    expect(onCompromised).toHaveBeenCalledTimes(1);

    await expect(release()).resolves.not.toThrow();
    expect(fs.existsSync(lockDir)).toBe(true);
});

