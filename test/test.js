'use strict';

var fs = require('graceful-fs');
var path = require('path');
var cp = require('child_process');
var expect  = require('expect.js');
var extend = require('extend');
var rimraf = require('rimraf');
var spawn = require('buffered-spawn');
var async = require('async');
var lockfile = require('../');

var lockfileContents = fs.readFileSync(__dirname + '/../index.js').toString();
var tmpFileRealPath = path.join(__dirname, 'tmp');
var tmpFile = path.relative(process.cwd(), tmpFileRealPath);
var tmpFileLock = tmpFileRealPath + '.lock';
var tmpFileLockUid = path.join(tmpFileLock, '.uid');
var tmpFileSymlinkRealPath = tmpFileRealPath + '_symlink';
var tmpFileSymlink = tmpFile + '_symlink';
var tmpFileSymlinkLock = tmpFile + '.lock';

function clearLocks(callback) {
    var toUnlock = [];

    if (fs.existsSync(tmpFile)) {
        toUnlock.push(function (callback) {
            lockfile.unlock(tmpFile, function (err) {
                callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
            });
        });

        toUnlock.push(function (callback) {
            lockfile.unlock(tmpFile, { resolve: false }, function (err) {
                callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
            });
        });
    }

    if (fs.existsSync(tmpFileSymlink)) {
        toUnlock.push(function (callback) {
            lockfile.unlock(tmpFileSymlink, { resolve: false }, function (err) {
                callback(!err || err.code === 'ENOTACQUIRED' ? null : err);
            });
        });
    }

    async.parallel(toUnlock, function (err) {
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

describe('.lock()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    this.timeout(5000);

    it('should fail if the file does not exist', function (next) {
        lockfile.lock('filethatwillneverexist', function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        });
    });

    it('should create the lockfile', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        });
    });

    it('should create the uidfile', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLockUid)).to.be(true);

            next();
        });
    });

    it('should fail if already locked', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
                expect(err.file).to.be(tmpFileRealPath);

                next();
            });
        });
    });

    it('should retry several times if retries were specified', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, function (err, unlock) {
            expect(err).to.not.be.ok();

            setTimeout(unlock, 4000);

            lockfile.lock(tmpFile, { retries: { retries: 5, maxTimeout: 1000 } }, function (err) {
                expect(err).to.not.be.ok();

                next();
            });
        });
    });

    it('should use the custom fs', function (next) {
        var customFs = extend({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should resolve to a canonical path', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');

                next();
            });
        });
    });

    it('should only normalize the path if resolve is false', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFileSymlink, { resolve: false }, function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, { resolve: false }, function (err) {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile + '/../test/tmp', { resolve: false }, function (err) {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ELOCKED');

                    next();
                });
            });
        });
    });

    it('should remove and acquire over stale locks', function (next) {
        var mtime = (Date.now() - 60000) / 1000;

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        });
    });

    it('should retry if the lockfile was removed when verifying staleness', function (next) {
        var mtime = (Date.now() - 60000) / 1000;
        var customFs = extend({}, fs);

        customFs.stat = function (path, callback) {
            rimraf.sync(tmpFileLock);
            fs.stat(path, callback);
            customFs.stat = fs.stat;
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        });
    });

    it('should fail if stating the lockfile errors out when verifying staleness', function (next) {
        var mtime = (Date.now() - 60000) / 1000;
        var customFs = extend({}, fs);

        customFs.stat = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should fail if removing a stale lockfile errors out', function (next) {
        var mtime = (Date.now() - 60000) / 1000;
        var customFs = extend({}, fs);

        customFs.rmdir = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });

    it('should fail if writing the uidfile errors out', function (next) {
        var customFs = extend({}, fs);

        customFs.writeFile = function (path, contents, options, callback) {
            if (typeof options === 'function') {
                callback = options;
                options = {};
            }

            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            expect(fs.existsSync(tmpFileLock)).to.be(false);
            expect(fs.existsSync(tmpFileLockUid)).to.be(false);

            next();
        });
    });

    it('should update the lockfile mtime automatically', function (next) {
        lockfile.lock(tmpFile, { update: 1000 }, function (err) {
            var mtime;

            expect(err).to.not.be.ok();

            mtime = fs.statSync(tmpFileLock).mtime;

            // First update occurs at 1000ms
            setTimeout(function () {
                var stat = fs.statSync(tmpFileLock);
                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;
            }, 1500);

            // Second update occurs at 2000ms
            setTimeout(function () {
                var stat = fs.statSync(tmpFileLock);
                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;

                next();
            }, 2500);
        });
    });

    it('should set stale to a minimum of 2000', function (next) {
        fs.mkdirSync(tmpFileLock);

        setTimeout(function () {
            lockfile.lock(tmpFile, { stale: 100 }, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(function () {
            lockfile.lock(tmpFile, { stale: 100 }, function (err) {
                expect(err).to.not.be.ok();

                next();
            });
        }, 2200);
    });

    it('should set stale to a minimum of 2000 (falsy)', function (next) {
        fs.mkdirSync(tmpFileLock);

        setTimeout(function () {
            lockfile.lock(tmpFile, { stale: false }, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCKED');
            });
        }, 200);

        setTimeout(function () {
            lockfile.lock(tmpFile, { stale: false }, function (err) {
                expect(err).to.not.be.ok();

                next();
            });
        }, 2200);
    });

    it('should call the compromised function if ENOENT was detected when updating the lockfile mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 1000 }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                next();
            }, next);
        }, function (err) {
            expect(err).to.not.be.ok();

            rimraf.sync(tmpFileLock);
        });
    });

    it('should call the compromised function if failed to update the lockfile mtime too many times', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            callback(new Error('foo'));
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.contain('foo');

            next();

        }, function (err) {
            expect(err).to.not.be.ok();
        });
    });

    it('should call the compromised function if updating the lockfile took too much time', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(function () {
                callback(new Error('foo'));
            }, 6000);
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('EUPDATE');

            next();

        }, function (err) {
            expect(err).to.not.be.ok();
        });
    });

    it('should call the compromised function if the lock uid mismatches', function (next) {
        var lock;

        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 3000 }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('EMISMATCH');
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        }, function (err) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                cp.exec('node ' + __dirname + '/fixtures/force.js', function (err) {
                    if (err) {
                        return next(err);
                    }
                });
            }, 1500);
        });
    });

    it('should throw an error by default when the lock is compromised', function (next) {
        var originalException;

        this.timeout(10000);

        originalException = process.listeners('uncaughtException').pop()
        process.removeListener('uncaughtException', originalException);

        process.once('uncaughtException', function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            process.nextTick(function () {
                process.on('uncaughtException', originalException);
                next();
            });
        });

        lockfile.lock(tmpFile, { update: 1000 }, function (err) {
            expect(err).to.not.be.ok();

            rimraf.sync(tmpFileLock);
        });
    });

    it('should set update to a minimum of 1000', function (next) {
        lockfile.lock(tmpFile, { update: 100 }, function (err) {
            var mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(function () {
                expect(mtime).to.equal(fs.statSync(tmpFileLock).mtime.getTime());
            }, 200);

            setTimeout(function () {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 1200);
        });
    });

    it('should set update to a minimum of 1000 (falsy)', function (next) {
        lockfile.lock(tmpFile, { update: false }, function (err) {
            var mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(function () {
                expect(mtime).to.equal(fs.statSync(tmpFileLock).mtime.getTime());
            }, 200);

            setTimeout(function () {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 1200);
        });
    });

    it('should set update to a maximum of stale / 2', function (next) {
        lockfile.lock(tmpFile, { update: 6000, stale: 5000 }, function (err) {
            var mtime = fs.statSync(tmpFileLock).mtime.getTime();

            expect(err).to.not.be.ok();

            setTimeout(function () {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.equal(mtime);
            }, 2000);

            setTimeout(function () {
                expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(mtime);

                next();
            }, 3000);
        });
    });
});

