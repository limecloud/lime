/**
 * Session activity indicators — spinner animation & idle tab detection.
 *
 * Manages the visual "Lime Agent" tab-group spinner and automatically
 * detaches tabs that haven't received CDP commands for a configurable period.
 *
 * Timer strategy (MV3 compatible):
 *   - Spinner uses setInterval (200 ms). This is acceptable because the spinner
 *     only runs while the relay WS is connected, which keeps the SW alive.
 *     When the WS disconnects, stop() is called and the timer is cleared.
 *   - Idle check uses chrome.alarms (30 s) to survive SW suspension.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('indicators')

const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F']
const IDLE_DETACH_MS = 5 * 60 * 1000
const SPINNER_INTERVAL_MS = 200
const GROUP_TITLE = 'Lime Agent'

const ALARM_IDLE_CHECK = 'relayIdleCheck'

export class SessionIndicators {
  /** @type {number|null} */
  #spinnerTimer = null
  #spinnerIdx = 0
  /** @type {Map<number, number>} tabId → last CDP command timestamp */
  #lastCommandTime = new Map()

  /** @type {() => number|null} */
  #getGroupId
  /** @type {() => IterableIterator<[number, {state: string}]>} */
  #getTabEntries
  /** @type {(tabId: number, reason: string) => void} */
  #detachTab

  /**
   * @param {object} opts
   * @param {() => number|null} opts.getGroupId — returns current agent group ID
   * @param {() => IterableIterator<[number, {state: string}]>} opts.getTabEntries — returns iterable of [tabId, entry]
   * @param {(tabId: number, reason: string) => void} opts.detachTab — detach callback
   */
  constructor({ getGroupId, getTabEntries, detachTab }) {
    this.#getGroupId = getGroupId
    this.#getTabEntries = getTabEntries
    this.#detachTab = detachTab
  }

  trackCommand(tabId) {
    this.#lastCommandTime.set(tabId, Date.now())
  }

  removeTab(tabId) {
    this.#lastCommandTime.delete(tabId)
  }

  clear() {
    this.#lastCommandTime.clear()
  }

  start() {
    this.stop()
    this.#spinnerIdx = 0
    this.#spinnerTimer = setInterval(() => this.#tickSpinner(), SPINNER_INTERVAL_MS)
    // 30 s idle check via alarm (survives SW suspension)
    chrome.alarms.create(ALARM_IDLE_CHECK, { periodInMinutes: 0.5 })
  }

  stop() {
    if (this.#spinnerTimer) { clearInterval(this.#spinnerTimer); this.#spinnerTimer = null }
    chrome.alarms.clear(ALARM_IDLE_CHECK)
    this.#lastCommandTime.clear()
    this.#resetGroupTitle()
  }

  /**
   * Handle alarm events relevant to session indicators.
   * Called from background.js onAlarm listener.
   * Returns true if the alarm was handled.
   */
  handleAlarm(alarmName) {
    if (alarmName === ALARM_IDLE_CHECK) {
      this.#checkIdleTabs()
      return true
    }
    return false
  }

  #tickSpinner() {
    const groupId = this.#getGroupId()
    if (groupId === null) return
    const frame = SPINNER_FRAMES[this.#spinnerIdx % SPINNER_FRAMES.length]
    this.#spinnerIdx++
    chrome.tabGroups.update(groupId, { title: `${frame} ${GROUP_TITLE}` }).catch(() => {})
  }

  #resetGroupTitle() {
    const groupId = this.#getGroupId()
    if (groupId === null) return
    chrome.tabGroups.update(groupId, { title: GROUP_TITLE }).catch(() => {})
  }

  #checkIdleTabs() {
    const now = Date.now()
    const toDetach = []
    for (const [tabId, entry] of this.#getTabEntries()) {
      if (entry.state !== 'connected') continue
      const lastCmd = this.#lastCommandTime.get(tabId)
      if (lastCmd === undefined) continue // never received CDP command, skip (avoid false idle detach)
      if (now - lastCmd > IDLE_DETACH_MS) toDetach.push(tabId)
    }
    for (const tabId of toDetach) {
      log.info('idle timeout: detaching tab', tabId, 'after', IDLE_DETACH_MS / 1000, 's')
      this.#detachTab(tabId, 'idle_timeout')
    }
  }
}
