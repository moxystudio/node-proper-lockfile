'use strict';

const fs = require('graceful-fs');
const path = require('path');
const cp = require('child_process');
const expect = require('expect.js');
const rimraf = require('rimraf');
const spawn = require('buffered-spawn');
const async = require('async');
const lockfile = require('../');

const lockfileContents = fs.readFileSync(`${__dirname}/../index.js`).toString();
const tmpFileRealPath = path.join(__dirname, 'tmp');
const tmpFile = path.relative(process.cwd(), tmpFileRealPath);
const tmpFileLock = `${tmpFileRealPath}.lock`;
const tmpFileSymlinkRealPath = `${tmpFileRealPath}_symlink`;
const tmpFileSymlink = `${tmpFile}_symlink`;
const tmpFileSymlinkLock = `${tmpFileSymlinkRealPath}.lock`;
const tmpNonExistentFile = path.join(__dirname, 'nonexistentfile');

function clearLocks(callback) {
    const toUnlock = [];

    toUnlock.push((callback) => {
        lockfile.unlock(tmpFile, { realpath: false }, (err) => {
            callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
        });
    });

    toUnlock.push((callback) => {
        lockfile.unlock(tmpNonExistentFile, { realpath: false }, (err) => {
            callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
        });
    });

    toUnlock.push((callback) => {
        lockfile.unlock(tmpFileSymlink, { realpath: false }, (err) => {
            callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
        });
    });

    if (fs.existsSync(tmpFileSymlink)) {
        toUnlock.push((callback) => {
            lockfile.unlock(tmpFileSymlink, (err) => {
                callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
            });
        });
    }

    async.parallel(toUnlock, (err) => {
        if (err) {
            return callback(err);
        }

        rimraf.sync(tmpFile);
        rimraf.sync(tmpFileLock);
        rimraf.sync(tmpFileSymlink);
        rimraf.sync(tmpFileSymlinkLock);

        callback();
    });
}

