/**
 * Network domain event handlers.
 *
 * Handles request lifecycle events: sent, received, finished, failed.
 *
 * Requires: `Network.enable` — only fires when relay enables Network domain.
 *
 * Active handling:
 *   - Network.requestIntercepted: LEGACY interception (prefer Fetch domain).
 *     Blocks request until Network.continueInterceptedRequest is sent.
 *     Forwarded to relay for handling — relay owns the response.
 *
 * Passive events: request/response lifecycle, WebSocket, data transfer.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:network')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleNetworkEvent(method, tabId, params, _ctx) {
  switch (method) {
    // ── BLOCKING: Legacy interception (relay must respond) ──

    case 'Network.requestIntercepted':
      log.warn(
        'request intercepted (legacy):', tabId,
        'interceptionId:', params?.interceptionId,
        'url:', truncate(params?.request?.url || '', 120),
        'isNav:', params?.isNavigationRequest,
        'hasAuth:', !!params?.authChallenge,
      )
      break

    // ── Request lifecycle ──

    case 'Network.requestWillBeSent':
      log.debug(
        'request →', tabId,
        params?.request?.method, truncate(params?.request?.url || '', 100),
        'type:', params?.type,
        'requestId:', params?.requestId,
      )
      break

    case 'Network.responseReceived':
      log.debug(
        'response ←', tabId,
        params?.response?.status, truncate(params?.response?.url || '', 100),
        'type:', params?.type,
        'requestId:', params?.requestId,
      )
      break

    case 'Network.loadingFinished':
      log.debug(
        'loading finished:', tabId,
        'requestId:', params?.requestId,
        'bytes:', params?.encodedDataLength,
      )
      break

    case 'Network.loadingFailed':
      log.info(
        'loading failed:', tabId,
        'requestId:', params?.requestId,
        'error:', params?.errorText,
        'type:', params?.type,
        'canceled:', params?.canceled,
        'blocked:', params?.blockedReason,
      )
      break

    // ── WebSocket events ──

    case 'Network.webSocketCreated':
      log.debug('WebSocket created:', tabId, 'url:', truncate(params?.url || '', 100))
      break

    case 'Network.webSocketClosed':
      log.debug('WebSocket closed:', tabId, 'requestId:', params?.requestId)
      break

    case 'Network.webSocketFrameError':
      log.warn('WebSocket error:', tabId, 'error:', params?.errorMessage)
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
