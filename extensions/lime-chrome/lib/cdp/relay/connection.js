/**
 * Relay connection management.
 *
 * 3-state model:
 *   disabled     — relay off, badge empty
 *   disconnected — relay enabled but WS not open, badge …, auto-reconnecting
 *   connected    — relay enabled + WS open, badge ON
 *
 * Timer strategy (MV3 compatible):
 *   All deferred work uses chrome.alarms instead of setTimeout/setInterval
 *   so that timers survive Service Worker suspension.
 *
 *   Alarm names:
 *     relayKeepAlive        — 1-min heartbeat, created when relay is enabled
 *     relayReconnect        — exponential-backoff reconnect delay
 *     relayDisconnectNotify — delayed disconnect notification (5 s)
 */

import { RelayState, STATE_UI, DEFAULT_CONTROL_PORT, RELAY_PORT_OFFSET, clampPort, computeRelayPort } from '../../constants.js'
import { setIconWithDot } from '../../icon-badge.js'
import { createLogger } from '../../logger.js'

const log = createLogger('relay')

const WS_CONNECT_TIMEOUT = 5000
const PREFLIGHT_TIMEOUT = 2000
const DISCONNECT_NOTIFY_DELAY_MIN = 5 / 60 // 5 seconds in minutes (chrome.alarms minimum granularity is ~1 s via delayInMinutes)

// ── Alarm names (centralized) ──

const ALARM_KEEP_ALIVE = 'relayKeepAlive'
const ALARM_RECONNECT = 'relayReconnect'
const ALARM_DISCONNECT_NOTIFY = 'relayDisconnectNotify'

// ── Operation log ring buffer (O(1) push, O(n) read) ──
const LOG_BUFFER_MAX = 200
const _logRing = new Array(LOG_BUFFER_MAX)
let _logHead = 0   // next write position
let _logCount = 0   // total entries written (clamped to max)

function pushLog(direction, method, detail) {
  _logRing[_logHead] = { ts: Date.now(), dir: direction, method, detail }
  _logHead = (_logHead + 1) % LOG_BUFFER_MAX
  if (_logCount < LOG_BUFFER_MAX) _logCount++
}

export function getLogBuffer(limit = 100) {
  const n = Math.min(limit, _logCount)
  const result = new Array(n)
  // read oldest-first: start = (head - count) mod max, then advance
  let idx = (_logHead - _logCount + LOG_BUFFER_MAX) % LOG_BUFFER_MAX
  const skip = _logCount - n
  idx = (idx + skip) % LOG_BUFFER_MAX
  for (let i = 0; i < n; i++) {
    result[i] = _logRing[idx]
    idx = (idx + 1) % LOG_BUFFER_MAX
  }
  return result
}

// ── State model ──

let _state = RelayState.DISABLED

function setState(newState) {
  _state = newState
  const ui = STATE_UI[newState]
  void setIconWithDot(ui.dotColor).catch(() => {})
  void chrome.action.setTitle({ title: ui.title })
  void chrome.storage.local.set({ _relayState: newState })
}

export function getRelayState() {
  return _state
}

// ── Notifications ──

