/* eslint-disable jsdoc/require-returns */
/* eslint-disable jsdoc/require-param-description */
/* eslint-disable jsdoc/valid-types */

'use strict';

const fs = require('graceful-fs');

/**
 * @typedef {import("./types").LockOptions} LockOptions
 */

/**
 * Create a Sync FS interface.
 *
 * @param {fs} fs - FS module.
 * @returns {fs}
 */
function createSyncFs(fs) {
    const methods = ['mkdir', 'realpath', 'stat', 'rmdir', 'utimes'];
    const newFs = { ...fs };

    methods.forEach((method) => {
        // @ts-ignore
        newFs[method] = (...args) => {
            const callback = args.pop();
            let ret;

            try {
                // @ts-ignore
                ret = fs[`${method}Sync`](...args);
            } catch (err) {
                return callback(err);
            }

            callback(null, ret);
        };
    });

    return newFs;
}

// ----------------------------------------------------------

/**
 * @template TResult
 * @param {(file: string, options: LockOptions, cb: (err: Error | undefined | null, value?: TResult) => void) => void} method - Method to promisify.
 * @returns {(...args: any[]) => Promise<TResult>}
 */
function toPromise(method) {
    return (...args) => new Promise((resolve, reject) => {
        /**
         * @param {any} err
         * @param {any} result
         */
        const cb = (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        };

        args.push(cb);

        // @ts-ignore - keep it generic
        method(...args);
    });
}

/**
 * @template TResult
 * @param {(file: string, options: LockOptions, cb: (err: Error | undefined | null, value?: TResult) => void) => void} method - Method callbackify.
 * @returns {(...args: any[]) => TResult}
 */
function toSync(method) {
    return (...args) => {
        let err;
        /** @type{TResult} */
        let result;
        /**
         * @param {any} _err
         * @param {any} _result
         */
        const cb = (_err, _result) => {
            err = _err;
            result = _result;
        };

        args.push(cb);

        // @ts-ignore
        method(...args);

        if (err) {
            throw err;
        }

        // @ts-ignore
        return result;
    };
}

/**
 * @param {LockOptions} options - Options.
 */
function toSyncOptions(options) {
    // Shallow clone options because we are going to mutate them
    options = { ...options };

    // Transform fs to use the sync methods instead
    options.fs = createSyncFs(options.fs || fs);

    // Retries are not allowed because it requires the flow to be sync
    if (
        (typeof options.retries === 'number' && options.retries > 0) ||
        (typeof options.retries === 'object' && typeof options.retries.retries === 'number' && options.retries.retries > 0)
    ) {
        throw Object.assign(new Error('Cannot use retries with the sync api'), { code: 'ESYNC' });
    }

    return options;
}

module.exports = {
    toPromise,
    toSync,
    toSyncOptions,
};
