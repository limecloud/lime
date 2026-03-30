/**
 * Target domain event handlers.
 *
 * Tracks child sessions (iframes, workers) attached/detached under a parent
 * tab's debugger session, and monitors target lifecycle (crash, create, destroy).
 *
 * No explicit enable required — Target events flow after debugger attach.
 * `Target.setDiscoverTargets` can be used for additional discovery events.
 *
 * Migrated from inline logic in TabManager.onDebuggerEvent + expanded.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:target')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleTargetEvent(method, tabId, params, ctx) {
  switch (method) {
    case 'Target.attachedToTarget':
      if (params?.sessionId) {
        const sid = String(params.sessionId)
        ctx.childSession.set(sid, tabId)
        let children = ctx.childSets.get(tabId)
        if (!children) {
          children = new Set()
          ctx.childSets.set(tabId, children)
        }
        children.add(sid)
        log.debug(
          'child session attached:', tabId, sid,
          'type:', params.targetInfo?.type,
          'url:', truncate(params.targetInfo?.url || '', 80),
        )
      }
      break

    case 'Target.detachedFromTarget':
      if (params?.sessionId) {
        const sid = String(params.sessionId)
        ctx.childSession.delete(sid)
        ctx.childSets.get(tabId)?.delete(sid)
        log.debug('child session detached:', tabId, sid)
      }
      break

    case 'Target.targetCreated':
      log.info(
        'target created:', tabId,
        'targetId:', params?.targetInfo?.targetId,
        'type:', params?.targetInfo?.type,
        'url:', truncate(params?.targetInfo?.url || '', 80),
      )
      break

    case 'Target.targetDestroyed':
      log.info('target destroyed:', tabId, 'targetId:', params?.targetId)
      break

    case 'Target.targetCrashed':
      log.warn(
        'TARGET CRASHED:', tabId,
        'targetId:', params?.targetId,
        'status:', params?.status,
        'errorCode:', params?.errorCode,
      )
      break

    case 'Target.targetInfoChanged':
      log.debug(
        'target info changed:', tabId,
        'targetId:', params?.targetInfo?.targetId,
        'title:', truncate(params?.targetInfo?.title || '', 60),
        'url:', truncate(params?.targetInfo?.url || '', 80),
      )
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
