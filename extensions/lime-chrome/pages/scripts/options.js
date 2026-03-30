import { RelayState, STATE_TEXT, RELAY_PORT_OFFSET, clampPort, computeRelayPort, SETTINGS_KEYS, getSetting, setSetting } from '../../lib/constants.js'

// ── DOM refs ──

const statusCard = document.getElementById('status-card')
const statusLabel = document.getElementById('status-label')
const statusMeta = document.getElementById('status-meta')
const statusDetail = document.getElementById('status-detail')
const tabStats = document.getElementById('tab-stats')
const relayToggle = document.getElementById('relay-toggle')
const portInput = document.getElementById('port')
const portStatus = document.getElementById('port-status')

// ── Status rendering ──

let _lastStatusJson = ''

function renderStatus(status) {
  const key = JSON.stringify(status ?? null)
  if (key === _lastStatusJson) return
  _lastStatusJson = key
  const state = status?.state || RelayState.DISABLED
  const cfg = STATE_TEXT[state] || STATE_TEXT[RelayState.DISABLED]

  statusCard.dataset.state = state
  statusLabel.textContent = cfg.label
  statusDetail.textContent = cfg.detail

  if (!toggleBusy) {
    relayToggle.checked = state !== RelayState.DISABLED
  }

  const metaParts = []
  if (typeof status?.observerConnected === 'boolean') {
    metaParts.push(`observer ${status.observerConnected ? 'on' : 'off'}`)
  }
  if (typeof status?.controlConnected === 'boolean') {
    metaParts.push(`control ${status.controlConnected ? 'on' : 'off'}`)
  }
  if (Array.isArray(status?.debuggerTabs)) {
    metaParts.push(`debugger ${status.debuggerTabs.length}`)
  }
  statusMeta.textContent = metaParts.join(' · ')

  tabStats.textContent = ''
  if (status?.attachedTabs > 0) {
    const chip = document.createElement('span')
    chip.className = 'tab-chip tab-chip-tabs'
    chip.textContent = `${status.attachedTabs} ${status.attachedTabs === 1 ? 'tab' : 'tabs'}`
    tabStats.appendChild(chip)
  }
  if (status?.agentTabs > 0) {
    const nonRetained = status.agentTabs - (status.retainedTabs || 0)
    if (nonRetained > 0) {
      const chip = document.createElement('span')
      chip.className = 'tab-chip tab-chip-agent'
      chip.textContent = `${nonRetained} agent`
      tabStats.appendChild(chip)
    }
    if (status.retainedTabs > 0) {
      const chip = document.createElement('span')
      chip.className = 'tab-chip tab-chip-retained'
      chip.textContent = `${status.retainedTabs} retained`
      tabStats.appendChild(chip)
    }
  }
  if (status?.lastError) {
    const chip = document.createElement('span')
    chip.className = 'tab-chip tab-chip-agent'
    chip.textContent = String(status.lastError)
    tabStats.appendChild(chip)
  }
  if (status?.controlLastError) {
    const chip = document.createElement('span')
    chip.className = 'tab-chip tab-chip-retained'
    chip.textContent = String(status.controlLastError)
    tabStats.appendChild(chip)
  }
}

async function queryBackgroundStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: 'getRelayStatus' })
    if (!status) {
      renderStatus(null)
      return
    }
    renderStatus(status)
  } catch {
    renderStatus(null)
  }
}

// ── Toggle handler ──

let toggleBusy = false

relayToggle.addEventListener('change', async () => {
  if (toggleBusy) return
  toggleBusy = true
  try {
    await chrome.runtime.sendMessage({ type: 'toggleRelay' })
    await queryBackgroundStatus()
  } catch (err) {
    console.warn('[lime-options] toggle failed:', err)
  } finally {
    toggleBusy = false
  }
})

// ── Port settings ──

function setPortStatus(kind, message) {
  portStatus.dataset.kind = kind || ''
  portStatus.textContent = message || ''
}

async function checkPort(controlPort) {
  const port = computeRelayPort(controlPort)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD', signal: AbortSignal.timeout(900) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    setPortStatus('ok', `Relay reachable at :${port}`)
  } catch {
    setPortStatus('error', `Relay not reachable at :${port}`)
  }
}

async function loadPort() {
  const stored = await chrome.storage.local.get(['controlPort', 'relayPort'])
  const fromRelay =
    stored.relayPort != null
      ? Number.parseInt(String(stored.relayPort), 10) - RELAY_PORT_OFFSET
      : undefined
  const port = clampPort(Number.isFinite(fromRelay) ? fromRelay : stored.controlPort)
  portInput.value = String(port)
}

