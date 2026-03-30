/**
 * Page lifecycle event handlers.
 *
 * Observes page load, navigation, frame management, download, file chooser,
 * and interstitial events.
 *
 * Requires: `Page.enable` (called in debugger-attach.js on attach).
 *
 * Active handling:
 *   - Page.fileChooserOpened: logged + forwarded to relay for agent to handle
 *     (requires prior Page.setInterceptFileChooserDialog({ enabled: true }))
 *
 * All other events are passive (log + forward to relay).
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:page')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handlePageLifecycleEvent(method, tabId, params, _ctx) {
  switch (method) {
    // ── Load events ──

    case 'Page.loadEventFired':
      log.debug('page loaded:', tabId, 'ts:', params?.timestamp)
      break

    case 'Page.domContentEventFired':
      log.debug('DOM content loaded:', tabId, 'ts:', params?.timestamp)
      break

    case 'Page.lifecycleEvent':
      log.debug(
        'lifecycle:', tabId,
        params?.name,
        'frameId:', params?.frameId,
        'loaderId:', params?.loaderId,
      )
      break

    // ── Frame events ──

    case 'Page.frameNavigated':
      log.debug(
        'frame navigated:', tabId,
        'url:', truncate(params?.frame?.url || '', 100),
        'id:', params?.frame?.id,
        'type:', params?.type,
      )
      break

    case 'Page.frameAttached':
      log.debug(
        'frame attached:', tabId,
        'frameId:', params?.frameId,
        'parentFrameId:', params?.parentFrameId,
      )
      break

    case 'Page.frameDetached':
      log.debug(
        'frame detached:', tabId,
        'frameId:', params?.frameId,
        'reason:', params?.reason,
      )
      break

    case 'Page.frameStartedLoading':
      log.debug('frame loading started:', tabId, 'frameId:', params?.frameId)
      break

    case 'Page.frameStoppedLoading':
      log.debug('frame loading stopped:', tabId, 'frameId:', params?.frameId)
      break

    case 'Page.frameStartedNavigating':
      log.debug(
        'frame navigating:', tabId,
        'frameId:', params?.frameId,
        'url:', truncate(params?.url || '', 100),
        'type:', params?.navigationType,
      )
      break

    case 'Page.navigatedWithinDocument':
      log.debug(
        'SPA navigation:', tabId,
        'frameId:', params?.frameId,
        'url:', truncate(params?.url || '', 100),
        'type:', params?.navigationType,
      )
      break

    // ── Window / popup events ──

    case 'Page.windowOpen':
      log.info(
        'window.open:', tabId,
        'url:', truncate(params?.url || '', 100),
        'name:', params?.windowName || '(none)',
        'features:', params?.windowFeatures?.join(',') || '(none)',
        'userGesture:', params?.userGesture,
      )
      break

    // ── Download events ──

    case 'Page.downloadWillBegin':
      log.info(
        'download starting:', tabId,
        'url:', truncate(params?.url || '', 100),
        'filename:', params?.suggestedFilename,
        'guid:', params?.guid,
      )
      break

    case 'Page.downloadProgress':
      if (params?.state === 'completed') {
        log.info('download completed:', tabId, 'guid:', params?.guid, 'bytes:', params?.totalBytes)
      } else if (params?.state === 'canceled') {
        log.info('download canceled:', tabId, 'guid:', params?.guid)
      }
      break

    // ── File chooser (requires Page.setInterceptFileChooserDialog) ──

    case 'Page.fileChooserOpened':
      log.info(
        'file chooser opened:', tabId,
        'mode:', params?.mode,
        'frameId:', params?.frameId,
        'backendNodeId:', params?.backendNodeId,
      )
      break

    // ── Interstitial (SSL/security pages) ──

    case 'Page.interstitialShown':
      log.warn('interstitial shown (security/SSL page):', tabId)
      break

    case 'Page.interstitialHidden':
      log.info('interstitial hidden:', tabId)
      break
  }
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
