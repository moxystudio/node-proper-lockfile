/* eslint-disable jsdoc/valid-types */

'use strict';

const lockfile = require('./lib/lockfile');
const { toPromise, toSync, toSyncOptions } = require('./lib/adapter');

/**
 * @typedef {import("./lib/types").LockOptions} LockOptions
 * @typedef {import("./lib/types").release} release
 */

/**
 * Tries to acquire a lock on file or rejects the promise on error.
 * If the lock succeeds, a release function is provided that should be called when you want to release the lock. The release function also rejects the promise on error (e.g. When the lock was already compromised).
 *
 * @param {string} file - File to acquire lock on.
 * @param {LockOptions} options - Lock options.
 * @returns {Promise<release>} Return value.
 */
async function lock(file, options) {
    const release = await toPromise(lockfile.lock)(file, options);

    return toPromise(release);
}

/**
 * Sync version of .lock().
 *
 * @param {string} file - File to acquire lock on.
 * @param {LockOptions} options - Lock options.
 * @returns { () => void } Returns the release function or throws on error.
 */
function lockSync(file, options) {
    const release = toSync(lockfile.lock)(file, toSyncOptions(options));

    return toSync(release);
}

/**
 * Releases a previously acquired lock on file or rejects the promise on error.
 * Whenever possible you should use the release function instead (as exemplified above). Still there are cases in which it's hard to keep a reference to it around code. In those cases unlock() might be handy.
 *
 * @param {string} file - File to release lock on.
 * @param {Pick<LockOptions, "realpath" | "fs" | "lockfilePath">} options - Unlock options.
 * @returns {Promise<void>}
 */
function unlock(file, options) {
    return toPromise(lockfile.unlock)(file, options);
}

/**
 * Sync version of .lock().
 *
 * @param {string} file - File to release lock on.
 * @param {Pick<LockOptions, "realpath" | "fs" | "lockfilePath">} options - Unlock options.
 * @returns {void}
 */
function unlockSync(file, options) {
    return toSync(lockfile.unlock)(file, toSyncOptions(options));
}

/**
 * Check if the file is locked and its lockfile is not stale, rejects the promise on error.
 *
 * @param {string} file - File to check if a lock is active.
 * @param {Pick<LockOptions, "realpath" | "fs" | "lockfilePath" | "stale">} options - Check options.
 * @returns {Promise<boolean>}
 */
function check(file, options) {
    return toPromise(lockfile.check)(file, options);
}

/**
 * Check if the file is locked and its lockfile is not stale, rejects the promise on error.
 *
 * @param {string} file - File to check if a lock is active.
 * @param {Pick<LockOptions, "realpath" | "fs" | "lockfilePath" | "stale">} options - Check options.
 * @returns {boolean}
 */
function checkSync(file, options) {
    return toSync(lockfile.check)(file, toSyncOptions(options));
}

module.exports = lock;
module.exports.lock = lock;
module.exports.unlock = unlock;
module.exports.lockSync = lockSync;
module.exports.unlockSync = unlockSync;
module.exports.check = check;
module.exports.checkSync = checkSync;
