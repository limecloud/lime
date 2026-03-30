/**
 * Target.* CDP command handlers.
 *
 * Handles tab creation, closing, activation, and agent tab lifecycle
 * through Chrome extension APIs rather than raw CDP.
 *
 * @param {import('../tabs/manager.js').TabManager} mgr
 */

import { TARGET_CREATE_DELAY, DEFAULT_MAX_RETAINED_TABS } from './utils.js'

export function createTargetOps(mgr) {

  async function cdpCreateTarget(params) {
    const url = typeof params?.url === 'string' ? params.url : 'about:blank'
    const createInWindow = params?.createInWindow === true || params?.type === 'window'
    const retain = params?.retain === true
    const maxRetained = typeof params?.maxRetainedTabs === 'number' ? params.maxRetainedTabs : DEFAULT_MAX_RETAINED_TABS

    if (retain && mgr.retainedTabCount >= maxRetained) {
      throw new Error(`Cannot retain: already at max (${maxRetained}). Close retained tabs or set retain=false.`)
    }

    let tab
    if (createInWindow) {
      const win = await chrome.windows.create({ url, focused: false })
      tab = win.tabs?.[0]
      if (!tab?.id) throw new Error('Failed to create window')
    } else {
      tab = await chrome.tabs.create({ url, active: false })
      if (!tab.id) throw new Error('Failed to create tab')
    }
    mgr.markAgent(tab.id, retain)
    if (!createInWindow) {
      await mgr.addToAgentGroup(tab.id)
    }
    await new Promise((r) => setTimeout(r, TARGET_CREATE_DELAY))
    const attached = await mgr.attach(tab.id)
    if (!attached) {
      mgr.deleteAgent(tab.id)
      await chrome.tabs.remove(tab.id).catch(() => {})
      throw new Error('Failed to attach debugger to new tab')
    }
    return { targetId: attached.targetId, retained: retain }
  }

  async function cdpCloseTarget(params, fallbackTabId) {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toClose = target ? mgr.getByTargetId(target) : fallbackTabId
    if (!toClose) {
      return {
        success: false,
        error: target
          ? `Tab with targetId "${target}" not found. It may have already been closed or detached.`
          : 'No target specified and no fallback tab available.',
      }
    }
    if (!mgr.isAgent(toClose)) {
      return {
        success: false,
        error: 'Cannot close this tab: it was not created by the agent. Only tabs opened via action=open can be closed.',
      }
    }
    if (mgr.isRetained(toClose)) {
      return { success: true, skipped: true, reason: 'Tab is retained — close skipped.' }
    }
    mgr.deleteAgent(toClose)
    try {
      await chrome.tabs.remove(toClose)
      return { success: true }
    } catch (err) {
      return { success: false, error: `Failed to remove tab ${toClose}: ${err?.message || err}` }
    }
  }

  async function cdpCloseAllAgentTabs() {
    const toClose = []
    let retained = 0
    for (const [id] of mgr.agentTabs.entries()) {
      if (mgr.isRetained(id)) { retained++; continue }
      toClose.push(id)
    }
    const results = await Promise.allSettled(toClose.map((id) => chrome.tabs.remove(id)))
    for (let i = 0; i < toClose.length; i++) {
      if (results[i].status === 'fulfilled') mgr.deleteAgent(toClose[i])
    }
    const closed = results.filter((r) => r.status === 'fulfilled').length
    return { success: true, closed, retained }
  }

  async function cdpActivateTarget(params, fallbackTabId) {
    const target = typeof params?.targetId === 'string' ? params.targetId : ''
    const toActivate = target ? mgr.getByTargetId(target) : fallbackTabId
    if (!toActivate) return {}
    const tab = await chrome.tabs.get(toActivate).catch(() => null)
    if (!tab) return {}
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
    }
    await chrome.tabs.update(toActivate, { active: true }).catch(() => {})
    return {}
  }

  return { cdpCreateTarget, cdpCloseTarget, cdpCloseAllAgentTabs, cdpActivateTarget }
}
