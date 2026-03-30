/**
 * Debug logger — controlled by a module-level flag.
 *
 * When `DEBUG` is true, all log/warn/error calls forward to the console
 * with a [lime-relay] prefix and a module tag. When false, only warn/error emit.
 *
 * Usage:
 *   import { createLogger, setDebug } from './logger.js'
 *   const log = createLogger('relay')
 *   setDebug(true)
 *   log.debug('connected', { port: 9236 })  // → console.debug('[lime:relay] connected', {port:9236})
 *   log.info('ok')                           // → console.info('[lime:relay] ok')
 *   log.warn('slow')                         // always prints
 *   log.error('fail', err)                   // always prints
 */

let DEBUG = false

export function setDebug(enabled) {
  DEBUG = !!enabled
}

export function isDebug() {
  return DEBUG
}

/**
 * Create a tagged logger.
 * @param {string} module — short tag (e.g. 'relay', 'tabs', 'cdp', 'bg')
 */
export function createLogger(module) {
  const prefix = `[lime:${module}]`

  return {
    /** Only prints when DEBUG is true */
    debug(...args) {
      if (DEBUG) console.debug(prefix, ...args)
    },

    /** Only prints when DEBUG is true */
    info(...args) {
      if (DEBUG) console.info(prefix, ...args)
    },

    /** Always prints */
    warn(...args) {
      console.warn(prefix, ...args)
    },

    /** Always prints */
    error(...args) {
      console.error(prefix, ...args)
    },
  }
}
