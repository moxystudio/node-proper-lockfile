'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const sleep = require('thread-sleep');
const rimraf = require('rimraf');
const execa = require('execa');
const pDefer = require('p-defer');
const pDelay = require('delay');
const clearTimeouts = require('@segment/clear-timeouts');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

clearTimeouts.install();

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(async () => {
    jest.restoreAllMocks();
    clearTimeouts();

    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

it('should be the default export', () => {
    expect(lockfile).toBe(lockfile.lock);
});

it('should fail if the file does not exist by default', async () => {
    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/some-file-that-will-never-exist`);
    } catch (err) {
        expect(err.code).toBe('ENOENT');
    }
});

it('should not fail if the file does not exist and realpath is false', async () => {
    await lockfile.lock(`${tmpDir}/some-file-that-will-never-exist`, { realpath: false });
});

it('should fail if impossible to create the lockfile because directory does not exist', async () => {
    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/some-dir-that-will-never-exist/foo`);
    } catch (err) {
        expect(err.code).toBe('ENOENT');
    }
});

it('should return a promise for a release function', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const promise = lockfile.lock(`${tmpDir}/foo`);

    expect(typeof promise.then).toBe('function');

    const release = await promise;

    expect(typeof release).toBe('function');
});

it('should create the lockfile', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    await lockfile.lock(`${tmpDir}/foo`);

    expect(fs.existsSync(`${tmpDir}/foo`)).toBe(true);
});

it('should create the lockfile inside a folder', async () => {
    fs.mkdirSync(`${tmpDir}/foo-dir`);

    await lockfile.lock(`${tmpDir}/foo-dir`, { lockfilePath: `${tmpDir}/foo-dir/dir.lock` });

    expect(fs.existsSync(`${tmpDir}/foo-dir/dir.lock`)).toBe(true);
});

it('should fail if already locked', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(1);

    await lockfile.lock(`${tmpDir}/foo`);

    try {
        await lockfile.lock(`${tmpDir}/foo`);
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
    }
});

it('should fail if mkdir fails for an unknown reason', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        mkdir: (path, callback) => callback(new Error('foo')),
    };

    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should retry several times if retries were specified', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const release = await lockfile.lock(`${tmpDir}/foo`);

    setTimeout(release, 4000);

    await lockfile.lock(`${tmpDir}/foo`, { retries: { retries: 5, maxTimeout: 1000 } });
});

it('should use a custom fs', async () => {
    const customFs = {
        ...fs,
        realpath: (path, callback) => callback(new Error('foo')),
    };

    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should resolve symlinks by default', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    expect.assertions(2);

    await lockfile.lock(`${tmpDir}/bar`);

    try {
        await lockfile.lock(`${tmpDir}/bar`);
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
    }

    try {
        await lockfile.lock(`${tmpDir}/foo`);
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
    }
});

it('should not resolve symlinks if realpath is false', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.symlinkSync(`${tmpDir}/foo`, `${tmpDir}/bar`);

    await lockfile.lock(`${tmpDir}/bar`, { realpath: false });
    await lockfile.lock(`${tmpDir}/foo`, { realpath: false });

    expect(fs.existsSync(`${tmpDir}/bar.lock`)).toBe(true);
    expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(true);
});

it('should remove and acquire over stale locks', async () => {
    const mtime = new Date(Date.now() - 60000);

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    await lockfile.lock(`${tmpDir}/foo`);

    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(Date.now() - 3000);
});

it('should remove and acquire locks from the future', async () => {
    const mtime = new Date(Date.now() + 60000);

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    await lockfile.lock(`${tmpDir}/foo`);

    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(Date.now() - 3000);
    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeLessThan(Date.now() + 3000);
});

it('should retry if the lockfile was removed when verifying staleness', async () => {
    const mtime = new Date(Date.now() - 60000);
    let count = 0;
    const customFs = {
        ...fs,
        mkdir: jest.fn((...args) => fs.mkdir(...args)),
        stat: jest.fn((...args) => {
            if (count % 2 === 0) {
                rimraf.sync(`${tmpDir}/foo.lock`);
            }
            fs.stat(...args);
            count += 1;
        }),
    };

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });

    expect(customFs.mkdir).toHaveBeenCalledTimes(2);
    expect(customFs.stat).toHaveBeenCalledTimes(2);
    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(Date.now() - 3000);
});

