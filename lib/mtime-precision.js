'use strict';

const fs = require('graceful-fs');

const MTIME = new Date(1552815428391);

function getPrecision(path, options, callback) {
    options = options || {};
    options.fs = options.fs || fs;

    options.fs.stat(path, (err, stat) => {
        if (err) {
            return callback(err);
        }

        // Attempt to update mtime to our known past value
        options.fs.utimes(path, stat.atime, MTIME, (err) => {
            if (err) {
                return callback(err);
            }

            // Read back the mtime and see if it is still ms precision
            options.fs.stat(path, (err, updatedStat) => {
                if (err) {
                    return callback(err);
                }

                // Put back the original mtime, nothing to see here!
                options.fs.utimes(path, stat.atime, stat.mtime, (err) => {
                    if (err) {
                        return callback(err);
                    }

                    if (updatedStat.mtime.getTime() === MTIME.getTime()) {
                        callback(null, 'ms');
                    } else if (updatedStat.mtime.getTime() === (Math.trunc(MTIME.getTime() / 1000) * 1000)) {
                        callback(null, 's');
                    } else {
                        callback(Object.assign(
                            new Error('Unsupported mtime precision'),
                            { code: 'EMTIMEPRECISION' }
                        ));
                    }
                });
            });
        });
    });
}

module.exports = getPrecision;
