/**
 * Debugger (JS) domain event handlers.
 *
 * Handles breakpoint pauses, script parsing, and debugging state.
 *
 * Requires: `Debugger.enable` — only fires when relay enables Debugger domain.
 *
 * CRITICAL: Debugger.paused BLOCKS script execution until Debugger.resume()
 * (or step commands) is sent. If no response is sent, the page freezes.
 *
 * Strategy:
 *   - If the relay enabled the Debugger domain, it should handle pauses.
 *   - We auto-resume as a safety measure to prevent indefinite page freeze,
 *     since our extension does NOT use the Debugger domain for breakpoints.
 *   - Forward events to relay for awareness.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:debugger')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleDebuggerDomainEvent(method, tabId, params, _ctx) {
  switch (method) {
    case 'Debugger.paused':
      log.warn(
        'script paused:', tabId,
        'reason:', params?.reason,
        'frames:', params?.callFrames?.length || 0,
        'hitBreakpoints:', params?.hitBreakpoints?.length || 0,
      )
      chrome.debugger
        .sendCommand({ tabId }, 'Debugger.resume')
        .then(() => log.debug('auto-resumed paused script:', tabId))
        .catch((err) => log.warn('auto-resume failed:', tabId, err?.message || err))
      break

    case 'Debugger.resumed':
      log.debug('script resumed:', tabId)
      break

    case 'Debugger.scriptParsed':
      if (params?.url) {
        log.debug(
          'script parsed:', tabId,
          'id:', params?.scriptId,
          'url:', truncate(params?.url, 100),
        )
      }
      break

    case 'Debugger.scriptFailedToParse':
      log.warn(
        'script parse failed:', tabId,
        'id:', params?.scriptId,
        'url:', truncate(params?.url || '', 100),
      )
      break

    case 'Debugger.breakpointResolved':
      log.debug(
        'breakpoint resolved:', tabId,
        'id:', params?.breakpointId,
        'line:', params?.location?.lineNumber,
      )
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