describe('.unlock()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFileSymlink);
    });

    afterEach(clearLocks);

    this.timeout(5000);

    it('should fail if the lock is not acquired', function (next) {
        lockfile.unlock(tmpFile, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOTACQUIRED');

            next();
        });
    });

    it('should release the lock', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    next();
                });
            });
        });
    });

    it('should release the lock (without callback)', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile);

            setTimeout(function () {
                lockfile.lock(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    next();
                });
            }, 2000);
        });
    });


    it('should remove the lockfile', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            lockfile.unlock(tmpFile, function (err) {
                expect(err).to.not.be.ok();
                expect(fs.existsSync(tmpFileLock)).to.be(false);

                next();
            });
        });
    });

    it('should fail if removing the lockfile errors out', function (next) {
        var customFs = extend({}, fs);

        customFs.rmdir = function (path, callback) {
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, function (err) {
                expect(err).to.be.an(Error);
                expect(err.message).to.be('foo');

                next();
            });
        });
    });

    it('should fail if removing the uidfile errors out', function (next) {
        var customFs = extend({}, fs);

        customFs.unlink = function (path, callback) {
            callback(new Error('foo'));
        };

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, function (err) {
                expect(err).to.be.an(Error);
                expect(err.message).to.be('foo');

                next();
            });
        });
    });

    it('should ignore ENOENT errors when removing the lockfile', function (next) {
        var customFs = extend({}, fs);
        var called;

        customFs.rmdir = function (path, callback) {
            called = true;
            rimraf.sync(path);
            fs.rmdir(path, callback);
        };

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, function (err) {
                expect(err).to.not.be.ok();
                expect(called).to.be(true);

                next();
            });
        });
    });

    it('should ignore ENOENT errors when removing the uidfile', function (next) {
        var customFs = extend({}, fs);
        var called;

        customFs.unlink = function (path, callback) {
            called = true;
            rimraf.sync(path);
            fs.unlink(path, callback);
        };

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, { fs: customFs }, function (err) {
                expect(err).to.not.be.ok();
                expect(called).to.be(true);

                next();
            });
        });
    });

    it('should stop updating the lockfile mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 2000 }, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                // First update occurs at 2000ms
                setTimeout(next, 2500);
            });
        });
    });

    it('should stop updating the lockfile mtime (slow fs)', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, update: 2000 }, function (err) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                lockfile.unlock(tmpFile, function (err) {
                    expect(err).to.not.be.ok();
                });
            }, 3000);

            setTimeout(next, 6000);
        });
    });

    it('should stop updating the lockfile mtime (slow fs + new lock)', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, update: 2000 }, function (err) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                lockfile.unlock(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    lockfile.lock(tmpFile, function (err) {
                        expect(err).to.not.be.ok();
                    });
                });
            }, 3000);

            setTimeout(next, 6000);
        });
    });

    it('should resolve to a canonical path', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFileRealPath, tmpFileSymlinkRealPath);

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.unlock(tmpFile, function (err) {
                expect(err).to.not.be.ok();
                expect(fs.existsSync(tmpFileLock)).to.be(false);

                next();
            });
        });
    });

    it('should use the custom fs', function (next) {
        var customFs = extend({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.unlock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        });
    });
});

