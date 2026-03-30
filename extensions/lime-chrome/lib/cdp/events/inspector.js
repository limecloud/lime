/**
 * Inspector domain event handlers.
 *
 * Handles debugger detach reasons, target crashes, and reload after crash.
 *
 * No explicit enable required — Inspector events flow automatically
 * when a debugger is attached.
 *
 * IMPORTANT: After Inspector.detached, no further CDP commands can be
 * sent to this target. Extension should clean up session state.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:inspector')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleInspectorEvent(method, tabId, params, _ctx) {
  switch (method) {
    case 'Inspector.detached':
      log.warn('inspector detached:', tabId, 'reason:', params?.reason)
      break

    case 'Inspector.targetCrashed':
      log.error('INSPECTOR: target crashed:', tabId)
      break

    case 'Inspector.targetReloadedAfterCrash':
      log.info('target reloaded after crash:', tabId)
      break
  }
}
