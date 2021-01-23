import type {OperationOptions} from 'retry'
import type fs from 'graceful-fs'

interface LockOptions {
  /**
   * Duration in milliseconds in which the lock is considered stale, defaults to 10000 (minimum value is 5000)
   */
  stale?: number
  /**
   * The interval in milliseconds in which the lockfile's mtime will be updated, defaults to stale/2 (minimum value is 1000, maximum value is stale/2)
   */
  update?: number | null
  /**
   * The number of retries or a retry options object, defaults to 0
   */
  retries?: number | OperationOptions
  /**
   * A custom fs to use, defaults to `graceful-fs`
   */
  fs?: typeof fs
  /**
   * Resolve symlinks using realpath, defaults to true (note that if true, the file must exist previously)
   */
  realpath?: boolean
  /**
   * Called if the lock gets compromised, defaults to a function that simply throws the error which will probably cause the process to die
   */
  onCompromised?: (err: Error) => void
  /**
   * Custom lockfile path. e.g.: If you want to lock a directory and create the lock file inside it, you can pass file as <dir path> and options.lockfilePath as <dir path>/dir.lock
   */
  lockfilePath?: string
}

/**
 * Internal lock options to be used after the defaults are merged
 */
interface InternalLockOptions {
    stale: number
    update: number
    retries: number | OperationOptions
    fs: typeof fs
    realpath: boolean
    onCompromised: (err: Error) => void
    lockfilePath?: string
}

interface Lock {
    lockfilePath: string
    mtime: Date
    mtimePrecision: "s" | "ms"
    options: InternalLockOptions,
    lastUpdate: number,
    updateTimeout?: NodeJS.Timeout | null,
    updateDelay?: number | null,
    released?: boolean
}

export declare function release (): Promise<void>

export type {
  Lock,
  LockOptions,
  InternalLockOptions
}
