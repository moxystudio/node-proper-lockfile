# proper-lockfile [![Build Status](https://travis-ci.org/IndigoUnited/node-proper-lockfile.svg?branch=master)](https://travis-ci.org/IndigoUnited/node-proper-lockfile) [![Coverage Status](https://coveralls.io/repos/IndigoUnited/node-proper-lockfile/badge.png?branch=master)](https://coveralls.io/r/IndigoUnited/node-proper-lockfile?branch=master)

A lockfile utility based on fs that works cross process and machine (network file systems).


## Installation

`$ npm install proper-lockfile --save`


## Design

There are various ways to achieve [file locking](http://en.wikipedia.org/wiki/File_locking).

This library utilizes the `mkdir` strategy which works atomically on any kind of file system, even network based ones.
The lockfile path is based on the file path you are trying to lock by suffixing it with `.lock`.

When a lock is successfully acquired, the lockfile's `mtime` (modified time) is periodically updated to prevent staleness. This allows to effectively check if a lock is stale by checking its `mtime` against a stale threshold. If the update of the mtime fails several times, the lock might be compromised.


### Comparison

This library is similar to [lockfile](https://github.com/isaacs/lockfile) but the later has some drawbacks:

- It relies on `open` with `O_EXCL` flag which has problems in network file systems. `proper-lockfile` uses `mkdir` which doesn't have this issue.

> O_EXCL is broken on NFS file systems; programs which rely on it for performing locking tasks will contain a race condition.

- The lockfile staleness check is done via ctime (creation time) which is unsuitable for long running processes. `proper-lockfile` constantly updates lockfiles mtime to do proper staleness check.

- It does not check if the lockfile was compromised which can led to undesirable situations. `proper-lockfile` checks the lockfile when updating the mtime.


## Usage

### .lock(file, [options], callback, [compromised])

Tries to acquire a lock on `file`.

If the lock succeeds, an `unlock` function is provided that should be called when you want to release the lock.   
If the lock gets compromised, the `compromised` function will be called (optionally).


Available options:

- `stale`: Duration in milliseconds in which the lock is considered stale, defaults to `10000` (minimum value is `2000)
- `update`: The interval in milliseconds in which the lockfile's mtime will be updated, defaults to `5000` (minimum value is `1000`, maximum value is `stale - 1000`)
- `retries`: The number of retries or a [retry](https://www.npmjs.org/package/retry) options object, defaults to `0`
- `resolve`: Resolve to a canonical path to handle relative paths & symlinks properly, defaults to `true`
- `fs`: A custom fs to use, defaults to `graceful-fs`


```js
var lockfile = require('proper-lockfile');

lockfile.lock('some/file', function (err, unlock) {
    if (err) {
        throw err;      // Lock failed
    }

    // Do something while the file is locked

    // Call the provided unlock function when you're done
    unlock();

    // Note that you can optionally handle unlock errors though it's not really
    // necessary, since it will eventually get stale
    /*unlock(function (err) {
        // At this point the lock was effectively released or an error
        // ocurred while removing it
    });*/
}, function (err) {
    // If we get here, the lock has been compromised
    // e.g.: the lock has been manually deleted
});
```


### .remove(file, [options], [callback])

Removes a lock.

You should NOT call this function to unlock a lockfile that isn't owned by you.
This function is an alternative to the `unlock` function (as explained above) and you should ONLY call it if you own the lock.

The `callback` is optional because even if the removal of the lock failed, it will eventually get stale since
the lockfile's mtime will no longer be updated.


Available options:

- `resolve`: Resolve to a canonical path to handle relative paths & symlinks properly, defaults to `true`
- `fs`: A custom fs to use, defaults to `graceful-fs`


```js
var lockfile = require('proper-lockfile');

lockfile.lock('some/file', function (err) {
    if (err) {
        throw err;
    }

    // Later..
    lockfile.remove('some/file');
});
```


## Tests

Simply run the test suite with `$ npm test`

The test suite is very extensive. We even have a stress test to guarantee exclusiveness of locks.


## License

Released under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