function notifyError(title, message) {
  chrome.notifications.create('accio-relay-error', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Lime Bridge: ${title}`,
    message,
    priority: 2,
  }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[lime-relay] notification create failed:', chrome.runtime.lastError.message)
    }
  })
}

// ── Port helpers ──

async function getControlPort() {
  const stored = await chrome.storage.local.get(['controlPort', 'relayPort'])
  const raw = Number.parseInt(String(stored.controlPort || ''), 10)
  if (Number.isFinite(raw) && raw > 0 && raw <= 65535) return raw
  const relayRaw = Number.parseInt(String(stored.relayPort || ''), 10)
  if (Number.isFinite(relayRaw) && relayRaw > 0 && relayRaw <= 65535) {
    const inferred = clampPort(relayRaw - RELAY_PORT_OFFSET)
    void chrome.storage.local.set({ controlPort: inferred })
    return inferred
  }
  return DEFAULT_CONTROL_PORT
}

async function getRelayPort() {
  return computeRelayPort(await getControlPort())
}

// ── Relay enabled persistence ──

export async function setRelayEnabled(enabled) {
  await chrome.storage.local.set({ relayEnabled: enabled })
}

export async function isRelayEnabled() {
  const stored = await chrome.storage.local.get(['relayEnabled'])
  return stored.relayEnabled === true
}

// ── Connection state ──

/** @type {WebSocket|null} */
let relayWs = null
/** @type {Promise<void>|null} */
let relayConnectPromise = null
/** @type {AbortController|null} */
let connectAbortCtrl = null

let reconnectAttempt = 0

/**
 * Callbacks injected by background.js at init time.
 *
 * onShutdown(reason) merges the old onClosed + onDisabled into a single
 * atomic callback so callers can handle group dissolution and tab cleanup
 * in one place, avoiding ordering bugs.
 *
 * @type {{ onMessage: (msg: any) => Promise<any>, onShutdown: (reason: 'connectionLost'|'disabled') => Promise<any>|void, onConnected: () => void, installDebuggerListeners: () => void }}
 */
let callbacks = {
  onMessage: async () => null,
  onShutdown: async (_reason) => {},
  onConnected: () => {},
  installDebuggerListeners: () => {},
}

export function initRelay(cbs) {
  callbacks = { ...callbacks, ...cbs }
}

// ── Derived state queries ──

export function isRelayConnected() {
  return relayWs !== null && relayWs.readyState === WebSocket.OPEN
}

export function isRelayActive() {
  return isRelayConnected() || relayConnectPromise !== null ||
    (relayWs !== null && relayWs.readyState === WebSocket.CONNECTING)
}

export function isReconnecting() {
  return _reconnectPending
}

// ── Messaging ──

export function sendToRelay(payload) {
  const ws = relayWs
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Relay not connected')
  }
  pushLog('↑', payload.method || `id:${payload.id}`, payload.params?.method || payload.error || '')
  ws.send(JSON.stringify(payload))
}

export function trySendToRelay(payload) {
  try {
    sendToRelay(payload)
  } catch (err) {
    console.debug('[lime-relay] trySendToRelay failed:', err)
  }
}

// ── Alarm-based timer management ──

/**
 * Ensure the keep-alive alarm exists. Safe to call multiple times —
 * chrome.alarms.create with the same name replaces the previous alarm.
 */
export function ensureKeepAliveAlarm() {
  chrome.alarms.create(ALARM_KEEP_ALIVE, { periodInMinutes: 1 })
}

function clearKeepAliveAlarm() {
  chrome.alarms.clear(ALARM_KEEP_ALIVE)
}

let _reconnectPending = false

function cancelReconnect() {
  _reconnectPending = false
  chrome.alarms.clear(ALARM_RECONNECT)
}

function cancelDisconnectNotify() {
  chrome.alarms.clear(ALARM_DISCONNECT_NOTIFY)
}

function scheduleReconnect() {
  if (_reconnectPending) return
  const baseMs = 500
  const maxMs = 30_000
  const baseDelay = Math.min(maxMs, baseMs * Math.pow(2, reconnectAttempt))
  let delay = baseDelay + Math.floor(Math.random() * Math.min(baseDelay, 1000))
  if (!Number.isFinite(delay) || delay < baseMs) delay = baseMs
  reconnectAttempt++
  _reconnectPending = true
  // chrome.alarms minimum delay is ~1 second; convert ms → minutes
  const delayInMinutes = Math.max(delay / 60_000, 1 / 60)
  chrome.alarms.create(ALARM_RECONNECT, { delayInMinutes })
}

/**
 * Handle alarm events relevant to relay connection.
 * Called from background.js onAlarm listener.
 * Returns true if the alarm was handled.
 */
export function handleConnectionAlarm(alarmName) {
  if (alarmName === ALARM_RECONNECT) {
    _reconnectPending = false
    // connectAndAttach auto-schedules reconnect on failure
    void connectAndAttach()
    return true
  }

  if (alarmName === ALARM_DISCONNECT_NOTIFY) {
    if (_state === RelayState.DISCONNECTED) {
      notifyError('Disconnected', 'Relay connection lost. Auto-reconnecting…')
    }
    return true
  }

  return false
}

// ── WebSocket connection ──

let debuggerListenersInstalled = false

async function ensureConnection() {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) return
  if (relayConnectPromise) return await relayConnectPromise

  const currentAbortCtrl = new AbortController()
  connectAbortCtrl = currentAbortCtrl
  const { signal } = currentAbortCtrl

  // Assign immediately so concurrent callers see the in-flight promise (avoids race)
  relayConnectPromise = (async () => {
    const port = await getRelayPort()
    const httpBase = `http://127.0.0.1:${port}`
    const wsUrl = `ws://127.0.0.1:${port}/extension`

    const preflightCtrl = new AbortController()
    const preflightTimer = setTimeout(() => preflightCtrl.abort(), PREFLIGHT_TIMEOUT)
    if (signal) signal.addEventListener('abort', () => preflightCtrl.abort(), { once: true })
    try {
      await fetch(`${httpBase}/`, { method: 'HEAD', signal: preflightCtrl.signal })
        .catch((err) => {
          if (signal.aborted) throw new Error('Connection cancelled')
          throw new Error(`Relay server not reachable at ${httpBase} (${String(err)})`)
        })
    } finally {
      clearTimeout(preflightTimer)
    }

    if (signal.aborted) throw new Error('Connection cancelled')

    const ws = new WebSocket(wsUrl)

    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), WS_CONNECT_TIMEOUT)
        const cleanup = () => { clearTimeout(t); signal.removeEventListener('abort', onAbort) }
        const onAbort = () => { cleanup(); reject(new Error('Connection cancelled')) }
        signal.addEventListener('abort', onAbort, { once: true })
        ws.onopen = () => { cleanup(); resolve() }
        ws.onerror = () => { cleanup(); reject(new Error('WebSocket connect failed')) }
        ws.onclose = (ev) => { cleanup(); reject(new Error(`WebSocket closed (${ev.code} ${ev.reason || 'no reason'})`)) }
      })
    } catch (err) {
      try { ws.close() } catch { /* already closing */ }
      throw err
    }

    if (signal.aborted) {
      try { ws.close() } catch { /* noop */ }
      throw new Error('Connection cancelled')
    }

    relayWs = ws
    ws.onmessage = (event) => void onRelayMessage(String(event.data || ''))
    ws.onclose = () => { if (relayWs === ws) onRelayClosed('closed') }
    ws.onerror = () => { if (relayWs === ws) onRelayClosed('error') }

    if (!debuggerListenersInstalled) {
      debuggerListenersInstalled = true
      callbacks.installDebuggerListeners()
    }
  })()

  try {
    await relayConnectPromise
  } finally {
    if (connectAbortCtrl === currentAbortCtrl) connectAbortCtrl = null
    relayConnectPromise = null
  }
}

