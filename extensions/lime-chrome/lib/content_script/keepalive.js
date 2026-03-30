/**
 * MV3 Service Worker keepalive mechanism.
 *
 * Two-layer keepalive strategy to prevent the Service Worker from being suspended:
 *
 * Layer 1: chrome.alarms (already implemented in background.js)
 *   - "relayKeepAlive" alarm fires every 15 seconds
 *   - Sends ping to relay server if connected
 *
 * Layer 2: Content Script heartbeat (this module)
 *   - Injected into the active tab periodically
 *   - Establishes a long-lived port connection with the background
 *   - Sends ping every 20 seconds
 *   - Auto-reconnects on disconnect
 *
 * Usage: Call startKeepAlive(tabId) when a session is active,
 * stopKeepAlive(tabId) when done. Not wired into dispatch — called
 * directly from background.js when needed.
 */

const HEARTBEAT_INTERVAL_MS = 20_000
const PORT_NAME = 'accio-keepalive'

const activeKeepAlives = new Map()

export async function startKeepAlive(tabId) {
  if (activeKeepAlives.has(tabId)) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (portName, interval) => {
        if (window._accioKeepAlive) return

        function connect() {
          try {
            const port = chrome.runtime.connect({ name: portName })
            const timer = setInterval(() => {
              try { port.postMessage({ type: 'ping' }) } catch { clearInterval(timer) }
            }, interval)
            port.onDisconnect.addListener(() => {
              clearInterval(timer)
              setTimeout(connect, 1000)
            })
            window._accioKeepAlive = { port, timer }
          } catch { /* extension context invalidated */ }
        }

        connect()
      },
      args: [PORT_NAME, HEARTBEAT_INTERVAL_MS],
    })
    activeKeepAlives.set(tabId, true)
  } catch { /* tab may be restricted */ }
}

export async function stopKeepAlive(tabId) {
  if (!activeKeepAlives.has(tabId)) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window._accioKeepAlive) {
          clearInterval(window._accioKeepAlive.timer)
          try { window._accioKeepAlive.port.disconnect() } catch { /* noop */ }
          window._accioKeepAlive = null
        }
      },
    })
  } catch { /* tab may have closed */ }

  activeKeepAlives.delete(tabId)
}

/**
 * Register the keepalive port listener in the background script.
 * Call this once during initialization.
 */
export function registerKeepAliveListener() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return
    port.onMessage.addListener((msg) => {
      if (msg?.type === 'ping') {
        try { port.postMessage({ type: 'pong' }) } catch { /* port closed */ }
      }
    })
  })
}