it('should retry if the lockfile was removed when verifying staleness (not recursively)', async () => {
    const mtime = new Date(Date.now() - 60000);
    const customFs = {
        ...fs,
        mkdir: jest.fn((...args) => fs.mkdir(...args)),
        stat: jest.fn((path, callback) => callback(Object.assign(new Error(), { code: 'ENOENT' }))),
    };

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    expect.assertions(3);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
        expect(customFs.mkdir).toHaveBeenCalledTimes(2);
        expect(customFs.stat).toHaveBeenCalledTimes(1);
    }
});

it('should fail if stating the lockfile errors out when verifying staleness', async () => {
    const mtime = new Date(Date.now() - 60000);
    const customFs = {
        ...fs,
        stat: (path, callback) => callback(new Error('foo')),
    };

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should fail if removing a stale lockfile errors out', async () => {
    const mtime = new Date(Date.now() - 60000);
    const customFs = {
        ...fs,
        rmdir: (path, callback) => callback(new Error('foo')),
    };

    customFs.rmdir = (path, callback) => {
        callback(new Error('foo'));
    };

    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);
    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    expect.assertions(1);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { fs: customFs });
    } catch (err) {
        expect(err.message).toBe('foo');
    }
});

it('should update the lockfile mtime automatically', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    await lockfile.lock(`${tmpDir}/foo`, { update: 1500 });

    expect.assertions(2);

    let mtime = fs.statSync(`${tmpDir}/foo.lock`).mtime;

    // First update occurs at 1500ms
    await pDelay(2000);

    let stat = fs.statSync(`${tmpDir}/foo.lock`);

    expect(stat.mtime.getTime()).toBeGreaterThan(mtime.getTime());
    mtime = stat.mtime;

    // Second update occurs at 3000ms
    await pDelay(2000);

    stat = fs.statSync(`${tmpDir}/foo.lock`);

    expect(stat.mtime.getTime()).toBeGreaterThan(mtime.getTime());
});

it('should set stale to a minimum of 2000', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);

    expect.assertions(1);

    await pDelay(200);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { stale: 100 });
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
    }

    await pDelay(2000);

    await lockfile.lock(`${tmpDir}/foo`, { stale: 100 });
});

it('should set stale to a minimum of 2000 (falsy)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    fs.mkdirSync(`${tmpDir}/foo.lock`);

    expect.assertions(1);

    await pDelay(200);

    try {
        await lockfile.lock(`${tmpDir}/foo`, { stale: false });
    } catch (err) {
        expect(err.code).toBe('ELOCKED');
    }

    await pDelay(2000);

    await lockfile.lock(`${tmpDir}/foo`, { stale: false });
});

it('should call the compromised function if ENOENT was detected when updating the lockfile mtime', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const deferred = pDefer();

    const handleCompromised = async (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(err.message).toMatch('ENOENT');

        await lockfile.lock(`${tmpDir}/foo`);

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, { update: 1000, onCompromised: handleCompromised });

    // Remove the file to trigger onCompromised
    rimraf.sync(`${tmpDir}/foo.lock`);

    await deferred.promise;
});

it('should call the compromised function if failed to update the lockfile mtime too many times (stat)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = { ...fs };

    const deferred = pDefer();

    const handleCompromised = (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(err.message).toMatch('foo');

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
        stale: 5000,
        onCompromised: handleCompromised,
    });

    customFs.stat = (path, callback) => callback(new Error('foo'));

    await deferred.promise;
}, 10000);

it('should call the compromised function if failed to update the lockfile mtime too many times (utimes)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = { ...fs };

    const deferred = pDefer();

    const handleCompromised = (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(err.message).toMatch('foo');

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
        stale: 5000,
        onCompromised: handleCompromised,
    });

    customFs.utimes = (path, atime, mtime, callback) => callback(new Error('foo'));

    await deferred.promise;
}, 10000);

it('should call the compromised function if updating the lockfile took too much time', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = { ...fs };

    const deferred = pDefer();

    const handleCompromised = (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(err.message).toMatch('foo');

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
        stale: 5000,
        onCompromised: handleCompromised,
    });

    customFs.utimes = (path, atime, mtime, callback) => setTimeout(() => callback(new Error('foo')), 6000);

    await deferred.promise;
}, 10000);