function onRelayClosed(reason) {
  log.info('onRelayClosed:', reason)
  relayWs = null

  void Promise.resolve(callbacks.onShutdown('connectionLost')).catch((err) => {
    log.warn('onRelayClosed: onShutdown error:', err)
  })

  setState(RelayState.DISCONNECTED)

  cancelDisconnectNotify()
  chrome.alarms.create(ALARM_DISCONNECT_NOTIFY, { delayInMinutes: DISCONNECT_NOTIFY_DELAY_MIN })

  void (async () => {
    if (await isRelayEnabled()) scheduleReconnect()
  })()
}

async function onRelayMessage(text) {
  /** @type {any} */
  let msg
  try {
    msg = JSON.parse(text)
  } catch {
    return
  }

  if (msg?.method === 'ping') {
    trySendToRelay({ method: 'pong' })
    return
  }

  const MESSAGE_EXPIRE_MS = 130_000
  if (typeof msg?.ts === 'number') {
    const age = Date.now() - msg.ts
    if (age > MESSAGE_EXPIRE_MS) {
      log.warn('dropping expired message:', msg.method || msg.id, 'age:', age, 'ms')
      if (typeof msg.id === 'number') {
        trySendToRelay({ id: msg.id, error: `Message expired (age ${age}ms > ${MESSAGE_EXPIRE_MS}ms)` })
      }
      return
    }
  }

  if (typeof msg?.id === 'number' && msg.method === 'forwardCDPCommand') {
    const cdpMethod = msg.params?.method || ''
    pushLog('↓', msg.method, cdpMethod)
    try {
      const result = await callbacks.onMessage(msg)
      trySendToRelay({ id: msg.id, result })
    } catch (err) {
      trySendToRelay({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

// ── Public lifecycle methods ──

/**
 * Attempt to connect. On failure, automatically schedules reconnect
 * if relay is still enabled — callers do NOT need to call scheduleReconnect.
 */
export async function connectAndAttach() {
  const t0 = performance.now()
  log.debug('connectAndAttach: begin, connected:', isRelayConnected())
  if (isRelayConnected()) return true
  if (!(await isRelayEnabled())) { log.debug('connectAndAttach: relay not enabled'); return false }
  try {
    await ensureConnection()
    log.info('connectAndAttach: connected in', (performance.now() - t0).toFixed(1), 'ms')
    cancelDisconnectNotify()
    setState(RelayState.CONNECTED)
    reconnectAttempt = 0
    void callbacks.onConnected()
    return true
  } catch (err) {
    log.warn('connectAndAttach: failed in', (performance.now() - t0).toFixed(1), 'ms', err)
    if (await isRelayEnabled()) scheduleReconnect()
    return false
  }
}

/**
 * Disable relay: close WS, cancel timers, set state to disabled.
 *
 * The sync neutralization block (relayWs = null, cancel timers, abort connect)
 * runs BEFORE any await so that isRelayConnected() returns false immediately.
 *
 * onShutdown('disabled') handles both group dissolution and tab cleanup
 * atomically — the callback decides internally what to do based on the reason.
 */
export async function disconnect() {
  const t0 = performance.now()
  log.info('disconnect: begin, current state:', _state, 'ws:', relayWs ? 'open' : 'null')

  const wsToClose = relayWs
  relayWs = null

  cancelReconnect()
  reconnectAttempt = 0
  cancelDisconnectNotify()
  clearKeepAliveAlarm()

  if (connectAbortCtrl) {
    connectAbortCtrl.abort()
    connectAbortCtrl = null
  }
  relayConnectPromise = null

  if (wsToClose) {
    log.debug('disconnect: closing WebSocket')
    try { wsToClose.close() } catch { /* ignore */ }
  }

  log.debug('disconnect: awaiting storage write + shutdown...')
  await Promise.all([
    setRelayEnabled(false),
    Promise.resolve(callbacks.onShutdown('disabled')).catch((err) => {
      log.warn('disconnect: onShutdown(disabled) failed:', err)
    }),
  ])

  log.info('disconnect: done in', (performance.now() - t0).toFixed(1), 'ms')

  setState(RelayState.DISABLED)
}

export async function toggle() {
  const t0 = performance.now()
  if (_state !== RelayState.DISABLED) {
    await disconnect()
    log.info('toggle: disconnect done in', (performance.now() - t0).toFixed(1), 'ms')
    return
  }

  await setRelayEnabled(true)
  ensureKeepAliveAlarm()
  setState(RelayState.DISCONNECTED)

  try {
    cancelReconnect()
    await ensureConnection()
    cancelDisconnectNotify()
    setState(RelayState.CONNECTED)
    void callbacks.onConnected()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('cancelled')) return
    console.warn('[lime-relay] initial connect failed:', message)
    notifyError('Connection Failed', `${message}\n\nRetrying automatically…`)
    scheduleReconnect()
  }
}

export async function initFromStorage() {
  if (await isRelayEnabled()) {
    ensureKeepAliveAlarm()
    setState(RelayState.DISCONNECTED)
  }
}


