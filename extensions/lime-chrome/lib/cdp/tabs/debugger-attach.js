/**
 * Low-level chrome.debugger API operations.
 *
 * Pure chrome.debugger interactions with no state management or relay awareness.
 * Used by TabManager for the physical attach/detach lifecycle.
 *
 * Domain enable strategy on attach:
 *   Page.enable     — always (dialog handling, page lifecycle events)
 *
 * Domains enabled on-demand by relay via CDP commands (through dispatch.js):
 *   Network.enable  — request lifecycle (high traffic, enable only when needed)
 *   Runtime.enable  — JS contexts, console, exceptions
 *   Security.enable — security state changes, cert errors (deprecated)
 *   Fetch.enable    — request interception (must specify patterns)
 *   Log.enable      — browser-level log entries
 *   Debugger.enable — breakpoints, script parsing (pauses execution)
 *   DOM.enable      — DOM mutation observation
 *
 * See lib/cdp/events/ for comprehensive event handling across all domains.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('dbg')

/**
 * Physically attach the Chrome debugger to a tab.
 *
 * @param {number} tabId
 * @returns {Promise<{ realTargetId: string }>} The real CDP targetId assigned by Chrome
 * @throws {Error} If attachment fails
 */
export async function attachDebugger(tabId) {
  const t0 = performance.now()
  const debuggee = { tabId }

  await chrome.debugger.attach(debuggee, '1.3')
  log.debug('attach took', (performance.now() - t0).toFixed(1), 'ms', tabId)

  await chrome.debugger.sendCommand(debuggee, 'Page.enable').catch((err) => {
    log.warn('Page.enable failed', tabId, err)
  })

  const info = /** @type {any} */ (
    await chrome.debugger.sendCommand(debuggee, 'Target.getTargetInfo')
  )
  const realTargetId = String(info?.targetInfo?.targetId || '').trim()

  log.debug('attached', tabId, 'targetId:', realTargetId, 'in', (performance.now() - t0).toFixed(1), 'ms')
  return { realTargetId }
}

/**
 * Detach the Chrome debugger from a tab. Fails silently.
 * @param {number} tabId
 */
export async function detachDebugger(tabId) {
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // Already detached or tab closed
  }
}

/**
 * Detach multiple tabs in parallel. Returns a settled promise.
 * @param {number[]} tabIds
 */
export function detachAll(tabIds) {
  const promises = tabIds.map(
    (tabId) => chrome.debugger.detach({ tabId })
      .then(() => log.debug('detachAll: OK', tabId))
      .catch((err) => log.debug('detachAll: failed', tabId, err)),
  )
  return Promise.allSettled(promises)
}
