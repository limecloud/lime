/**
 * Input domain event handlers.
 *
 * Handles `Input.dragIntercepted`.
 *
 * Requires: `Input.setInterceptDrags({ enabled: true })` — only fires
 * when explicitly enabled by the relay/agent.
 *
 * CRITICAL: Input.dragIntercepted BLOCKS the drag operation until
 * `Input.dispatchDragEvent` (type: "drop" or "dragCancel") is sent.
 *
 * Strategy:
 *   - Relay/agent owns drag interception. They enable it, they handle it.
 *   - We log and forward. No auto-response.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:input')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleInputEvent(method, tabId, params, _ctx) {
  if (method === 'Input.dragIntercepted') {
    log.info(
      'drag intercepted:', tabId,
      'items:', params?.data?.items?.length || 0,
      'dragOpsAllowed:', params?.data?.dragOperationsMask,
    )
  }
}
