/**
 * Runtime domain event handlers.
 *
 * Handles JavaScript execution context lifecycle, console API calls,
 * uncaught exceptions, and binding calls.
 *
 * Requires: `Runtime.enable` — the extension enables this via dispatch.js
 * when the relay sends Runtime.enable command.
 *
 * All events are passive (log + forward). No active response needed.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:runtime')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleRuntimeEvent(method, tabId, params, _ctx) {
  switch (method) {
    case 'Runtime.exceptionThrown': {
      const detail = params?.exceptionDetails
      log.warn(
        'JS exception:', tabId,
        'text:', truncate(detail?.text || '', 120),
        'line:', detail?.lineNumber,
        'col:', detail?.columnNumber,
        'url:', truncate(detail?.url || '', 80),
      )
      break
    }

    case 'Runtime.consoleAPICalled':
      log.debug(
        'console.' + (params?.type || 'log') + ':', tabId,
        'args:', params?.args?.length || 0,
        'contextId:', params?.executionContextId,
      )
      break

    case 'Runtime.executionContextCreated':
      log.debug(
        'context created:', tabId,
        'id:', params?.context?.id,
        'name:', params?.context?.name,
        'origin:', truncate(params?.context?.origin || '', 60),
      )
      break

    case 'Runtime.executionContextDestroyed':
      log.debug(
        'context destroyed:', tabId,
        'id:', params?.executionContextId || params?.executionContextUniqueId,
      )
      break

    case 'Runtime.executionContextsCleared':
      log.debug('all contexts cleared:', tabId)
      break

    case 'Runtime.bindingCalled':
      log.debug(
        'binding called:', tabId,
        'name:', params?.name,
        'payload:', truncate(params?.payload || '', 60),
        'contextId:', params?.executionContextId,
      )
      break

    case 'Runtime.inspectRequested':
      log.debug('inspect requested:', tabId, 'hints:', JSON.stringify(params?.hints))
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
