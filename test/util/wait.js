'use strict';

function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms || 0));
}

async function waitUntil(condition, duration = 20, interval = 250) {
    let iterator = -1;
    const steps = Math.ceil(duration * 1000 / interval);

    let ready;

    do {
        ready = condition();
        await waitFor(interval); // eslint-disable-line no-await-in-loop
        iterator += 1;
    } while (!ready && iterator < steps);

    return ready;
}

module.exports.waitFor = waitFor;
module.exports.waitUntil = waitUntil;
