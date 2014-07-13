'use strict';

var fs = require('graceful-fs');
var path = require('path');
var cp = require('child_process');
var expect  = require('expect.js');
var extend = require('extend');
var rimraf = require('rimraf');
var spawn = require('buffered-spawn');
var lockfile = require('../');

var lockfileContents = fs.readFileSync(__dirname + '/../index.js').toString();
var tmpFile = path.join(__dirname, 'tmp');
var tmpFileLock = tmpFile + '.lock';

describe('.lock()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFile + '_symlink');
    });

    afterEach(function (next) {
        rimraf.sync(tmpFile + '_symlink');

        if (!fs.existsSync(tmpFileLock)) {
            return next();
        }

        lockfile.remove(tmpFile, rimraf.bind(rimraf, tmpFile, next));
    });

    it('should fail if the file does not exist', function (next) {
        lockfile.lock('filethatwillneverexist', function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        }, next);
    });

    it('should create the lockfile', function (next) {
        lockfile.lock(tmpFile, function (err, unlock) {
            expect(err).to.not.be.ok();
            expect(unlock).to.be.a('function');
            expect(fs.existsSync(tmpFileLock)).to.be(true);

            next();
        }, next);
    });

    it('should fail if already locked', function (next) {
        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCK');
                expect(err.file).to.be(tmpFile);

                next();
            }, next);
        }, next);
    });

    it('should retry several times if retries were specified', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, function (err, unlock) {
            expect(err).to.not.be.ok();

            setTimeout(unlock, 4000);

            lockfile.lock(tmpFile, { retries: { retries: 5, maxTimeout: 1000 } }, function (err) {
                expect(err).to.not.be.ok();

                next();
            }, next);
        }, next);
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
        }, next);
    });

    it('should remove and acquire over stale locks', function (next) {
        var mtime = (Date.now() - 60000) / 1000;

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        }, next);
    });

    it('should not verify staleness if stale is disabled', function (next) {
        var mtime = (Date.now() - 60000) / 1000;

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { stale: false }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ELOCK');

            next();
        }, next);
    });

    it('should retry if the the lock was removed when verifying staleness', function (next) {
        var mtime = (Date.now() - 60000) / 1000;
        var customFs = extend({}, fs);

        customFs.stat = function (path, callback) {
            rimraf.sync(tmpFileLock);
            fs.stat(path, callback);
        };

        fs.mkdirSync(tmpFileLock);
        fs.utimesSync(tmpFileLock, mtime, mtime);

        lockfile.lock(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.statSync(tmpFileLock).mtime.getTime()).to.be.greaterThan(Date.now() - 3000);

            next();
        }, next);
    });

    it('should fail if stating the lock errors out when verifying staleness', function (next) {
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
        }, next);
    });

    it('should fail if removing a stale lock errors out', function (next) {
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
        }, next);
    });

    it('should update the lock mtime automatically', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 1000 }, function (err) {
            var mtime;

            expect(err).to.not.be.ok();

            setTimeout(function () {
                mtime = fs.statSync(tmpFileLock).mtime;
            }, 100);

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
        }, next);
    });

    it('should not update the lock mtime if update is disabled', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: false }, function (err) {
            var mtime;

            expect(err).to.not.be.ok();

            setTimeout(function () {
                mtime = fs.statSync(tmpFileLock).mtime;
            }, 100);

            setTimeout(function () {
                var stat = fs.statSync(tmpFileLock);
                expect(stat.mtime.getTime()).to.equal(mtime.getTime());
                next();
            }, 6000);
        }, next);
    });

    it('should call the compromised function if ENOENT was detected when updating the lock mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 1000 }, function (err) {
            expect(err).to.not.be.ok();

            fs.rmdirSync(tmpFileLock);
        }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');
            expect(err.message).to.contain('utime');

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                next();
            }, next);
        }, next);
    });

    it('should call the compromised function if failed to update the lock mtime too many times', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            callback(new Error('foo'));
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, update: 1000, stale: 5000 }, function (err) {
            expect(err).to.not.be.ok();
        }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.contain('foo');

            next();
        }, next);
    });

    it('should resolve to a canonical path', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFile, tmpFile + '_symlink');

        lockfile.lock(tmpFile + '_symlink', function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCK');

                next();
            }, next);
        }, next);
    });

    it('should only normalize the path if resolve is false', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFile, tmpFile + '_symlink');

        lockfile.lock(tmpFile + '_symlink', { resolve: false }, function (err) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, { resolve: false }, function (err) {
                expect(err).to.not.be.ok();

                lockfile.lock(tmpFile + '/../test/tmp', { resolve: false }, function (err) {
                    expect(err).to.be.an(Error);
                    expect(err.code).to.be('ELOCK');

                    next();
                }, next);
            }, next);
        }, next);
    });

    it('should release the lock after calling the provided unlock function', function (next) {
        lockfile.lock(tmpFile, function (err, unlock) {
            expect(err).to.not.be.ok();

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.be.an(Error);
                expect(err.code).to.be('ELOCK');

                unlock(function (err) {
                    expect(err).to.not.be.ok();

                    lockfile.lock(tmpFile, function (err) {
                        expect(err).to.not.be.ok();

                        next();
                    }, next);
                });
            }, next);
        }, next);
    });
});