describe('.lock()', () => {
    beforeEach(() => {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    it('should fail if the file does not exist by default', (next) => {
        lockfile.lock(tmpNonExistentFile, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        });
    });

    it('should not fail if the file does not exist and realpath is false', (next) => {
        lockfile.lock(tmpNonExistentFile, { realpath: false }, (err) => {
            expect(err).to.not.be.ok();

            next();
        });
    });

    it('should fail if impossible to create the lockfile', (next) => {
        lockfile.lock('nonexistentdir/nonexistentfile', { realpath: false }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        });
    });

    it('should create the lockfile', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        });
    });

    it('should fail if already locked', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
                expect(err.file).to.be(tmpFileRealPath);

                next();
            });
        });
    });

    it('should retry several times if retries were specified', (next) => {
        lockfile.lock(tmpFile, (err, unlock) => {
            expect(err).to.not.be.ok();

            setTimeout(unlock, 4000);

            lockfile.lock(tmpFile, { retries: { retries: 5, maxTimeout: 1000 } }, (err) => {
                expect(err).to.not.be.ok();

                next();
            });
        });
    });

    it('should use the custom fs', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should resolve symlinks by default', (next) => {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, (err) => {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');

                lockfile.lock(`${tmpFile}/../../test/tmp`, (err) => {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ELOCKED');

                    next();
                });
            });
        });
    });

    it('should not resolve symlinks if realpath is false', (next) => {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, { realpath: false }, (err) => {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, { realpath: false }, (err) => {
                expect(err).to.not.be.ok();

                lockfile.lock(`${tmpFile}/../../test/tmp`, { realpath: false }, (err) => {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ELOCKED');

                    next();
                });
            });
        });
    });

    it('should remove and acquire over stale locks', (next) => {
        const mtime = (Date.now() - 60000) / 1000;

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        });
    });

    it('should retry if the lockfile was removed when verifying staleness', (next) => {
        const mtime = (Date.now() - 60000) / 1000;
        const customFs = Object.assign({}, fs);

        customFs.stat = function (path, callback) {
            rimraf.sync(tmpFileLock);
            fs.stat(path, callback);
            customFs.stat = fs.stat;
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        });
    });

    it('should retry if the lockfile was removed when verifying staleness (not recursively)', (next) => {
        const mtime = (Date.now() - 60000) / 1000;
        const customFs = Object.assign({}, fs);

        customFs.stat = function (path, callback) {
            const err = new Error();

            err.code = 'ENOENT';

            return callback(err);
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ELOCKED');

            next();
        });
    });

    it('should fail if stating the lockfile errors out when verifying staleness', (next) => {
        const mtime = (Date.now() - 60000) / 1000;
        const customFs = Object.assign({}, fs);

        customFs.stat = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should fail if removing a stale lockfile errors out', (next) => {
        const mtime = (Date.now() - 60000) / 1000;
        const customFs = Object.assign({}, fs);

        customFs.rmdir = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should update the lockfile mtime automatically', (next) => {
        lockfile.lock(tmpFile, { update: 1000 }, (err) => {
            expect(err).to.not.be.ok();

            let mtime = fs.statSync(tmpFileLock).mtime;

            // First update occurs at 1000ms
            setTimeout(() => {
                const stat = fs.statSync(tmpFileLock);

                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;
            }, 1500);

            // Second update occurs at 2000ms
            setTimeout(() => {
                const stat = fs.statSync(tmpFileLock);

                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;

                next();
            }, 2500);
        });
    });

    it('should set stale to a minimum of 2000', (next) => {
        fs.mkdirSync(tmpFileLock);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: 100 }, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: 100 }, (err) => {
                expect(err).to.not.be.ok();

                next();
            });
        }, 2200);
    });

    it('should set stale to a minimum of 2000 (falsy)', (next) => {
        fs.mkdirSync(tmpFileLock);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: false }, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: false }, (err) => {
                expect(err).to.not.be.ok();

                next();
            });
        }, 2200);
    });

    it('should call the compromised function if ENOENT was detected when updating the lockfile mtime', (next) => {
        lockfile.lock(tmpFile, { update: 1000 }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ECOMPROMISED');
            expect(err.message).to.contain('ENOENT');

            lockfile.lock(tmpFile, (err) => {
                expect(err).to.not.be.ok();

                next();
            }, next);
        }, (err) => {
            expect(err).to.not.be.ok();

            rimraf.sync(tmpFileLock);
        });
    });

    it('should call the compromised function if failed to update the lockfile mtime too many times', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.contain('foo');
            expect(err.code).to.be('ECOMPROMISED');

            next();
        }, (err) => {
            expect(err).to.not.be.ok();
        });
    });

    it('should call the compromised function if updating the lockfile took too much time', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(() => {
                callback(new Error('foo'));
            }, 6000);
        };

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ECOMPROMISED');
            expect(err.message).to.contain('threshold');
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        }, (err) => {
            expect(err).to.not.be.ok();
        });
    });

    it('should call the compromised function if lock was acquired by someone else due to staleness', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(() => {
                callback(new Error('foo'));
            }, 6000);
        };

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ECOMPROMISED');
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        }, (err) => {
            expect(err).to.not.be.ok();

            setTimeout(() => {
                lockfile.lock(tmpFile, { stale: 5000 }, (err) => {
                    expect(err).to.not.be.ok();
                });
            }, 5500);
        });
    });

    it('should throw an error by default when the lock is compromised', (next) => {
        const originalException = process.listeners('uncaughtException').pop();

        process.removeListener('uncaughtException', originalException);

        process.once('uncaughtException', (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ECOMPROMISED');

            process.nextTick(() => {
                process.on('uncaughtException', originalException);
                next();
            });
        });

        lockfile.lock(tmpFile, { update: 1000 }, (err) => {
            expect(err).to.not.be.ok();

            rimraf.sync(tmpFileLock);
        });
    });

    it('should set update to a minimum of 1000', (next) => {
        lockfile.lock(tmpFile, { update: 100 }, (err) => {
            const mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(() => {
                expect(mtime).to.equal(fs.statSync(tmpFileLock).mtime.getTime());
            }, 200);

            setTimeout(() => {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 1200);
        });
    });

    it('should set update to a minimum of 1000 (falsy)', (next) => {
        lockfile.lock(tmpFile, { update: false }, (err) => {
            const mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(() => {
                expect(mtime).to.equal(fs.statSync(tmpFileLock).mtime.getTime());
            }, 200);

            setTimeout(() => {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 1200);
        });
    });

    it('should set update to a maximum of stale / 2', (next) => {
        lockfile.lock(tmpFile, { update: 6000, stale: 5000 }, (err) => {
            const mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(() => {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.equal(mtime);
            }, 2000);

            setTimeout(() => {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 3000);
        });
    });
});

describe('.unlock()', () => {
    beforeEach(() => {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    it('should fail if the lock is not acquired', (next) => {
        lockfile.unlock(tmpFile, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOTACQUIRED');

            next();
        });
    });

    it('should release the lock', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, (err) => {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile, (err) => {
                    expect(err).to.not.be.ok();

                    next();
                });
            });
        });
    });

    it('should release the lock (without callback)', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile);

            setTimeout(() => {
                lockfile.lock(tmpFile, (err) => {
                    expect(err).to.not.be.ok();

                    next();
                });
            }, 2000);
        });
    });

    it('should remove the lockfile', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            lockfile.unlock(tmpFile, (err) => {
                expect(err).to.not.be.ok();
                expect(fs.existsSync(tmpFileLock)).to.be(false);

                next();
            });
        });
    });

    it('should fail if removing the lockfile errors out', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.rmdir = function (path, callback) {
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, (err) => {
                expect(err).to.be.an(Error);
                expect(err.message).to.be('foo');

                next();
            });
        });
    });

    it('should ignore ENOENT errors when removing the lockfile', (next) => {
        const customFs = Object.assign({}, fs);
        let called;

        customFs.rmdir = function (path, callback) {
            called = true;
            rimraf.sync(path);
            fs.rmdir(path, callback);
        };

        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, (err) => {
                expect(err).to.not.be.ok();
                expect(called).to.be(true);

                next();
            });
        });
    });

    it('should stop updating the lockfile mtime', (next) => {
        lockfile.lock(tmpFile, { update: 2000 }, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, (err) => {
                expect(err).to.not.be.ok();

                // First update occurs at 2000ms
                setTimeout(next, 2500);
            });
        });
    });

    it('should stop updating the lockfile mtime (slow fs)', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        lockfile.lock(tmpFile, { fs: customFs, update: 2000 }, (err) => {
            expect(err).to.not.be.ok();

            setTimeout(() => {
                lockfile.unlock(tmpFile, (err) => {
                    expect(err).to.not.be.ok();
                });
            }, 3000);

            setTimeout(next, 6000);
        });
    });

    it('should stop updating the lockfile mtime (slow fs + new lock)', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        lockfile.lock(tmpFile, { fs: customFs, update: 2000 }, (err) => {
            expect(err).to.not.be.ok();

            setTimeout(() => {
                lockfile.unlock(tmpFile, (err) => {
                    expect(err).to.not.be.ok();

                    lockfile.lock(tmpFile, (err) => {
                        expect(err).to.not.be.ok();
                    });
                });
            }, 3000);

            setTimeout(next, 6000);
        });
    });

    it('should resolve to a canonical path', (next) => {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, (err) => {
                expect(err).to.not.be.ok();
                expect(fs.existsSync(tmpFileLock)).to.be(false);

                next();
            });
        });
    });

    it('should use the custom fs', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.unlock(tmpFile, { fs: customFs }, (err) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });
});

