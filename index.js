'use strict';

var fs = require('graceful-fs');
var path = require('path');
var os = require('os');
var uuid = require('uuid');
var extend = require('extend');
var errcode = require('err-code');

var locks = {};

function retryLock(file, options, callback) {
    var meta = locks[file];

    meta.lockTries = meta.lockTries || 0;

    if (meta.lockTries > 5) {
        return callback(errcode('Lock file is already being hold', 'ELOCK', { file: file }));
    }

    meta.lockTries += 1;
    options.resolve = false;  // File is already resolved
    lock(file, options, callback);
}

function checkLock(file, options, callback) {
    var lockfile = file + '.lock';

    // Don't check staleness if it's disabled
    if (options.stale <= 0) {
        return callback(errcode('Lock file is already being hold', 'ELOCK', { file: file }));
    }

    options.fs.stat(lockfile, function (err, stat) {
        if (err) {
            // Ignore ENOENT errors because the lock might have been released meanwhile
            if (err.code === 'ENOENT') {
                // Re-run the lock routine again
                return retryLock(file, options, callback);
            }

            return callback(err);
        }

        // Check if the lock is not stale
        if (stat.mtime.getTime() > Date.now() - options.stale) {
            return callback(errcode('Lock file is already being hold', 'ELOCK', { file: file }));
        }

        // If it's stale, remove it and try again!
        options.fs.rmdir(lockfile, function (err) {
            // Ignore ENOENT errors because other processes might end
            // up removing it at the same time
            if (err && err.code !== 'ENOENT') {
                return callback(err);
            }

            // Re-run the lock routine again
            retryLock(file, options, callback);
        });
    });
}

function refreshLock(file, options) {
    var meta = locks[file];

    meta.refreshDelay = meta.refreshDelay || (options.stale / 2);
    meta.refreshTimeout = setTimeout(function () {
        meta.refreshTimeout = null;

        // Update the modified time of the lock file
        options.fs.utimes(file + '.lock', Date.now(), Date.now(), function (err) {
            // Ignore if the lock was removed meanwhile
            if (meta !== locks[file]) {
                return;
            }

            // If it failed to update the lock file, check if it is compromised
            // by analyzing the error code and the last refresh
            if (err) {
                if (err.code === 'ENOENT' || meta.lastRefresh < Date.now() - options.stale - 2000) {
                    remove(file, options, function () {
                        meta.compromised && meta.compromised(err);
                    });
                } else {
                    meta.refreshDelay = 1000;
                    refreshLock(file, options);
                }
            // Otherwise, everything is ok
            } else {
                meta.lastRefresh = Date.now();
                meta.refreshDelay = null;
                refreshLock(file, options);
            }
        });
    }, meta.refreshDelay);
}

function watchLock(file, options) {
    var meta,
        lockfile,
        watcher;

    if (!options.fs.watch) {
        return;
    }

    meta = locks[file];
    lockfile = file + '.lock';

    watcher = meta.watcher = options.fs.watch(lockfile);

    watcher.on('error', function () {});
    watcher.on('change', function (event) {
        if (event !== 'rename') {
            return;
        }

        // Confirm the file was removed
        options.fs.stat(lockfile, function (err) {
            // Ignore if it was a false positive or if the lock was removed meanwhile
            if (!err || meta !== locks[file]) {
                return;
            }

            meta.watcher.close();
            meta.watcher = null;

            remove(file, options, function () {
                meta.compromised && meta.compromised(errcode('The lock file has been removed', 'ENOENT'));
            });
        });
    });
}

function canonicalPath(file, options, callback) {
    if (!options.resolve) {
        return callback(null, path.normalize(file));
    }

    options.fs.realpath(file, callback);
}

// -----------------------------------------

function lock(file, options, callback, compromised) {
    if (typeof options === 'function') {
        callback = options;
        options = null;
    }

    options = extend({
        stale: 10000,   // 10 secs
        watch: false,
        resolve: true,
        fs: fs
    }, options);

    if (options.stale > 0) {
        options.stale = Math.max(options.stale, 1000);
    }

    // Resolve to a canonical file path
    canonicalPath(file, options, function (err, file) {
        var lockfileTemp,
            lockfile;

        if (err) {
            return callback(err);
        }

        // Check if the lock is acquired in this process
        if (locks[file]) {
            return callback(errcode('Lock file is already being hold', 'ELOCK', { file: file }));
        }

        // Create a unique temporary file
        lockfile = file + '.lock';
        lockfileTemp = path.join(os.tmpdir(), uuid.v4());
        options.fs.writeFile(lockfileTemp, '', function (err) {
            if (err) {
                return callback(err);
            }

            // Rename it to our lock file (atomic operation)
            options.fs.rename(lockfileTemp, file + '.lock', function (err) {
                if (err) {
                    return options.fs.unlink(lockfileTemp, function () {
                        return callback(err);
                    });
                }

                // If the lock failed, check if its stale
                if (err) {
                    return checkLock(file, options, callback);
                }

                // We now own the lock
                locks[file] = {
                    options: options,
                    compromised: compromised
                };

                // We must keep the lock fresh to avoid staleness
                if (options.stale) {
                    refreshLock(file, options);
                }

                // Watch the lockfile
                if (options.watch) {
                    watchLock(file, options);
                }

                callback(null, remove.bind(null, file, options), lockfile);
            });
        });
    });
}

function remove(file, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = null;
    }

    options = extend({
        fs: fs,
        resolve: true
    }, options);

    // Resolve to a canonical file path
    canonicalPath(file, options, function (err, file) {
        var meta;

        if (err) {
            return callback && callback(err);
        }

        meta = locks[file];
        if (meta) {
            // Cancel refresh timer
            meta.refreshTimeout && clearTimeout(meta.refreshTimeout);
            // Stop watcher
            meta.watcher && meta.watcher.close();

            delete locks[file];
        }

        // Remove lockfile
        options.fs.unlink(file + '.lock', function (err) {
            // Ignore ENOENT errors when removing the directory
            if (err && err.code !== 'ENOENT') {
                return callback && callback(err);
            }

            callback && callback();
        });
    });
}

// Remove acquired locks on exit
process.on('exit', function () {
    Object.keys(locks).forEach(function (file) {
        try { locks[file].options.fs.rmdirSync(file + '.lock'); } catch (e) {}
    });
});

module.exports.lock = lock;
module.exports.remove = remove;
