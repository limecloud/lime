/**
 * Shared constants for the Lime Browser Bridge extension.
 */

export const DEFAULT_CONTROL_PORT = 9234
export const RELAY_PORT_OFFSET = 2

const MAX_CONTROL_PORT = 65535 - RELAY_PORT_OFFSET

export function clampPort(value) {
  const n = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_CONTROL_PORT) return DEFAULT_CONTROL_PORT
  return n
}

export function computeRelayPort(controlPort) {
  return clampPort(controlPort) + RELAY_PORT_OFFSET
}

export const RelayState = Object.freeze({
  DISABLED: 'disabled',
  UNCONFIGURED: 'unconfigured',
  DISCONNECTED: 'disconnected',
  CONNECTED: 'connected',
})

export const TabType = Object.freeze({
  USER: 'user',
  AGENT: 'agent',
  RETAINED: 'retained',
})

export const STATE_UI = {
  [RelayState.DISABLED]:     { dotColor: null,      title: 'Lime Browser Bridge — disabled' },
  [RelayState.UNCONFIGURED]: { dotColor: '#EF4444', title: 'Lime Browser Bridge — setup required' },
  [RelayState.DISCONNECTED]: { dotColor: '#F59E0B', title: 'Lime Browser Bridge — connecting…' },
  [RelayState.CONNECTED]:    { dotColor: '#22C55E', title: 'Lime Browser Bridge — connected' },
}

export const STATE_TEXT = {
  [RelayState.DISABLED]:     { label: 'Not Enabled', detail: 'Click the toggle or toolbar icon to enable.' },
  [RelayState.UNCONFIGURED]: { label: 'Setup Required', detail: 'Lime relay config is missing. Export the connector from Lime, or paste config in the toolbar popup.' },
  [RelayState.DISCONNECTED]: { label: 'Connecting…', detail: 'Relay is enabled. Trying to connect…' },
  [RelayState.CONNECTED]:    { label: 'Connected',   detail: 'Relay is active — agent can control your browser.' },
}

// ── Settings keys ──

export const SETTINGS_KEYS = Object.freeze({
  CLOSE_GROUP_ON_DISABLE: 'closeGroupOnDisable',
})

export async function getSetting(key, defaultValue = false) {
  const stored = await chrome.storage.local.get([key])
  return stored[key] ?? defaultValue
}

export async function setSetting(key, value) {
  await chrome.storage.local.set({ [key]: value })
}
