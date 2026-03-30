/**
 * Agent tab group management.
 *
 * Creates and manages a Chrome tab group labeled "Lime Agent"
 * to visually organize agent-controlled tabs.
 *
 * All addTab calls are serialized via a promise queue to prevent
 * concurrent calls from each creating separate tab groups.
 *
 * On reconnect, the manager attempts to find and reuse an existing
 * "Lime Agent" group rather than creating a duplicate.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('group')

export const TAB_GROUP_TITLE = 'Lime Agent'
const TAB_GROUP_COLOR = 'blue'

export class AgentGroupManager {
  /** @type {number|null} */
  #groupId = null
  /** @type {Promise<void>} serialization queue */
  #queue = Promise.resolve()

  get groupId() { return this.#groupId }

  reset() { this.#groupId = null }

  async addTab(tabId) {
    const done = this.#queue.then(() => this.#doAddTab(tabId))
    this.#queue = done.catch(() => {})
    return done
  }

  async #doAddTab(tabId) {
    try {
      if (this.#groupId !== null) {
        try {
          await chrome.tabGroups.get(this.#groupId)
        } catch {
          this.#groupId = null
        }
      }

      if (this.#groupId === null) {
        await this.#tryRecoverExistingGroup()
      }

      const groupId = await chrome.tabs.group({
        tabIds: [tabId],
        ...(this.#groupId !== null ? { groupId: this.#groupId } : {}),
      })

      if (this.#groupId === null || this.#groupId !== groupId) {
        this.#groupId = groupId
        await chrome.tabGroups.update(groupId, {
          title: TAB_GROUP_TITLE,
          color: TAB_GROUP_COLOR,
          collapsed: false,
        })
      }
    } catch (err) {
      log.warn('addTab: failed for tab', tabId, err)
    }
  }

  async #tryRecoverExistingGroup() {
    try {
      const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE })
      if (groups.length > 0) {
        this.#groupId = groups[0].id
        log.info('recovered existing group:', this.#groupId)
      }
    } catch {
      // chrome.tabGroups.query not available or no match
    }
  }

  /**
   * Dissolve the tab group: close agent-created tabs, ungroup the rest.
   *
   * @param {Set<number>} [agentTabIds] — tab IDs created by the agent.
   *   These will be closed (chrome.tabs.remove). Tabs NOT in this set
   *   are assumed to be user-owned and will only be ungrouped.
   *   If omitted, all tabs in the group are ungrouped without closing.
   *
   * Falls back to finding the group by title because clearAll() may have
   * already reset #groupId to null before this method is called.
   */
  async dissolve(agentTabIds) {
    let gid = this.#groupId
    this.#groupId = null
    log.info('dissolve: start, cached groupId =', gid, 'agentTabIds count =', agentTabIds?.size ?? 0)

    if (gid === null) {
      try {
        const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE })
        log.info('dissolve: query found', groups.length, 'groups')
        if (groups.length > 0) gid = groups[0].id
      } catch (err) {
        log.warn('dissolve: tabGroups.query failed:', err)
      }
    }

    if (gid === null) {
      log.info('dissolve: no group found, skipping')
      return
    }

    try {
      const tabs = await chrome.tabs.query({ groupId: gid })
      log.info('dissolve: group', gid, 'has', tabs.length, 'tabs')
      if (tabs.length === 0) {
        log.info('dissolved group:', gid, '(already empty)')
        return
      }

      const allIds = tabs.map((t) => t.id).filter((id) => id != null)
      const toClose = agentTabIds
        ? allIds.filter((id) => agentTabIds.has(id))
        : []
      const toUngroup = agentTabIds
        ? allIds.filter((id) => !agentTabIds.has(id))
        : allIds

      if (toClose.length > 0) {
        await chrome.tabs.remove(toClose)
        log.info('dissolve: closed', toClose.length, 'agent tabs')
      }
      if (toUngroup.length > 0) {
        await chrome.tabs.ungroup(toUngroup)
        log.info('dissolve: ungrouped', toUngroup.length, 'user tabs')
      }
      log.info('dissolved group:', gid, 'closed', toClose.length, 'ungrouped', toUngroup.length)
    } catch (err) {
      log.warn('dissolve: failed for group', gid, err)
    }
  }
}
