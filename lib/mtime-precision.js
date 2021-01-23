/* eslint-disable jsdoc/require-returns */
/* eslint-disable jsdoc/require-param-description */
/* eslint-disable jsdoc/valid-types */

'use strict';

const cacheSymbol = Symbol();

/**
 * @typedef {import("./types").LockOptions} LockOptions
 * @typedef {import("graceful-fs")} fs
 * @typedef {import("graceful-fs").Stats} Stats
 */

/**
 * @param {any} file
 * @param {fs} fs
 * @param {(err: Error | undefined, mtime?: Date, cachedPrecision?: "s" | "ms") => void} callback
 */
function probe(file, fs, callback) {
    /** @type {"s" | "ms"} */
    // @ts-ignore
    const cachedPrecision = fs[cacheSymbol];

    if (cachedPrecision) {
        return fs.stat(file, (err, stat) => {
            /* istanbul ignore if */
            if (err) {
                return callback(err);
            }

            callback(undefined, stat.mtime, cachedPrecision);
        });
    }

    // Set mtime by ceiling Date.now() to seconds + 5ms so that it's "not on the second"
    const mtime = new Date((Math.ceil(Date.now() / 1000) * 1000) + 5);

    fs.utimes(file, mtime, mtime, (err) => {
        /* istanbul ignore if */
        if (err) {
            return callback(err);
        }

        fs.stat(file, (err, stat) => {
            /* istanbul ignore if */
            if (err) {
                return callback(err);
            }

            const precision = stat.mtime.getTime() % 1000 === 0 ? 's' : 'ms';

            // Cache the precision in a non-enumerable way
            Object.defineProperty(fs, cacheSymbol, { value: precision });

            callback(undefined, stat.mtime, precision);
        });
    });
}

/**
 * @param {"s" | "ms"} precision
 */
function getMtime(precision) {
    let now = Date.now();

    if (precision === 's') {
        now = Math.ceil(now / 1000) * 1000;
    }

    return new Date(now);
}

module.exports.probe = probe;
module.exports.getMtime = getMtime;