describe('release()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
    });

    afterEach(clearLocks);

    this.timeout(5000);

    it('should release the lock after calling the provided release function', function (next) {
        lockfile.lock(tmpFile, function (err, release) {
            expect(err).to.not.be.ok();

            release(function (err) {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    next();
                });
            });
        });
    });

    it('should fail when releasing twice', function (next) {
        lockfile.lock(tmpFile, function (err, release) {
            expect(err).to.not.be.ok();

            release(function (err) {
                expect(err).to.not.be.ok();

                release(function (err) {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ERELEASED');

                    next();
                });
            });
        });
    });
});

describe('misc', function () {
    afterEach(clearLocks);

    it('should not contain suspicious nodejs native fs calls', function () {
        expect(/\s{2,}fs\.[a-z]+/i.test(lockfileContents)).to.be(false);
    });

    it('should remove open locks if the process crashes', function (next) {
        cp.exec('node ' + __dirname + '/fixtures/crash.js', function (err) {
            if (!err) {
                return next(new Error('Should have failed'));
            }

            if (err.code === 25) {
               return next(new Error('Lock failed'));
            }

            expect(fs.existsSync(tmpFileLock)).to.be(false);

            next();
        });
    });

    it('should work on stress conditions', function (next) {
        this.timeout(80000);

        spawn('node', [__dirname + '/fixtures/stress.js'], function (err, stdout) {
            if (err) {
                stdout += 'Exit code #' + err.status;

                if (process.env.TRAVIS) {
                    process.stdout.write(stdout);
                } else {
                    fs.writeFileSync(__dirname + '/stress.log', stdout);
                }

                return next(err);
            }

            next();
        });
    });
});