describe('.check()', () => {
    beforeEach(() => {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    it('should fail if the file does not exist by default', (next) => {
        lockfile.check(tmpNonExistentFile, (err) => {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        });
    });

    it('should not fail if the file does not exist and realpath is false', (next) => {
        lockfile.check(tmpNonExistentFile, { realpath: false }, (err) => {
            expect(err).to.not.be.ok();

            next();
        });
    });

    it('should callback with true if file is locked', (next) => {
        lockfile.lock(tmpFile, (err) => {
            expect(err).to.not.be.ok();

            lockfile.check(tmpFile, (err, locked) => {
                expect(err).to.not.be.ok();
                expect(locked).to.be(true);
                next();
            });
        });
    });

    it('should callback with false if file is not locked', (next) => {
        lockfile.check(tmpFile, (err, locked) => {
            expect(err).to.not.be.ok();
            expect(locked).to.be(false);
            next();
        });
    });

    it('should use the custom fs', (next) => {
        const customFs = Object.assign({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.check(tmpFile, { fs: customFs }, (err, locked) => {
            expect(err).to.be.an(Error);
            expect(locked).to.be(undefined);

            next();
        });
    });

    it('should resolve symlinks by default', (next) => {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, (err) => {
            expect(err).to.not.be.ok();

            lockfile.check(tmpFile, (err, locked) => {
                expect(err).to.not.be.ok();
                expect(locked).to.be(true);

                lockfile.check(`${tmpFile}/../../test/tmp`, (err, locked) => {
                    expect(err).to.not.be.ok();
                    expect(locked).to.be(true);
                    next();
                });
            });
        });
    });

    it('should not resolve symlinks if realpath is false', (next) => {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, { realpath: false }, (err) => {
            expect(err).to.not.be.ok();

            lockfile.check(tmpFile, { realpath: false }, (err, locked) => {
                expect(err).to.not.be.ok();
                expect(locked).to.be(false);

                lockfile.check(`${tmpFile}/../../test/tmp`, { realpath: false }, (err, locked) => {
                    expect(err).to.not.be.ok();
                    expect(locked).to.be(false);

                    next();
                });
            });
        });
    });

    it('should fail if stating the lockfile errors out when verifying staleness', (next) => {
        const mtime = (Date.now() - 60000) / 1000;
        const customFs = Object.assign({}, fs);

        customFs.stat = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.check(tmpFile, { fs: customFs }, (err, locked) => {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');
            expect(locked).to.be(undefined);

            next();
        });
    });

    it('should set stale to a minimum of 2000', (next) => {
        fs.mkdirSync(tmpFileLock);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: 2000 }, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(() => {
            lockfile.check(tmpFile, { stale: 100 }, (err, locked) => {
                expect(err).to.not.be.ok();
                expect(locked).to.equal(false);

                next();
            });
        }, 2200);
    });

    it('should set stale to a minimum of 2000 (falsy)', (next) => {
        fs.mkdirSync(tmpFileLock);

        setTimeout(() => {
            lockfile.lock(tmpFile, { stale: 2000 }, (err) => {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(() => {
            lockfile.check(tmpFile, { stale: false }, (err, locked) => {
                expect(err).to.not.be.ok();
                expect(locked).to.equal(false);

                next();
            });
        }, 2200);
    });
});

describe('release()', () => {
    beforeEach(() => {
        fs.writeFileSync(tmpFile, '');
    });

    afterEach(clearLocks);

    it('should release the lock after calling the provided release function', (next) => {
        lockfile.lock(tmpFile, (err, release) => {
            expect(err).to.not.be.ok();

            release((err) => {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile, (err) => {
                    expect(err).to.not.be.ok();

                    next();
                });
            });
        });
    });

    it('should fail when releasing twice', (next) => {
        lockfile.lock(tmpFile, (err, release) => {
            expect(err).to.not.be.ok();

            release((err) => {
                expect(err).to.not.be.ok();

                release((err) => {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ERELEASED');

                    next();
                });
            });
        });
    });
});

describe('sync api', () => {
    beforeEach(() => {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    it('should expose a working lockSync', () => {
        let release;

        // Test success
        release = lockfile.lockSync(tmpFile);

        expect(release).to.be.a('function');
        expect(fs.existsSync(tmpFileLock)).to.be(true);
        release();
        expect(fs.existsSync(tmpFileLock)).to.be(false);

        // Test compromise being passed and no options
        release = lockfile.lockSync(tmpFile, () => {});
        expect(fs.existsSync(tmpFileLock)).to.be(true);
        release();
        expect(fs.existsSync(tmpFileLock)).to.be(false);

        // Test options being passed and no compromised
        release = lockfile.lockSync(tmpFile, {});
        expect(fs.existsSync(tmpFileLock)).to.be(true);
        release();
        expect(fs.existsSync(tmpFileLock)).to.be(false);

        // Test both options and compromised being passed
        release = lockfile.lockSync(tmpFile, {}, () => {});
        expect(fs.existsSync(tmpFileLock)).to.be(true);
        release();
        expect(fs.existsSync(tmpFileLock)).to.be(false);

        // Test fail
        lockfile.lockSync(tmpFile);
        expect(() => {
            lockfile.lockSync(tmpFile);
        }).to.throwException(/already being hold/);
    });

    it('should not allow retries to be passed', () => {
        expect(() => {
            lockfile.lockSync(tmpFile, { retries: 10 });
        }).to.throwException(/Cannot use retries/i);

        expect(() => {
            lockfile.lockSync(tmpFile, { retries: { retries: 10 } });
        }).to.throwException(/Cannot use retries/i);

        expect(() => {
            const release = lockfile.lockSync(tmpFile, { retries: 0 });

            release();
        }).to.not.throwException();

        expect(() => {
            const release = lockfile.lockSync(tmpFile, { retries: { retries: 0 } });

            release();
        }).to.not.throwException();
    });

    it('should expose a working unlockSync', () => {
        // Test success
        lockfile.lockSync(tmpFile);
        expect(fs.existsSync(tmpFileLock)).to.be(true);

        lockfile.unlockSync(tmpFile);
        expect(fs.existsSync(tmpFileLock)).to.be(false);

        // Test fail
        expect(() => {
            lockfile.unlockSync(tmpFile);
        }).to.throwException(/not acquired\/owned by you/);
    });

    it('should expose a working checkSync', () => {
        let release;
        let locked;

        // Test success unlocked
        locked = lockfile.checkSync(tmpFile);
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(false);

        // Test success locked
        release = lockfile.lockSync(tmpFile);
        locked = lockfile.checkSync(tmpFile);
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(true);

        // Test success unlocked after release
        release();
        locked = lockfile.checkSync(tmpFile);
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(false);

        // Test options being passed
        locked = lockfile.checkSync(tmpFile, {});
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(false);

        release = lockfile.lockSync(tmpFile);
        locked = lockfile.checkSync(tmpFile, {});
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(true);

        release();
        locked = lockfile.checkSync(tmpFile, {});
        expect(locked).to.be.a('boolean');
        expect(locked).to.be(false);

        // Test fail with non-existent file
        expect(() => {
            lockfile.checkSync('nonexistentdir/nonexistentfile');
        }).to.throwException(/ENOENT/);
    });

    it('should update the lockfile mtime automatically', (next) => {
        let mtime;

        lockfile.lockSync(tmpFile, { update: 1000 });
        mtime = fs.statSync(tmpFileLock).mtime;

        // First update occurs at 1000ms
        setTimeout(() => {
            const stat = fs.statSync(tmpFileLock);

            expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
            mtime = stat.mtime;
        }, 1500);

        // Second update occurs at 2000ms
        setTimeout(() => {
            const stat = fs.statSync(tmpFileLock);

            expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
            mtime = stat.mtime;

            next();
        }, 2500);
    });

    it('should use a custom fs', () => {
        const customFs = Object.assign({}, fs);
        let called;

        customFs.realpathSync = function () {
            called = true;
            return fs.realpathSync.apply(fs, arguments);
        };

        lockfile.lockSync(tmpFile, { fs: customFs });
        expect(called).to.be(true);
    });
});

describe('misc', () => {
    afterEach(clearLocks);

    it('should not contain suspicious nodejs native fs calls', () => {
        expect(/\s{2,}fs\.[a-z]+/i.test(lockfileContents)).to.be(false);
    });

    it('should remove open locks if the process crashes', (next) => {
        cp.exec(`node ${__dirname}/fixtures/crash.js`, (err, stdout, stderr) => {
            if (!err) {
                return next(new Error('Should have failed'));
            }

            if (err.code === 25) {
                return next(new Error('Lock failed'));
            }

            expect(stderr).to.contain('crash');
            expect(fs.existsSync(tmpFileLock)).to.be(false);

            next();
        });
    });

    it('should not hold the process if it has no more work to do', (next) => {
        spawn('node', [`${__dirname}/fixtures/unref.js`], next);
    });

    it('should work on stress conditions', function (next) {
        this.timeout(80000);

        spawn('node', [`${__dirname}/fixtures/stress.js`], (err, stdout) => {
            if (err) {
                if (process.env.TRAVIS) {
                    process.stdout.write(stdout);
                } else {
                    fs.writeFileSync(`${__dirname}/stress.log`, stdout || '');
                }

                return next(err);
            }

            next();
        });
    });
});
