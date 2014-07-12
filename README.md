# proper-lockfile

A lockfile utility based on fs that works cross process and machine (network file systems).


## Installation

`$npm install proper-lockfile --save`


## Design

There are various ways to achieve file locking.

This library utilizes `rename` to create a lockfile which works atomically on any kind of file system, even network based ones. Whenever a lock is requested, a temporary file is created and then renamed to the final lockfile name. The lockfile path is based on the file path you are trying to lock by suffixing it with `.lock`.

When a lock is successfully acquired, the lockfile's mtime (modified time) is periodically updated to prevent staleness. This allows to effectively check if a lock is stale by checking its mtime against a stale threshold. If the update of the mtime fails several times, the lock might be compromised.

Optionally, the lockfile can be constantly monitored with `fs.watch` so that you are reported if your lock is compromised earlier (might not work on NFS).


### Comparison

This library is similar to [lockfile](https://github.com/isaacs/lockfile) but the later has some drawbacks:

- It relies on `open` with `O_EXCL` flag which is known by having issues in network file systems. `proper-lockfile` uses `rename` which doesn't have this issue.

```
O_EXCL is broken on NFS file systems; programs which rely on it for performing locking tasks will contain a race condition.
```

- The lockfile staleness check is done via creation time, which is unsuitable for long running processes. `proper-lockfile` constantly updates lockfiles mtime to do proper staleness check.

- It does not check if the lockfile was compromised, which can led to undesirable situations. `proper-lockfile` checks the lockfile when updating the mtime as well as optionally using `fs.watch` to monitor it.


## Usage

### .lock(file, [options], callback, [compromised])

Tries to acquire a lock on `file`.

If the lock succeeds, an `unlock` function is given that should be called when you want to release the lock.   
If the lock get compromised, the provided `compromised` function will be called (if any).   


Available options:

- `stale`: Duration in milliseconds in which the lock is considered stale, defaults to `10000` (`false` to disable)
- `watch`: Watches the lockfile, defauls to `false` (`false` to disable)
- `resolve`: Resolve the file path to a canonical path to handle heterogeneous paths and symlinks, defaults to `true`
- `fs`: A custom fs to use, defaults to node's fs


```js
var lockfile = require('proper-lockfile');

lockfile.lock('some/file', function (err, unlock, lockfile) {
    if (err) {
        throw err;      // Lock failed
    }

    // Do something while the file is locked
    // You can even write data to the lockfile

    // When you are done, then call the provided unlock function
    unlock();
    // or if you want to handle unlock errors..
    unlock(function (err) {
        if (err) {
            throw err;  // Unlock failed
        }
    })
}, function (err) {
    // If we get here, the lock has been compromised
    // e.g.: the lock has been manually deleted
});
```


### .remove(file, [options], callback)

Removes a lock.

You should NOT call this function to unlock a previously acquired lock.   
Use the provided `unlock` function as seen above.   

This function is provided to simply remove the lock, but its unsafe. If someone is owning the lock on `file`, it will get compromised.


Available options:

- `resolve`: Resolve the file path to a canonical path to handle heterogeneous paths and symlinks, defaults to `true`
- `fs`: A custom fs to use, defaults to node's fs


```js
var lockfile = require('proper-lockfile');

lockfile.remove('some/file', function (err, unlock) {
    if (err) {
        throw err;      // Removal failed
    }
});
```


## Tests

Simply run the test suite with `$ npm test`


## License

Released under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
