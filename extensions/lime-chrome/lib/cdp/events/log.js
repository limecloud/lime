/**
 * Log domain event handlers.
 *
 * Handles `Log.entryAdded` — browser-level log entries (distinct from
 * Runtime.consoleAPICalled which handles page-level console calls).
 *
 * Requires: `Log.enable`
 *
 * All events are passive (log + forward).
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:log')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleLogEvent(method, tabId, params, _ctx) {
  if (method === 'Log.entryAdded') {
    const entry = params?.entry
    const level = entry?.level || 'info'
    const text = entry?.text || ''
    const url = entry?.url || ''

    if (level === 'error') {
      log.warn('browser log [error]:', tabId, truncate(text, 150), url ? `(${truncate(url, 80)})` : '')
    } else if (level === 'warning') {
      log.info('browser log [warn]:', tabId, truncate(text, 150))
    } else {
      log.debug('browser log:', tabId, `[${level}]`, truncate(text, 100))
    }
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
