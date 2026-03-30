/**
 * Fetch domain event handlers.
 *
 * Handles `Fetch.requestPaused` and `Fetch.authRequired`.
 *
 * Requires: `Fetch.enable({ patterns, handleAuthRequests })` — only fires
 * when explicitly enabled by the relay/agent. This is an opt-in interception
 * mechanism.
 *
 * CRITICAL: Both events BLOCK the request until a response command is sent.
 * If no response is sent, the request hangs indefinitely.
 *
 * Strategy:
 *   - These events are agent-controlled (relay enables Fetch domain for
 *     request interception, mocking, etc.). The relay is expected to
 *     respond with Fetch.continueRequest / failRequest / fulfillRequest.
 *   - We log and forward to relay. No auto-response — the relay owns this.
 *   - A safety timeout could be added in future to auto-continue stale requests.
 *
 * Response commands:
 *   Fetch.requestPaused  → Fetch.continueRequest / Fetch.failRequest / Fetch.fulfillRequest
 *   Fetch.authRequired   → Fetch.continueWithAuth
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:fetch')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleFetchEvent(method, tabId, params, _ctx) {
  switch (method) {
    case 'Fetch.requestPaused':
      log.info(
        'request paused:', tabId,
        'requestId:', params?.requestId,
        'url:', truncate(params?.request?.url || '', 120),
        'method:', params?.request?.method,
        'resourceType:', params?.resourceType,
        'responseStatus:', params?.responseStatusCode || '(none)',
      )
      break

    case 'Fetch.authRequired':
      log.warn(
        'auth required:', tabId,
        'requestId:', params?.requestId,
        'url:', truncate(params?.request?.url || '', 120),
        'scheme:', params?.authChallenge?.scheme,
        'realm:', params?.authChallenge?.realm,
        'source:', params?.authChallenge?.source,
      )
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
