/**
 * TabManager — Lazy Attach architecture.
 *
 * Encapsulates all tab state: discovery, lazy physical attach, agent tracking.
 *
 * Tab lifecycle:
 *   virtual   → discovered by chrome.tabs.query, no chrome.debugger session
 *   attaching → chrome.debugger.attach() in flight
 *   connected → physically attached via chrome.debugger
 *
 * Relay notifications:
 *   Extension.tabDiscovered        — virtual tab discovered (relay stores, Playwright ignores)
 *   Extension.tabUpdated           — virtual tab metadata (title/url) changed
 *   Extension.tabRemoved           — virtual tab removed from cache
 *   Target.attachedToTarget        — physical debugger attached (Playwright sees this)
 *   Target.detachedFromTarget      — physical debugger detached (Playwright sees this)
 *
 * Delegates to:
 *   SessionIndicators  — spinner animation + idle tab detection
 *   AgentGroupManager  — Chrome tab group management
 */

import { TabType } from '../../constants.js'
import { createLogger } from '../../logger.js'
import { attachDebugger, detachDebugger, detachAll } from './debugger-attach.js'
import { SessionIndicators } from './session-indicators.js'
import { AgentGroupManager } from './agent-group.js'
import { cleanupTabQueue, cleanupAllTabQueues } from '../commands/dispatch.js'
import { interceptEvent } from '../events/index.js'

const log = createLogger('tabs')

const CANCELLED_TABS_KEY = 'accio_cancelledTabs'

let _sessionSeq = 0

const DEBUGGABLE_URL_RE = /^(https?|file):\/\//

function isDebuggableUrl(url) {
  if (!url) return false
  return DEBUGGABLE_URL_RE.test(url) || url === 'about:blank'
}

export class TabManager {
  /** @type {Map<number, {state: string, sessionId: string, targetId: string, url?: string, title?: string}>} */
  #tabs = new Map()
  /** @type {Map<string, number>} sessionId → tabId */
  #bySession = new Map()
  /** @type {Map<string, number>} targetId → tabId */
  #byTarget = new Map()
  /** @type {Map<string, number>} child sessionId → parent tabId */
  #childSession = new Map()
  /** @type {Map<number, Set<string>>} parent tabId → child sessionIds */
  #childSets = new Map()
  /** @type {Map<number, string>} tabId → TabType */
  #agentTabs = new Map()
  /** @type {Set<number>} */
  #cancelled = new Set()
  /** @type {Map<number, Promise<boolean>>} tabId → pending attach promise */
  #pending = new Map()
  #retainedCount = 0
  /** @type {boolean} */
  #shuttingDown = false
  /** @type {number|null} */
  #lastAttached = null
  /** @type {(payload: any) => void} */
  #sendToRelay

  /** @type {SessionIndicators} */
  #indicators
  /** @type {AgentGroupManager} */
  #group

