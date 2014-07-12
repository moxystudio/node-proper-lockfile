'use strict';

var fs = require('fs');
var path = require('path');
var expect  = require('expect.js');
var extend = require('extend');
var rimraf = require('rimraf');
var lockfile = require('../');

var lockfileContents = fs.readFileSync(__dirname + '/../index.js').toString();
var tmpFile = path.join(__dirname, 'tmp');

describe('.lock()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFile + '_symlink');
    });

    afterEach(function (next) {
        rimraf.sync(tmpFile + '_symlink');

        if (!fs.existsSync(tmpFile + '.lock')) {
            return next();
        }

        lockfile.remove(tmpFile, next);
    });

    it('should fail if the file does not exist', function (next) {
        lockfile.lock('filethatwillneverexist', function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            next();
        }, next);
    });

    it('should create the lock file', function (next) {
        lockfile.lock(tmpFile, function (err, unlock, lockfile) {
            expect(err).to.not.be.ok();
            expect(unlock).to.be.a('function');
            expect(lockfile).to.equal(tmpFile + '.lock');
            expect(fs.existsSync(tmpFile + '.lock')).to.be(true);

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

    it('should update the lock mtime automatically', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { stale: 5000 }, function (err, unlock, lockfile) {
            var mtime;

            expect(err).to.not.be.ok();

            setTimeout(function () {
                mtime = fs.statSync(lockfile).mtime;
            }, 1000);

            // First update occurs at 2500ms
            setTimeout(function () {
                var stat = fs.statSync(lockfile);
                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;
            }, 3000);

            // Second update occurs at 5000ms
            setTimeout(function () {
                var stat = fs.statSync(lockfile);
                expect(stat.mtime.getTime()).to.be.greaterThan(mtime.getTime());
                mtime = stat.mtime;

                next();
            }, 6000);
        }, next);
    });

    it('should call the compromised function if unable to update the lock mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { stale: 5000 }, function (err, unlock, lockfile) {
            expect(err).to.not.be.ok();

            fs.unlinkSync(lockfile);
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

    it('should call the compromised function if the watcher notifies the lockfile was deleted', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { stale: 0, watch: true }, function (err, unlock, lockfile) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                fs.unlinkSync(lockfile);
            }, 2000);
        }, function (err) {
            expect(err).to.be.an(Error);
            expect(err.code).to.be('ENOENT');

            lockfile.lock(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                next();
            }, next);
        });
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

describe('.remove()', function () {
    beforeEach(function () {
        fs.writeFileSync(tmpFile, '');
        rimraf.sync(tmpFile + '_symlink');
    });

    afterEach(function (next) {
        rimraf.sync(tmpFile + '_symlink');

        if (!fs.existsSync(tmpFile + '.lock')) {
            return next();
        }

        lockfile.remove(tmpFile, next);
    });

    it('should succeed if not locked', function (next) {
        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();

            next();
        });
    });

    it('should remove the lock file', function (next) {
        fs.writeFileSync(tmpFile + '.lock', '');

        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFile + '.lock')).to.be(false);

            next();
        }, next);
    });

    it('should stop updating the lock file mtime', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { stale: 5000 }, function (err) {
            expect(err).to.not.be.ok();

            lockfile.remove(tmpFile, function (err) {
                expect(err).to.not.be.ok();

                // First update occurs at 2500ms
                setTimeout(next, 3000);
            }, next);
        }, next);
    });

    it('should stop updating the lock file mtime (slow fs)', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, stale: 5000 }, function (err) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                lockfile.remove(tmpFile, function (err) {
                    expect(err).to.not.be.ok();
                });
            }, 3000);

            setTimeout(next, 7000);
        }, next);
    });

    it('should stop updating the lock file mtime (slow fs + new lock)', function (next) {
        var customFs = extend({}, fs);

        customFs.utimes = function (path, atime, mtime, callback) {
            setTimeout(fs.utimes.bind(fs, path, atime, mtime, callback), 2000);
        };

        this.timeout(10000);

        lockfile.lock(tmpFile, { fs: customFs, stale: 5000 }, function (err) {
            expect(err).to.not.be.ok();

            setTimeout(function () {
                lockfile.remove(tmpFile, function (err) {
                    expect(err).to.not.be.ok();

                    lockfile.lock(tmpFile, function (err) {
                        expect(err).to.not.be.ok();
                    });
                });
            }, 3000);

            setTimeout(next, 7000);
        }, next);
    });

    it('should stop watching the lock file', function (next) {
        this.timeout(10000);

        lockfile.lock(tmpFile, { stale: 0, watch: true }, function (err, unlock, lockfile) {
            expect(err).to.not.be.ok();

            fs.unlinkSync(lockfile);

            // Wait a bit
            setTimeout(next, 5000);
        }, next);
    });

    it('should resolve to a canonical path', function (next) {
        // Create a symlink to the tmp file
        fs.symlinkSync(tmpFile, tmpFile + '_symlink');

        fs.writeFileSync(tmpFile + '.lock', '');

        lockfile.remove(tmpFile, function (err) {
            expect(err).to.not.be.ok();
            expect(fs.existsSync(tmpFile + '.lock')).to.be(false);

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
        expect(/\s+fs\.[a-z]+/i.test(lockfileContents)).to.be(false);
    });

    it('should work on stress conditions');
});
