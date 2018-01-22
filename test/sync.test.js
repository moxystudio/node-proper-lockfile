'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(async () => {
    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

describe('.lockSync()', () => {
    it('should expose a working lockSync', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        const release = lockfile.lockSync(`${tmpDir}/foo`);

        expect(typeof release).toBe('function');
        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(true);

        release();

        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
    });

    it('should fail if the lock is already acquired', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        lockfile.lockSync(`${tmpDir}/foo`);

        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(true);
        expect(() => lockfile.lockSync(`${tmpDir}/foo`)).toThrow(/already being hold/);
    });

    it('should pass options correctly', () => {
        expect(() => lockfile.lockSync(`${tmpDir}/foo`, { realpath: false })).not.toThrow();
    });

    it('should not allow retries to be passed', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        expect(() => lockfile.lockSync(`${tmpDir}/foo`, { retries: 10 })).toThrow(/Cannot use retries/i);

        expect(() => lockfile.lockSync(`${tmpDir}/foo`, { retries: { retries: 10 } })).toThrow(/Cannot use retries/i);

        expect(() => {
            const release = lockfile.lockSync(`${tmpDir}/foo`, { retries: 0 });

            release();
        }).not.toThrow();

        expect(() => {
            const release = lockfile.lockSync(`${tmpDir}/foo`, { retries: { retries: 0 } });

            release();
        }).not.toThrow();
    });

    it('should fail syncronously if release throws', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        expect.assertions(1);

        const release = lockfile.lockSync(`${tmpDir}/foo`);

        release();

        expect(() => release()).toThrow('Lock is already released');
    });
});

describe('.unlockSync()', () => {
    it('should expose a working unlockSync', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        lockfile.lockSync(`${tmpDir}/foo`);

        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(true);

        lockfile.unlockSync(`${tmpDir}/foo`);

        expect(fs.existsSync(`${tmpDir}/foo.lock`)).toBe(false);
    });

    it('should fail is lock is not acquired', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        expect(() => lockfile.unlockSync(`${tmpDir}/foo`)).toThrow(/not acquired\/owned by you/);
    });

    it('should pass options correctly', () => {
        expect(() => lockfile.unlockSync(`${tmpDir}/foo`, { realpath: false })).toThrow(/not acquired\/owned by you/);
    });
});

describe('.checkSync()', () => {
    it('should expose a working checkSync', () => {
        fs.writeFileSync(`${tmpDir}/foo`, '');

        expect(lockfile.checkSync(`${tmpDir}/foo`)).toBe(false);

        const release = lockfile.lockSync(`${tmpDir}/foo`);

        expect(lockfile.checkSync(`${tmpDir}/foo`)).toBe(true);

        release();

        expect(lockfile.checkSync(`${tmpDir}/foo`)).toBe(false);
    });

    it('should fail is file does not exist', () => {
        expect(() => lockfile.checkSync(`${tmpDir}/some-file-that-will-never-exist`)).toThrow(/ENOENT/);
    });

    it('should pass options correctly', () => {
        expect(() => lockfile.checkSync(`${tmpDir}/foo`, { realpath: false })).not.toThrow();
    });
});
