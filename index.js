'use strict';

var fs = require('graceful-fs');
var path = require('path');
var extend = require('extend');
var errcode = require('err-code');
var retry = require('retry');

var locks = {};

function acquireLock(file, options, callback, compromised) {
    var lockfile = file + '.lock';

    // Rename tmp file it to lockfile (atomic operation)
    options.fs.mkdir(lockfile, function (err) {
        if (err) {
            // Don't check staleness if it's disabled
            if (options.stale <= 0) {
                return callback(errcode('Lock file is already being hold', 'ELOCK', { file: file }));
            }

            // Check if lock is stale
            return options.fs.stat(lockfile, function (err, stat) {
                if (err) {
                    // Retry if the lockfile has been removed (meanwhile)
                    if (err.code === 'ENOENT') {
                        return acquireLock(file, extend(options, { stale: 0 }), callback, compromised);
                    }

                    return callback(err);
                }

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

                    acquireLock(file, extend(options, { stale: 0 }), callback, compromised);
                });
            });
        }

        callback();
    });
}

function updateLock(file, options) {
    var meta = locks[file];

    meta.updateDelay = meta.updateDelay || options.update;
    meta.updateTimeout = setTimeout(function () {
        var mtime = Date.now() / 1000;

        meta.updateTimeout = null;

        // Update the modified time of the lockfile
        options.fs.utimes(file + '.lock', mtime, mtime, function (err) {
            // Ignore if the lock was removed meanwhile
            if (meta !== locks[file]) {
                return;
            }

            // If it failed to update the lockfile, check if it is compromised
            // by analyzing the error code and the last refresh
            if (err) {
                if (err.code === 'ENOENT' || meta.lastUpdate < Date.now() - options.stale - 2000) {
                    remove(file, options, function () {
                        meta.compromisedFn && meta.compromisedFn(err);
                    });
                } else {
                    meta.updateDelay = 1000;
                    updateLock(file, options);
                }
            // Otherwise, everything is ok
            } else {
                meta.lastUpdate = Date.now();
                meta.updateDelay = null;
                updateLock(file, options);
            }
        });
    }, meta.updateDelay);
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
        update: 5000,   // 5 secs
        resolve: true,
        retries: 0,
        fs: fs
    }, options);

    options.retries = options.retries || 0;

    if (typeof options.retries === 'number') {
        options.retries = { retries: options.retries };
    }
    if (options.stale > 0) {
        options.stale = Math.max(options.stale, 1000);
    }
    if (options.update > 0) {
        options.update = Math.max(options.update, 1000);
    }

    // Resolve to a canonical file path
    canonicalPath(file, options, function (err, file) {
        var operation;

        if (err) {
            return callback(err);
        }

        // Attempt to acquire the lock
        operation = retry.operation(options.retries);

        operation.attempt(function () {
            acquireLock(file, options, function (err) {
                if (operation.retry(err)) {
                    return;
                }

                if (err) {
                    return callback(operation.mainError());
                }

                // We now own the lock
                locks[file] = {
                    options: options,
                    compromisedFn: compromised,
                    lastUpdate: Date.now()
                };

                // We must keep the lock fresh to avoid staleness
                if (options.update > 0) {
                    updateLock(file, options);
                }

                callback(null, remove.bind(null, file, options));
            }, compromised);
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
            // Cancel lock refresh
            meta.updateTimeout && clearTimeout(meta.updateTimeout);
            delete locks[file];
        }

        // Remove lockfile
        options.fs.rmdir(file + '.lock', function (err) {
            // Ignore ENOENT errors when removing the directory
            if (err && err.code !== 'ENOENT') {
                return callback && callback(err);
            }

            callback && callback();
        });
    });
}

// Remove acquired locks on exit
/* istanbul ignore next */
process.on('exit', function () {
    Object.keys(locks).forEach(function (file) {
        try { locks[file].options.fs.rmdir(file + '.lock'); } catch (e) {}
    });
});

module.exports.lock = lock;
module.exports.remove = remove;
