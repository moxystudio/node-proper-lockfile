'use strict';

const cluster = require('cluster');
const fs = require('fs');
const os = require('os');
const rimraf = require('rimraf');
const sort = require('stable');
const lockfile = require('../../');

const file = `${__dirname}/../tmp`;

function printExcerpt(logs, index) {
    logs.slice(Math.max(0, index - 50), index + 50).forEach((log, index) => {
        process.stdout.write(`${index + 1} ${log.timestamp} ${log.message}\n`);
    });
}

function master() {
    const numCPUs = os.cpus().length;
    let logs = [];
    let acquired;

    fs.writeFileSync(file, '');
    rimraf.sync(`${file}.lock`);

    for (let i = 0; i < numCPUs; i += 1) {
        cluster.fork();
    }

    cluster.on('online', (worker) => {
        worker.on('message', (data) => {
            logs.push(data.toString().trim());
        });
    });

    cluster.on('exit', () => {
        throw new Error('Child died prematurely');
    });

    setTimeout(() => {
        cluster.removeAllListeners('exit');

        cluster.disconnect(() => {
            // Parse & sort logs
            logs = logs.map((log) => {
                const split = log.split(' ');

                return { timestamp: Number(split[0]), message: split[1] };
            });

            logs = sort(logs, (log1, log2) => {
                if (log1.timestamp > log2.timestamp) {
                    return 1;
                }
                if (log1.timestamp < log2.timestamp) {
                    return -1;
                }
                if (log1.message === 'LOCK_RELEASED') {
                    return -1;
                }
                if (log2.message === 'LOCK_RELEASED') {
                    return 1;
                }

                return 0;
            });

            // Validate logs
            logs.forEach((log, index) => {
                switch (log.message) {
                case 'LOCK_ACQUIRED':
                    if (acquired) {
                        process.stdout.write(`\nInconsistent at line ${index + 1}\n`);
                        printExcerpt(logs, index);

                        process.exit(1);
                    }

                    acquired = true;
                    break;
                case 'LOCK_RELEASED':
                    if (!acquired) {
                        process.stdout.write(`\nInconsistent at line ${index + 1}\n`);
                        printExcerpt(logs, index);
                        process.exit(1);
                    }

                    acquired = false;
                    break;
                default:
                    // do nothing
                }
            });

            process.exit(0);
        });
    }, 60000);
}

function slave() {
    process.on('disconnect', () => process.exit(0));

    const tryLock = () => {
        setTimeout(() => {
            process.send(`${Date.now()} LOCK_TRY\n`);

            lockfile.lock(file, (err, unlock) => {
                if (err) {
                    process.send(`${Date.now()} LOCK_BUSY\n`);
                    return tryLock();
                }

                process.send(`${Date.now()} LOCK_ACQUIRED\n`);

                setTimeout(() => {
                    process.send(`${Date.now()} LOCK_RELEASED\n`);

                    unlock((err) => {
                        if (err) {
                            throw err;
                        }

                        tryLock();
                    });
                }, Math.random() * 200);
            });
        }, Math.random() * 100);
    };

    tryLock();
}

if (cluster.isMaster) {
    master();
} else {
    slave();
}