async function savePort() {
  const port = clampPort(portInput.value)
  await chrome.storage.local.set({ controlPort: port })
  portInput.value = String(port)
  await checkPort(port)
}

document.getElementById('save').addEventListener('click', () => void savePort())

// ── Tab list ──

const tabsSection = document.getElementById('tabs-section')
const tabsList = document.getElementById('tabs-list')

async function refreshTabList() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getTabList' })
    const tabs = resp?.tabs || []
    tabs.sort((a, b) => {
      const rank = (t) => t.isRetained ? 0 : t.isAgent ? 1 : 2
      return rank(a) - rank(b)
    })
    tabsSection.style.display = tabs.length > 0 ? '' : 'none'
    tabsList.innerHTML = ''
    for (const t of tabs) {
      const row = document.createElement('div')
      row.className = 'tab-entry'
      row.style.cursor = 'pointer'
      row.addEventListener('click', () => {
        chrome.tabs.update(t.tabId, { active: true })
        chrome.tabs.get(t.tabId, (tab) => {
          if (tab?.windowId) chrome.windows.update(tab.windowId, { focused: true })
        })
      })

      const dot = document.createElement('span')
      dot.className = 'tab-entry-state'
      dot.dataset.state = t.state
      dot.title = t.state

      const title = document.createElement('span')
      title.className = 'tab-entry-title'
      title.textContent = t.title || `Tab ${t.tabId}`

      const url = document.createElement('span')
      url.className = 'tab-entry-url'
      url.textContent = t.url || ''

      row.append(dot, title, url)

      if (t.isRetained) {
        const badge = document.createElement('span')
        badge.className = 'tab-entry-badge'
        badge.dataset.type = 'retained'
        badge.textContent = 'retained'
        row.appendChild(badge)
      } else if (t.isAgent) {
        const badge = document.createElement('span')
        badge.className = 'tab-entry-badge'
        badge.dataset.type = 'agent'
        badge.textContent = 'agent'
        row.appendChild(badge)
      }

      tabsList.appendChild(row)
    }
  } catch { /* background not ready */ }
}

// ── Logs viewer ──

const logsContainer = document.getElementById('logs-container')
const logsRefresh = document.getElementById('logs-refresh')

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function refreshLogs() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getLogs', limit: 100 })
    const logs = resp?.logs || []
    if (logs.length === 0) {
      logsContainer.innerHTML = '<div class="logs-empty">No log entries yet</div>'
      return
    }
    logsContainer.innerHTML = ''
    for (const entry of logs) {
      const row = document.createElement('div')
      row.className = 'log-row'

      const time = document.createElement('span')
      time.className = 'log-time'
      time.textContent = formatTime(entry.ts)

      const dir = document.createElement('span')
      dir.className = 'log-dir'
      dir.dataset.dir = entry.dir
      dir.textContent = entry.dir

      const method = document.createElement('span')
      method.className = 'log-method'
      method.textContent = entry.method || ''

      const detail = document.createElement('span')
      detail.className = 'log-detail'
      detail.textContent = entry.detail || ''

      row.append(time, dir, method, detail)
      logsContainer.appendChild(row)
    }
    logsContainer.scrollTop = logsContainer.scrollHeight
  } catch { /* background not ready */ }
}

logsRefresh.addEventListener('click', () => void refreshLogs())

// ── Event-driven status updates ──

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('relayEnabled' in changes || 'controlPort' in changes || '_relayState' in changes)) {
    void queryBackgroundStatus()
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void queryBackgroundStatus()
    void refreshTabList()
  }
})

// Fallback poll for state transitions not reflected in storage (connect/disconnect)
const FALLBACK_POLL_MS = 2000
setInterval(() => {
  void queryBackgroundStatus()
  void refreshTabList()
}, FALLBACK_POLL_MS)

// ── Close group on disable setting ──

const closeGroupToggle = document.getElementById('closeGroupOnDisable')

async function loadCloseGroupSetting() {
  closeGroupToggle.checked = await getSetting(SETTINGS_KEYS.CLOSE_GROUP_ON_DISABLE, false)
}

closeGroupToggle.addEventListener('change', () => {
  void setSetting(SETTINGS_KEYS.CLOSE_GROUP_ON_DISABLE, closeGroupToggle.checked)
})

// ── Init ──

void loadPort()
void loadCloseGroupSetting()
void queryBackgroundStatus()
void refreshTabList()
void refreshLogs()