  /**
   * @param {(payload: any) => void} sendToRelay — fire-and-forget relay send function
   */
  constructor(sendToRelay) {
    this.#sendToRelay = sendToRelay
    this.#group = new AgentGroupManager()
    this.#indicators = new SessionIndicators({
      getGroupId: () => this.#group.groupId,
      getTabEntries: () => this.#tabs.entries(),
      detachTab: (tabId, reason) => void this.detach(tabId, reason),
    })
  }

  // ── CDP command tracking (forwarded from dispatch) ──

  onCdpCommand(tabId) {
    this.#indicators.trackCommand(tabId)
  }

  // ── Session lifecycle ──

  startSessionIndicators() {
    this.#indicators.start()
  }

  stopSessionIndicators() {
    this.#indicators.stop()
  }

  handleIndicatorAlarm(alarmName) {
    return this.#indicators.handleAlarm(alarmName)
  }

  // ── Tab group ──

  async addToAgentGroup(tabId) {
    await this.#group.addTab(tabId)
  }

  async dissolveAgentGroup() {
    const agentIds = new Set(this.#agentTabs.keys())
    await this.#group.dissolve(agentIds)
  }

  /**
   * Atomic shutdown: optionally dissolve agent group, then clear all state.
   * Dissolution runs BEFORE clearAll() so that the groupId and agentTabs
   * are still available for deciding which tabs to close vs ungroup.
   */
  async shutdown({ dissolveGroup = false } = {}) {
    if (dissolveGroup) {
      await this.dissolveAgentGroup()
    }
    return this.clearAll()
  }

  // ── Tab state queries ──

  get size() { return this.#tabs.size }
  has(tabId) { return this.#tabs.has(tabId) }
  get(tabId) { return this.#tabs.get(tabId) }
  entries() { return this.#tabs.entries() }

  get agentTabCount() { return this.#agentTabs.size }
  get retainedTabCount() { return this.#retainedCount }
  get agentTabs() { return this.#agentTabs }

  // ── Lookup ──

  getBySessionId(sessionId) {
    const direct = this.#bySession.get(sessionId)
    if (direct !== undefined) return { tabId: direct, kind: 'main' }
    const child = this.#childSession.get(sessionId)
    if (child !== undefined) return { tabId: child, kind: 'child' }
    return null
  }

  getByTargetId(targetId) {
    return this.#byTarget.get(targetId) ?? null
  }

  resolveTabId(sessionId, targetId) {
    if (sessionId) {
      const found = this.getBySessionId(sessionId)
      if (found) return found.tabId
    }
    if (targetId) {
      const found = this.getByTargetId(targetId)
      if (found !== null) return found
    }
    if (this.#lastAttached !== null && this.#tabs.has(this.#lastAttached)) {
      return this.#lastAttached
    }
    return null
  }

  // ── User-cancelled tab tracking (persisted to session storage) ──

  markCancelled(tabId) {
    this.#cancelled.add(tabId)
    void this.#persistCancelled()
  }

  isCancelled(tabId) { return this.#cancelled.has(tabId) }

  removeCancelled(tabId) {
    this.#cancelled.delete(tabId)
    void this.#persistCancelled()
  }

  async loadCancelled() {
    try {
      const { [CANCELLED_TABS_KEY]: ids } = await chrome.storage.session.get(CANCELLED_TABS_KEY)
      const arr = Array.isArray(ids) ? ids : []
      this.#cancelled.clear()
      for (const id of arr) {
        if (typeof id === 'number' && Number.isInteger(id)) this.#cancelled.add(id)
      }
    } catch (err) {
      log.warn('loadCancelled failed:', err)
    }
  }

  async #persistCancelled() {
    try {
      await chrome.storage.session.set({ [CANCELLED_TABS_KEY]: [...this.#cancelled] })
    } catch (err) {
      log.warn('persistCancelled failed:', err)
    }
  }

  // ── Agent tab tracking ──

  markAgent(tabId, retain = false) {
    const prev = this.#agentTabs.get(tabId)
    const next = retain ? TabType.RETAINED : TabType.AGENT
    this.#agentTabs.set(tabId, next)
    if (next === TabType.RETAINED && prev !== TabType.RETAINED) this.#retainedCount++
    else if (next !== TabType.RETAINED && prev === TabType.RETAINED) this.#retainedCount--
  }

  deleteAgent(tabId) {
    const prev = this.#agentTabs.get(tabId)
    if (prev === undefined) return
    if (prev === TabType.RETAINED) this.#retainedCount--
    this.#agentTabs.delete(tabId)
  }

  isAgent(tabId) { return this.#agentTabs.has(tabId) }
  isRetained(tabId) { return this.#agentTabs.get(tabId) === TabType.RETAINED }

  // ── Discovery (virtual registration) ──

  async discoverAll(isConnected) {
    const t0 = performance.now()
    if (!isConnected()) return

    const allTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] })
    log.debug('discoverAll: query took', (performance.now() - t0).toFixed(1), 'ms,', allTabs.length, 'tabs')

    let count = 0
    for (const tab of allTabs) {
      if (!tab.id || this.#tabs.has(tab.id) || this.#cancelled.has(tab.id)) continue
      this.#registerVirtual(tab.id, tab.url, tab.title)
      count++
    }
    log.info('discoverAll: registered', count, 'virtual tabs in', (performance.now() - t0).toFixed(1), 'ms')
  }

  discover(tabId, url, title) {
    if (!this.#tabs.has(tabId) && isDebuggableUrl(url)) {
      this.#registerVirtual(tabId, url, title)
      log.debug('discover: registered virtual tab', tabId)
    }
  }

  /**
   * Update a tracked tab's URL and/or title.
   * Sends Extension.tabUpdated to the relay so the agent side stays in sync.
   */
  updateTab(tabId, url, title) {
    const entry = this.#tabs.get(tabId)
    if (!entry) return

    let changed = false
    if (url !== undefined && url !== entry.url) { entry.url = url; changed = true }
    if (title !== undefined && title !== entry.title) { entry.title = title; changed = true }
    if (!changed) return

    this.#sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Extension.tabUpdated',
        params: {
          sessionId: entry.sessionId,
          targetInfo: {
            targetId: entry.targetId, type: 'page',
            title: entry.title || '', url: entry.url || '',
            attached: entry.state === 'connected',
          },
        },
      },
    })
  }

  #registerVirtual(tabId, url, title) {
    if (this.#tabs.has(tabId) || this.#cancelled.has(tabId)) return

    const sessionId = `cb-tab-${++_sessionSeq}-${tabId}`
    const targetId = `vtab-${tabId}`

    this.#tabs.set(tabId, { state: 'virtual', sessionId, targetId, url, title })
    this.#bySession.set(sessionId, tabId)
    this.#byTarget.set(targetId, tabId)

    this.#sendToRelay({
      method: 'forwardCDPEvent',
      params: {
        method: 'Extension.tabDiscovered',
        params: {
          sessionId,
          targetInfo: { targetId, type: 'page', title: title || '', url: url || '', attached: false },
        },
      },
    })
  }

  // ── Lazy Attach (on-demand physical attachment) ──

  async ensureAttached(tabId) {
    if (this.#cancelled.has(tabId)) {
      log.warn('ensureAttached: tab was cancelled by user', tabId)
      throw new Error(`User denied debugger permission for tab ${tabId}`)
    }
    const entry = this.#tabs.get(tabId)
    if (!entry) { log.warn('ensureAttached: tab not tracked', tabId); return false }
    if (entry.state === 'connected') return true
    if (entry.state === 'attaching') {
      const p = this.#pending.get(tabId)
      if (p) return p
    }

    const promise = this.#physicalAttach(tabId, entry)
    this.#pending.set(tabId, promise)
    try { return await promise } finally { this.#pending.delete(tabId) }
  }

  async #physicalAttach(tabId, entry) {
    const t0 = performance.now()
    if (this.#shuttingDown) return false
    entry.state = 'attaching'
    log.info('physicalAttach: begin', tabId)

    try {
      if (this.#shuttingDown) return false
      const { realTargetId } = await attachDebugger(tabId)

      // Guard: tab may have been removed by clearAll/detach while we were awaiting
      if (!this.#tabs.has(tabId)) {
        log.warn('physicalAttach: tab removed during attach, cleaning up', tabId)
        void detachDebugger(tabId)
        return false
      }

      if (realTargetId && realTargetId !== entry.targetId) {
        this.#byTarget.delete(entry.targetId)
        entry.targetId = realTargetId
        this.#byTarget.set(realTargetId, tabId)
      }

      entry.state = 'connected'
      this.#lastAttached = tabId

      this.#sendToRelay({
        method: 'forwardCDPEvent',
        params: {
          method: 'Target.attachedToTarget',
          params: {
            sessionId: entry.sessionId,
            targetInfo: {
              targetId: entry.targetId, type: 'page',
              title: entry.title || '', url: entry.url || '', attached: true,
            },
            waitingForDebugger: false,
          },
        },
      })

      log.info('physicalAttach: done', tabId, 'in', (performance.now() - t0).toFixed(1), 'ms')
      return true
    } catch (err) {
      log.warn('physicalAttach: failed', tabId, (performance.now() - t0).toFixed(1), 'ms', err)
      void detachDebugger(tabId)
      if (this.#tabs.has(tabId)) {
        this.#notifyRemoved(entry.sessionId)
        this.#removeEntry(tabId)
      }
      return false
    }
  }

  async attach(tabId) {
    if (this.#cancelled.has(tabId)) {
      log.warn('attach: tab was cancelled by user', tabId)
      return null
    }
    const existing = this.#tabs.get(tabId)
    if (existing?.state === 'connected') {
      log.debug('attach: already connected', tabId)
      return existing
    }

    const wasNew = !existing
    if (wasNew) {
      let url, title
      try {
        const tab = await chrome.tabs.get(tabId)
        url = tab.url; title = tab.title
      } catch { /* tab may have closed */ }
      const sessionId = `cb-tab-${++_sessionSeq}-${tabId}`
      const targetId = `vtab-${tabId}`
      this.#tabs.set(tabId, { state: 'virtual', sessionId, targetId, url, title })
      this.#bySession.set(sessionId, tabId)
      this.#byTarget.set(targetId, tabId)
    }

    const ok = await this.ensureAttached(tabId)
    if (!ok) {
      if (wasNew && this.#tabs.has(tabId)) this.#removeEntry(tabId)
      return null
    }

    const entry = this.#tabs.get(tabId)
    return entry ? { sessionId: entry.sessionId, targetId: entry.targetId } : null
  }

  // ── Detach ──

  async detach(tabId, reason) {
    const t0 = performance.now()
    const entry = this.#tabs.get(tabId)
    log.info('detach:', tabId, reason, 'state:', entry?.state)

    const wasPhysical = entry?.state === 'connected' || entry?.state === 'attaching'

    if (entry?.sessionId) {
      if (wasPhysical && entry.targetId) {
        this.#sendToRelay({
          method: 'forwardCDPEvent',
          params: {
            method: 'Target.detachedFromTarget',
            params: { sessionId: entry.sessionId, targetId: entry.targetId, reason },
          },
        })
      } else {
        this.#notifyRemoved(entry.sessionId)
      }
    }

    this.#removeEntry(tabId)

    if (wasPhysical) {
      await detachDebugger(tabId)
      log.debug('detach: chrome.debugger cleanup', tabId, (performance.now() - t0).toFixed(1), 'ms')
    }
  }

  clearAll() {
    const t0 = performance.now()
    this.#shuttingDown = true
    this.stopSessionIndicators()

    const physical = []
    for (const [tabId, entry] of this.#tabs) {
      if (entry.state === 'connected' || entry.state === 'attaching') {
        physical.push(tabId)
      }
    }

    log.info('clearAll:', this.#tabs.size, 'total,', physical.length, 'physically attached')

    this.#tabs.clear()
    this.#bySession.clear()
    this.#byTarget.clear()
    this.#childSession.clear()
    this.#childSets.clear()
    this.#pending.clear()
    this.#cancelled.clear()
    void chrome.storage.session.remove(CANCELLED_TABS_KEY).catch(() => {})
    this.#agentTabs.clear()
    this.#retainedCount = 0
    this.#group.reset()
    this.#lastAttached = null
    this.#indicators.clear()
    cleanupAllTabQueues()

    const settled = detachAll(physical)
    settled.then(() => {
      this.#shuttingDown = false
      log.info('clearAll: done in', (performance.now() - t0).toFixed(1), 'ms')
    })
    return settled
  }

  // ── Debugger event handlers ──

  onDebuggerEvent(source, method, params) {
    const tabId = source.tabId
    if (!tabId) return
    const tab = this.#tabs.get(tabId)
    if (!tab?.sessionId) return

    const result = interceptEvent(method, tabId, params, {
      childSession: this.#childSession,
      childSets: this.#childSets,
      log,
    })

    if (result.suppress) return

    this.#sendToRelay({
      method: 'forwardCDPEvent',
      params: { sessionId: source.sessionId || tab.sessionId, method, params },
    })
  }

  onDebuggerDetach(source, reason) {
    const tabId = source.tabId
    log.info('onDebuggerDetach:', tabId, reason, 'tracked:', this.#tabs.has(tabId))
    if (!tabId || !this.#tabs.has(tabId)) return
    void this.detach(tabId, reason)
  }

  // ── Private helpers ──

  #removeEntry(tabId) {
    const entry = this.#tabs.get(tabId)
    if (!entry) return
    if (entry.sessionId) this.#bySession.delete(entry.sessionId)
    if (entry.targetId) this.#byTarget.delete(entry.targetId)
    this.#tabs.delete(tabId)
    this.#indicators.removeTab(tabId)
    cleanupTabQueue(tabId)
    if (this.#lastAttached === tabId) this.#lastAttached = null

    const children = this.#childSets.get(tabId)
    if (children) {
      for (const sid of children) this.#childSession.delete(sid)
      this.#childSets.delete(tabId)
    }
  }

  #notifyRemoved(sessionId) {
    if (!sessionId) return
    this.#sendToRelay({
      method: 'forwardCDPEvent',
      params: { method: 'Extension.tabRemoved', params: { sessionId } },
    })
  }
}
