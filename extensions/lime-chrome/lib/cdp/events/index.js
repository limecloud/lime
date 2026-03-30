/**
 * CDP event interceptor — routes debugger events to domain-specific handlers
 * before they are forwarded to the relay.
 *
 * Architecture:
 *   chrome.debugger.onEvent → TabManager.onDebuggerEvent → interceptEvent()
 *     → domain handler (side effects: auto-accept, logging, session tracking)
 *     → forward to relay (unless handler returns { suppress: true })
 *
 * Event handler modules:
 *   dialog.js          — Page.javascriptDialogOpening/Closed (auto-accept)
 *   page-lifecycle.js  — Page load, navigation, frame, download, interstitial, file chooser
 *   target.js          — Target session/lifecycle management
 *   security.js        — Certificate errors (auto-continue), security state
 *   fetch.js           — Fetch.requestPaused/authRequired (relay-controlled)
 *   network.js         — Network request lifecycle, WebSocket
 *   runtime.js         — JS context, console, exceptions
 *   inspector.js       — Debugger detach, target crash
 *   debugger-domain.js — Debugger.paused (auto-resume), script parsing
 *   input.js           — Input.dragIntercepted (relay-controlled)
 *   log.js             — Log.entryAdded (browser-level logs)
 *
 * CDP domain enable requirements:
 *   Page      → Page.enable              (called on attach)
 *   Network   → Network.enable           (relay must enable)
 *   Runtime   → Runtime.enable           (relay must enable)
 *   Security  → Security.enable          (relay must enable)
 *   Fetch     → Fetch.enable             (relay must enable, with patterns)
 *   Log       → Log.enable               (relay must enable)
 *   Debugger  → Debugger.enable          (relay must enable)
 *   Target    → auto after attach        (no explicit enable needed)
 *   Inspector → auto after attach        (no explicit enable needed)
 *   Input     → Input.setInterceptDrags  (relay must enable)
 *
 * @module lib/cdp/events
 */

import { handleDialogEvent } from './dialog.js'
import { handleTargetEvent } from './target.js'
import { handlePageLifecycleEvent } from './page-lifecycle.js'
import { handleSecurityEvent } from './security.js'
import { handleFetchEvent } from './fetch.js'
import { handleNetworkEvent } from './network.js'
import { handleRuntimeEvent } from './runtime.js'
import { handleInspectorEvent } from './inspector.js'
import { handleDebuggerDomainEvent } from './debugger-domain.js'
import { handleInputEvent } from './input.js'
import { handleLogEvent } from './log.js'

/**
 * @typedef {Object} EventContext
 * @property {Map<string, number>} childSession  — child sessionId → parent tabId
 * @property {Map<number, Set<string>>} childSets — parent tabId → child sessionIds
 * @property {{ info: Function, warn: Function, debug: Function, error: Function }} log
 */

const _handlers = new Map([
  // ── Page domain (requires Page.enable) ──
  ['Page.javascriptDialogOpening', handleDialogEvent],
  ['Page.javascriptDialogClosed', handleDialogEvent],
  ['Page.loadEventFired', handlePageLifecycleEvent],
  ['Page.domContentEventFired', handlePageLifecycleEvent],
  ['Page.lifecycleEvent', handlePageLifecycleEvent],
  ['Page.frameNavigated', handlePageLifecycleEvent],
  ['Page.frameAttached', handlePageLifecycleEvent],
  ['Page.frameDetached', handlePageLifecycleEvent],
  ['Page.frameStartedLoading', handlePageLifecycleEvent],
  ['Page.frameStoppedLoading', handlePageLifecycleEvent],
  ['Page.frameStartedNavigating', handlePageLifecycleEvent],
  ['Page.navigatedWithinDocument', handlePageLifecycleEvent],
  ['Page.windowOpen', handlePageLifecycleEvent],
  ['Page.downloadWillBegin', handlePageLifecycleEvent],
  ['Page.downloadProgress', handlePageLifecycleEvent],
  ['Page.fileChooserOpened', handlePageLifecycleEvent],
  ['Page.interstitialShown', handlePageLifecycleEvent],
  ['Page.interstitialHidden', handlePageLifecycleEvent],

  // ── Target domain (auto after attach) ──
  ['Target.attachedToTarget', handleTargetEvent],
  ['Target.detachedFromTarget', handleTargetEvent],
  ['Target.targetCreated', handleTargetEvent],
  ['Target.targetDestroyed', handleTargetEvent],
  ['Target.targetCrashed', handleTargetEvent],
  ['Target.targetInfoChanged', handleTargetEvent],

  // ── Security domain (requires Security.enable) ──
  ['Security.certificateError', handleSecurityEvent],
  ['Security.visibleSecurityStateChanged', handleSecurityEvent],
  ['Security.securityStateChanged', handleSecurityEvent],

  // ── Fetch domain (requires Fetch.enable) ──
  ['Fetch.requestPaused', handleFetchEvent],
  ['Fetch.authRequired', handleFetchEvent],

  // ── Network domain (requires Network.enable) ──
  ['Network.requestIntercepted', handleNetworkEvent],
  ['Network.requestWillBeSent', handleNetworkEvent],
  ['Network.responseReceived', handleNetworkEvent],
  ['Network.loadingFinished', handleNetworkEvent],
  ['Network.loadingFailed', handleNetworkEvent],
  ['Network.webSocketCreated', handleNetworkEvent],
  ['Network.webSocketClosed', handleNetworkEvent],
  ['Network.webSocketFrameError', handleNetworkEvent],

  // ── Runtime domain (requires Runtime.enable) ──
  ['Runtime.exceptionThrown', handleRuntimeEvent],
  ['Runtime.consoleAPICalled', handleRuntimeEvent],
  ['Runtime.executionContextCreated', handleRuntimeEvent],
  ['Runtime.executionContextDestroyed', handleRuntimeEvent],
  ['Runtime.executionContextsCleared', handleRuntimeEvent],
  ['Runtime.bindingCalled', handleRuntimeEvent],
  ['Runtime.inspectRequested', handleRuntimeEvent],

  // ── Inspector domain (auto after attach) ──
  ['Inspector.detached', handleInspectorEvent],
  ['Inspector.targetCrashed', handleInspectorEvent],
  ['Inspector.targetReloadedAfterCrash', handleInspectorEvent],

  // ── Debugger domain (requires Debugger.enable) ──
  ['Debugger.paused', handleDebuggerDomainEvent],
  ['Debugger.resumed', handleDebuggerDomainEvent],
  ['Debugger.scriptParsed', handleDebuggerDomainEvent],
  ['Debugger.scriptFailedToParse', handleDebuggerDomainEvent],
  ['Debugger.breakpointResolved', handleDebuggerDomainEvent],

  // ── Input domain (requires Input.setInterceptDrags) ──
  ['Input.dragIntercepted', handleInputEvent],

  // ── Log domain (requires Log.enable) ──
  ['Log.entryAdded', handleLogEvent],
])

/**
 * Process a CDP debugger event through registered handlers.
 *
 * @param {string} method  — CDP event method (e.g. 'Page.javascriptDialogOpening')
 * @param {number} tabId
 * @param {object} params  — CDP event params
 * @param {EventContext} ctx
 * @returns {{ suppress?: boolean }} — if suppress is true, caller should not forward to relay
 */
export function interceptEvent(method, tabId, params, ctx) {
  const handler = _handlers.get(method)
  if (!handler) return {}
  try {
    return handler(method, tabId, params, ctx) || {}
  } catch (err) {
    ctx.log?.error?.(`event handler threw for ${method} on tab ${tabId}:`, err)
    return {}
  }
}