describe('.remove()/unlock()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFile + '_symlink');
    });

    afterEach(function (next) {
        rimraf.sync(tmpFile + '_symlink');

        if (!fs.existsSync(tmpFileLock)) {
            return next();
        }

        lockfile.remove(tmpFile, rimraf.bind(rimraf, tmpFile, next));
    });

    it('should succeed if not locked', function (next) {
        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            next();
        });
    });

    it('should remove the lockfile', function (next) {
        fs.mkdirSync(tmpFileLock);

        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(false);

            next();
        }, next);
    });

    it('should fail if removing the lockfile errors out', function (next) {
        var customFs = extend({}, fs);

        customFs.rmdir = function (path, callback) {
            callback(new Error('foo'));
        };

        fs.mkdirSync(tmpFileLock);

        lockfile.remove(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        }, next);
    });

    it('should ignore ENOENT errors when removing the lockfile', function (next) {
        var customFs = extend({}, fs);

        customFs.rmdir = function (path, callback) {
            fs.rmdirSync(tmpFileLock);
            fs.rmdir(path, callback);
        };

        fs.mkdirSync(tmpFileLock);

        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            next();
        }, next);
    });

    it('should stop updating the lockfile mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { update: 2000 }, function (err) {
            expect(err).to.not.be.ok();

            lockfile.remove(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                // First update occurs at 2000ms
                setTimeout(next, 2500);
            }, next);
        }, next);
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
                lockfile.remove(tmpFile, function (err) {
                    expect(err).to.not.be.ok();
                });
            }, 3000);

            setTimeout(next, 6000);
        }, next);
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
                lockfile.remove(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    lockfile.lock(tmpFile, function (err) {
                        expect(err).to.not.be.ok();
                    });
                });
            }, 3000);

            setTimeout(next, 6000);
        }, next);
    });

    it('should resolve to a canonical path', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFile, tmpFile + '_symlink');

        fs.mkdirSync(tmpFileLock);

        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFileLock)).to.be(false);

            next();
        }, next);
    });

    it('should use the custom fs', function (next) {
        var customFs = extend({}, fs);

        customFs.realpath = function (path, callback) {
            customFs.realpath = fs.realpath;
            callback(new Error('foo'));
        };

        lockfile.remove(tmpFile, { fs: customFs }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.message).to.be('foo');

            next();
        }, next);
    });
});

describe('misc', function () {
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
                if (process.env.TRAVIS) {
                    process.stdout.write(stdout);
                } else {
                    fs.writeFileSync(__dirname + '/stress.log', stdout);
                }

                return next(new Error('Stress test failed'));
            }

            next();
        });
    });
});
