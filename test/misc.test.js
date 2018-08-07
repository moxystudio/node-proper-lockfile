'use strict';

const fs = require('fs');
const execa = require('execa');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(() => rimraf.sync(`${tmpDir}/*`));

it('should always use `options.fs` when calling `fs` methods', () => {
    const lockfileContents = fs.readFileSync(`${__dirname}/../lib/lockfile.js`);

    expect(/\s{1,}fs\.[a-z]+/i.test(lockfileContents)).toBe(false);
});

it('should remove open locks if the process crashes', async () => {
    const { stderr } = await execa('node', [`${__dirname}/fixtures/crash.js`], { reject: false });

    expect(stderr).toMatch('intencional crash');
    expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
});

it('should not hold the process if it has no more work to do', async () => {
    await execa('node', [`${__dirname}/fixtures/unref.js`]);
});

it('should work on stress conditions', async () => {
    try {
        await execa('node', [`${__dirname}/fixtures/stress.js`]);
    } catch (err) {
        const stdout = err.stdout || '';

        if (process.env.CI) {
            process.stdout.write(stdout);
        } else {
            fs.writeFileSync(`${__dirname}/stress.log`, stdout);
        }

        throw err;
    }
}, 80000);
