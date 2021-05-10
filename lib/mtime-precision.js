'use strict';

const cacheSymbol = Symbol();

function probe(file, fs, callback) {
    let cachedPrecisions = fs[cacheSymbol];
    if (cachedPrecisions === undefined) {
        cachedPrecisions = new Map();

        // Cache the precisions in a non-enumerable way
        Object.defineProperty(fs, cacheSymbol, { value: cachedPrecisions });
    }

    return fs.stat(file, (err, stat) => {
        /* istanbul ignore if */
        if (err) {
            return callback(err);
        }

        const dev = stat.dev;

        // Precisions are cached by device, see #103
        const precision = cachedPrecisions.get(dev);
        if (precision !== undefined) {
            return callback(null, stat.mtime, precision);
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
                cachedPrecisions.set(dev, precision);

                callback(null, stat.mtime, precision);
            });
        });
    });
}

function getMtime(precision) {
    let now = Date.now();

    if (precision === 's') {
        now = Math.ceil(now / 1000) * 1000;
    }

    return new Date(now);
}

module.exports.probe = probe;
module.exports.getMtime = getMtime;