it('should call the compromised function if lock was acquired by someone else due to staleness', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = { ...fs };

    const deferred = pDefer();

    const handleCompromised = (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(true);

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
        stale: 3000,
        onCompromised: handleCompromised,
    });

    customFs.utimes = (path, atime, mtime, callback) => setTimeout(() => callback(new Error('foo')), 6000);

    await pDelay(4500);

    await lockfile.lock(`${tmpDir}/foo`, { stale: 3000 });

    await deferred.promise;
}, 10000);

it('should throw an error by default when the lock is compromised', async () => {
    const { stderr } = await execa('node', [`${__dirname}/fixtures/compromised.js`], { reject: false });

    expect(stderr).toMatch('ECOMPROMISED');
});

it('should set update to a minimum of 1000', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(2);

    await lockfile.lock(`${tmpDir}/foo`, { update: 100 });

    const mtime = fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime();

    await pDelay(200);

    expect(mtime).toBe(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime());

    await pDelay(1000);

    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(mtime);
}, 10000);

it('should set update to a minimum of 1000 (falsy)', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(2);

    await lockfile.lock(`${tmpDir}/foo`, { update: false });

    const mtime = fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime();

    await pDelay(200);

    expect(mtime).toBe(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime());

    await pDelay(1000);

    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(mtime);
}, 10000);

it('should set update to a maximum of stale / 2', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    expect.assertions(2);

    await lockfile.lock(`${tmpDir}/foo`, { update: 6000, stale: 5000 });

    const mtime = fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime();

    await pDelay(2000);

    expect(mtime).toBe(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime());

    await pDelay(1000);

    expect(fs.statSync(`${tmpDir}/foo.lock`).mtime.getTime()).toBeGreaterThan(mtime);
}, 10000);

it('should not fail to update mtime when we are over the threshold but mtime is ours', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');
    await lockfile.lock(`${tmpDir}/foo`, { update: 1000, stale: 2000 });
    sleep(3000);
    await pDelay(5000);
}, 16000);

it('should call the compromised function when we are over the threshold and mtime is not ours', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const deferred = pDefer();

    const handleCompromised = (err) => {
        expect(err.code).toBe('ECOMPROMISED');
        expect(err.message).toMatch('Unable to update lock within the stale threshold');

        deferred.resolve();
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        update: 1000,
        stale: 2000,
        onCompromised: handleCompromised,
    });

    const mtime = new Date(Date.now() - 60000);

    fs.utimesSync(`${tmpDir}/foo.lock`, mtime, mtime);

    sleep(3000);

    await deferred.promise;
}, 16000);

it('should allow millisecond precision mtime', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        stat(path, cb) {
            fs.stat(path, (err, stat) => {
                if (err) {
                    return cb(err);
                }

                stat.mtime = new Date((Math.floor(stat.mtime.getTime() / 1000) * 1000) + 123);
                cb(null, stat);
            });
        },
    };

    const dateNow = Date.now;

    jest.spyOn(Date, 'now').mockImplementation(() => (Math.floor(dateNow() / 1000) * 1000) + 123);

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
    });

    await pDelay(3000);
});

it('should allow floor\'ed second precision mtime', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        stat(path, cb) {
            fs.stat(path, (err, stat) => {
                if (err) {
                    return cb(err);
                }

                // Make second precision if not already
                stat.mtime = new Date(Math.floor(stat.mtime.getTime() / 1000) * 1000);
                cb(null, stat);
            });
        },
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
    });

    await pDelay(3000);
});

it('should allow ceil\'ed second precision mtime', async () => {
    fs.writeFileSync(`${tmpDir}/foo`, '');

    const customFs = {
        ...fs,
        stat(path, cb) {
            fs.stat(path, (err, stat) => {
                if (err) {
                    return cb(err);
                }

                // Make second precision if not already
                stat.mtime = new Date(Math.ceil(stat.mtime.getTime() / 1000) * 1000);
                cb(null, stat);
            });
        },
    };

    await lockfile.lock(`${tmpDir}/foo`, {
        fs: customFs,
        update: 1000,
    });

    await pDelay(3000);
});
