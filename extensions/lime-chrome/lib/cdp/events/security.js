/**
 * Security domain event handlers.
 *
 * Handles certificate errors and security state changes.
 *
 * Requires: `Security.enable` for visibleSecurityStateChanged.
 * Certificate error handling additionally requires:
 *   `Security.setOverrideCertificateErrors({ override: true })`
 *
 * NOTE: Security.certificateError / Security.handleCertificateError
 * is DEPRECATED. For new automation setups, prefer using Chrome's
 * --ignore-certificate-errors launch flag instead.
 *
 * Strategy:
 *   - Security.certificateError → auto-continue (don't block automation)
 *   - Security.visibleSecurityStateChanged → log security state
 *   - Security.securityStateChanged → log overall security state
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:security')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleSecurityEvent(method, tabId, params, _ctx) {
  switch (method) {
    case 'Security.certificateError':
      log.warn(
        'certificate error:', tabId,
        'type:', params?.errorType,
        'url:', params?.requestURL,
        'eventId:', params?.eventId,
      )
      if (params?.eventId !== undefined) {
        chrome.debugger
          .sendCommand({ tabId }, 'Security.handleCertificateError', {
            eventId: params.eventId,
            action: 'continue',
          })
          .then(() => log.debug('cert error auto-continued:', tabId))
          .catch((err) => log.warn('cert error handle failed:', tabId, err?.message || err))
      }
      break

    case 'Security.visibleSecurityStateChanged': {
      const state = params?.visibleSecurityState
      log.debug(
        'visible security state:', tabId,
        'securityState:', state?.securityState,
        'hasCertError:', !!state?.certificateSecurityState?.certificateHasWeakSignature,
      )
      break
    }

    case 'Security.securityStateChanged':
      log.debug(
        'security state changed:', tabId,
        'state:', params?.securityState,
        'schemeIsCrypto:', params?.schemeIsCryptographic,
      )
      break
  }
}
