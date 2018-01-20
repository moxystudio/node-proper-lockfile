'use strict';

const cluster = require('cluster');
const fs = require('fs');
const os = require('os');
const pDelay = require('delay');
const sort = require('stable');
const lockfile = require('../../');

const tmpDir = `${__dirname}/../tmp`;

const maxTryDelay = 50;
const maxLockTime = 200;
const totalTestTime = 60000;

function printExcerpt(logs, index) {
    const startIndex = Math.max(0, index - 50);
    const endIndex = index + 50;

    logs
    .slice(startIndex, endIndex)
    .forEach((log, index) => process.stdout.write(`${startIndex + index + 1} ${log.timestamp} ${log.message}\n`));
}

async function master() {
    const numCPUs = os.cpus().length;
    let logs = [];

    fs.writeFileSync(`${tmpDir}/foo`, '');

    for (let i = 0; i < numCPUs; i += 1) {
        cluster.fork();
    }

    cluster.on('online', (worker) =>
        worker.on('message', (data) =>
            logs.push(data.toString().trim())));

    cluster.on('exit', () => {
        throw new Error('Child died prematurely');
    });

    await pDelay(totalTestTime);

    cluster.removeAllListeners('exit');

    cluster.disconnect(() => {
        let acquired;

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
            if (log1.message === 'LOCK_RELEASE_CALLED') {
                return -1;
            }
            if (log2.message === 'LOCK_RELEASE_CALLED') {
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
            case 'LOCK_RELEASE_CALLED':
                if (!acquired) {
                    process.stdout.write(`\nInconsistent at line ${index + 1}\n`);
                    printExcerpt(logs, index);
                    process.exit(1);
                }

                acquired = false;
                break;
            default:
                // Do nothing
            }
        });

        process.exit(0);
    });
}

function worker() {
    process.on('disconnect', () => process.exit(0));

    const tryLock = async () => {
        await pDelay(Math.max(Math.random(), 10) * maxTryDelay);

        process.send(`${Date.now()} LOCK_TRY\n`);

        let release;

        try {
            release = await lockfile.lock(`${tmpDir}/foo`);
        } catch (err) {
            process.send(`${Date.now()} LOCK_BUSY\n`);
            tryLock();

            return;
        }

        process.send(`${Date.now()} LOCK_ACQUIRED\n`);

        await pDelay(Math.max(Math.random(), 10) * maxLockTime);

        process.send(`${Date.now()} LOCK_RELEASE_CALLED\n`);

        await release();

        tryLock();
    };

    tryLock();
}

// Any unhandled promise should cause the process to exit
process.on('unhandledRejection', (err) => {
    console.error(err.stack);
    process.exit(1);
});

if (cluster.isMaster) {
    master();
} else {
    worker();
}
