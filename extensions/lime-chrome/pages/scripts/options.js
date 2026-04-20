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
const languageSelect = document.getElementById('language-select')

const LANGUAGE_STORAGE_KEY = 'optionsLanguage'
const SUPPORTED_LANGUAGES = ['en', 'zh']
const OPTIONS_TRANSLATIONS = {
  en: {
    title: 'Lime Browser Bridge',
    page_title_text: 'Lime Browser Bridge',
    page_subtitle: 'Connect your browser to Lime.',
    language_label: 'Language',
    section_attached_tabs: 'Attached Tabs',
    tabs_empty: 'No tabs attached',
    section_quick_start: 'Quick Start',
    quick_start_1: 'Make sure <strong>Lime</strong> is running with browser control enabled.',
    quick_start_2: 'The relay connects automatically — a green dot on the icon means ready.',
    quick_start_3: 'Ask Lime a browser-related question — it can now see and control your tabs.',
    section_how_it_works: 'How It Works',
    how_always_on_title: 'Always-on relay',
    how_always_on_body: 'The relay is enabled by default and connects automatically when Lime is running. Use the toggle above to pause if needed. Agent-opened tabs are grouped under an <strong>"Lime Agent"</strong> tab group.',
    how_auto_reconnect_title: 'Auto-reconnect',
    how_auto_reconnect_body: 'If the connection drops, the extension reconnects automatically. No manual intervention needed.',
    how_tab_safety_title: 'Tab safety',
    how_tab_safety_body: 'Your existing tabs are protected — the agent can only close tabs it opened. Personal tabs are never affected.',
    section_status_indicators: 'Status Indicators',
    indicator_connected: 'Connected — agent can control your tabs',
    indicator_setup_required: 'Setup required — sync config from Lime or paste config in the toolbar popup',
    indicator_connecting: 'Connecting / reconnecting to local relay server',
    indicator_disabled: 'Relay disabled — no indicator',
    section_troubleshooting: 'Troubleshooting',
    troubleshooting_setup_title: 'Shows setup required',
    troubleshooting_setup_body: 'This extension does not have <code>serverUrl</code> / <code>bridgeKey</code> yet. Load the exported <code>Lime Browser Connector</code> folder from Lime, or open the toolbar popup and paste the config copied from Lime.',
    troubleshooting_connecting_title: 'Stays on yellow dot (connecting)',
    troubleshooting_connecting_body: 'Relay server not reachable. Ensure Lime is running with browser control enabled.',
    troubleshooting_pages_title: 'Pages not responding',
    troubleshooting_pages_body: 'Internal Chrome pages (<code>chrome://</code>) cannot be controlled. Navigate to a regular webpage.',
    section_settings: 'Settings',
    settings_tab_group_title: 'Tab Group Behavior',
    settings_tab_group_label: 'Close "Lime Agent" tab group when relay is disabled',
    settings_control_port_title: 'Control Port',
    settings_control_port_body: 'Only change if you use a custom port in Lime config.',
    settings_control_port_hint: 'Default: <code>9234</code>. Relay = control port + 2.',
    settings_save: 'Save',
    settings_logs_title: 'CDP Logs',
    settings_logs_refresh: 'Refresh',
    logs_empty: 'No log entries yet',
    state_disabled_label: 'Not Enabled',
    state_disabled_detail: 'Click the toggle or toolbar icon to enable.',
    state_unconfigured_label: 'Setup Required',
    state_unconfigured_detail: 'Lime relay config is missing. Export the connector from Lime, or paste config in the toolbar popup.',
    state_disconnected_label: 'Connecting…',
    state_disconnected_detail: 'Relay is enabled. Trying to connect…',
    state_connected_label: 'Connected',
    state_connected_detail: 'Relay is active — agent can control your browser.',
    meta_config_missing: 'config missing',
    meta_observer_on: 'observer on',
    meta_observer_off: 'observer off',
    meta_control_on: 'control on',
    meta_control_off: 'control off',
    meta_debugger_count: 'debugger {count}',
    unconfigured_chip: 'Load the exported Lime Browser Connector folder or paste config in the toolbar popup.',
    attached_tabs_one: '{count} tab',
    attached_tabs_other: '{count} tabs',
    agent_tabs: '{count} agent',
    retained_tabs: '{count} retained',
    badge_agent: 'agent',
    badge_retained: 'retained',
    port_ok: 'Relay reachable at :{port}',
    port_error: 'Relay not reachable at :{port}',
  },
  zh: {
    title: 'Lime 浏览器桥接',
    page_title_text: 'Lime 浏览器桥接',
    page_subtitle: '把你的浏览器连接到 Lime。',
    language_label: '语言',
    section_attached_tabs: '已附着标签页',
    tabs_empty: '当前没有附着标签页',
    section_quick_start: '快速开始',
    quick_start_1: '确认 <strong>Lime</strong> 已启动，并且已经开启浏览器控制。',
    quick_start_2: 'Relay 会自动连接，图标变成绿色表示就绪。',
    quick_start_3: '直接向 Lime 提一个浏览器相关问题，它现在就能看到并控制你的标签页。',
    section_how_it_works: '工作方式',
    how_always_on_title: '常驻 Relay',
    how_always_on_body: 'Relay 默认启用，只要 Lime 正在运行就会自动连接。需要暂停时再用上方开关关闭。代理新开的标签页会被归到 <strong>“Lime Agent”</strong> 标签组里。',
    how_auto_reconnect_title: '自动重连',
    how_auto_reconnect_body: '连接中断后，扩展会自动重连，不需要手动干预。',
    how_tab_safety_title: '标签页安全',
    how_tab_safety_body: '你已有的标签页会被保护起来，代理只能关闭自己创建的标签页，个人标签页不会被影响。',
    section_status_indicators: '状态说明',
    indicator_connected: '已连接，代理可以控制你的标签页',
    indicator_setup_required: '需要先完成配置，请从 Lime 同步配置或在工具栏弹窗里粘贴配置',
    indicator_connecting: '正在连接或重连本地 Relay 服务',
    indicator_disabled: 'Relay 已关闭，不显示状态点',
    section_troubleshooting: '故障排查',
    troubleshooting_setup_title: '显示需要配置',
    troubleshooting_setup_body: '当前扩展还没有拿到 <code>serverUrl</code> / <code>bridgeKey</code>。请从 Lime 加载导出的 <code>Lime Browser Connector</code> 目录，或者打开工具栏弹窗，粘贴从 Lime 复制的配置。',
    troubleshooting_connecting_title: '一直停在黄色状态点',
    troubleshooting_connecting_body: '说明 Relay 服务不可达。请确认 Lime 已启动，并开启了浏览器控制。',
    troubleshooting_pages_title: '页面无法响应',
    troubleshooting_pages_body: '内部 Chrome 页面（<code>chrome://</code>）不能被控制。请切换到普通网页后再试。',
    section_settings: '设置',
    settings_tab_group_title: '标签组行为',
    settings_tab_group_label: '关闭 Relay 时一并关闭 “Lime Agent” 标签组',
    settings_control_port_title: '控制端口',
    settings_control_port_body: '只有在你给 Lime 配了自定义端口时才需要修改。',
    settings_control_port_hint: '默认：<code>9234</code>。Relay 端口 = 控制端口 + 2。',
    settings_save: '保存',
    settings_logs_title: 'CDP 日志',
    settings_logs_refresh: '刷新',
    logs_empty: '当前还没有日志记录',
    state_disabled_label: '未启用',
    state_disabled_detail: '点击开关或工具栏图标即可启用。',
    state_unconfigured_label: '需要配置',
    state_unconfigured_detail: '当前还没有 Lime Relay 配置。请从 Lime 导出扩展，或在工具栏弹窗里粘贴配置。',
    state_disconnected_label: '连接中',
    state_disconnected_detail: 'Relay 已启用，正在尝试建立连接。',
    state_connected_label: '已连接',
    state_connected_detail: 'Relay 已激活，代理可以控制你的浏览器。',
    meta_config_missing: '缺少配置',
    meta_observer_on: '观察通道已连接',
    meta_observer_off: '观察通道未连接',
    meta_control_on: '控制通道已连接',
    meta_control_off: '控制通道未连接',
    meta_debugger_count: '调试附着 {count}',
    unconfigured_chip: '请加载 Lime 导出的 Lime Browser Connector 目录，或在工具栏弹窗里粘贴配置。',
    attached_tabs_one: '{count} 个标签页',
    attached_tabs_other: '{count} 个标签页',
    agent_tabs: '{count} 个代理标签',
    retained_tabs: '{count} 个保留标签',
    badge_agent: '代理',
    badge_retained: '保留',
    port_ok: 'Relay 已连接到 :{port}',
    port_error: 'Relay 无法连接到 :{port}',
  },
}
const installI18n = globalThis.InstallI18n

for (const [lang, translations] of Object.entries(OPTIONS_TRANSLATIONS)) {
  installI18n?.register?.(lang, translations)
}

// ── Status rendering ──

let _lastStatusJson = ''
let _lastStatus = null
let _lastTabs = []
let _lastLogs = []
let currentLang = 'en'

function normalizeLang(raw) {
  const normalized = String(raw || '').trim().toLowerCase()
  if (SUPPORTED_LANGUAGES.includes(normalized)) {
    return normalized
  }
  const base = normalized.split('-')[0]
  return SUPPORTED_LANGUAGES.includes(base) ? base : 'en'
}

function detectLanguage() {
  if (installI18n?.detectLang) {
    return normalizeLang(installI18n.detectLang())
  }
  return normalizeLang(navigator.language)
}

function t(key) {
  const fallback =
    OPTIONS_TRANSLATIONS[currentLang]?.[key] ??
    OPTIONS_TRANSLATIONS.en[key] ??
    key
  if (!installI18n?.t) {
    return fallback
  }
  const translated = installI18n.t(key, currentLang)
  return translated === key ? fallback : translated
}

function formatMessage(key, params = {}) {
  return Object.entries(params).reduce(
    (message, [paramKey, value]) => message.replaceAll(`{${paramKey}}`, String(value)),
    t(key),
  )
}

function getStateCopy(state) {
  switch (state) {
    case RelayState.UNCONFIGURED:
      return {
        label: t('state_unconfigured_label'),
        detail: t('state_unconfigured_detail'),
      }
    case RelayState.DISCONNECTED:
      return {
        label: t('state_disconnected_label'),
        detail: t('state_disconnected_detail'),
      }
    case RelayState.CONNECTED:
      return {
        label: t('state_connected_label'),
        detail: t('state_connected_detail'),
      }
    case RelayState.DISABLED:
    default:
      return {
        label: t('state_disabled_label'),
        detail: t('state_disabled_detail'),
      }
  }
}

function applyAttributeTranslations() {
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')
    if (key) {
      el.setAttribute('title', t(key))
    }
  })
}

function applyLanguage(lang) {
  currentLang = normalizeLang(lang)
  installI18n?.apply?.(currentLang)
  document.documentElement.lang = currentLang
  document.title = t('title')
  if (languageSelect) {
    languageSelect.value = currentLang
  }
  applyAttributeTranslations()
  _lastStatusJson = ''
  renderStatus(_lastStatus)
  renderTabs(_lastTabs)
  renderLogs(_lastLogs)
}

async function loadLanguage() {
  const stored = await chrome.storage.local.get([LANGUAGE_STORAGE_KEY])
  applyLanguage(stored[LANGUAGE_STORAGE_KEY] || detectLanguage())
}

function renderStatus(status) {
  _lastStatus = status ?? null
  const key = JSON.stringify(status ?? null)
  if (key === _lastStatusJson) return
  _lastStatusJson = key
  const state = status?.state || RelayState.DISABLED
  const fallbackCfg = STATE_TEXT[state] || STATE_TEXT[RelayState.DISABLED]
  const cfg = getStateCopy(state) || fallbackCfg

  statusCard.dataset.state = state
  statusLabel.textContent = cfg.label
  statusDetail.textContent = cfg.detail

  if (!toggleBusy) {
    relayToggle.checked = state !== RelayState.DISABLED
  }

  const metaParts = []
  if (state === RelayState.UNCONFIGURED) {
    metaParts.push(t('meta_config_missing'))
  }
  if (typeof status?.observerConnected === 'boolean') {
    metaParts.push(
      t(status.observerConnected ? 'meta_observer_on' : 'meta_observer_off'),
    )
  }
  if (typeof status?.controlConnected === 'boolean') {
    metaParts.push(
      t(status.controlConnected ? 'meta_control_on' : 'meta_control_off'),
    )
  }
  if (Array.isArray(status?.debuggerTabs)) {
    metaParts.push(
      formatMessage('meta_debugger_count', { count: status.debuggerTabs.length }),
    )
  }
  statusMeta.textContent = metaParts.join(' · ')

  tabStats.textContent = ''
  if (status?.attachedTabs > 0) {
    const chip = document.createElement('span')
    chip.className = 'tab-chip tab-chip-tabs'
    chip.textContent = formatMessage(
      status.attachedTabs === 1 ? 'attached_tabs_one' : 'attached_tabs_other',
      { count: status.attachedTabs },
    )
    tabStats.appendChild(chip)
  }
  if (status?.agentTabs > 0) {
    const nonRetained = status.agentTabs - (status.retainedTabs || 0)
    if (nonRetained > 0) {
      const chip = document.createElement('span')
      chip.className = 'tab-chip tab-chip-agent'
      chip.textContent = formatMessage('agent_tabs', { count: nonRetained })
      tabStats.appendChild(chip)
    }
    if (status.retainedTabs > 0) {
      const chip = document.createElement('span')
      chip.className = 'tab-chip tab-chip-retained'
      chip.textContent = formatMessage('retained_tabs', {
        count: status.retainedTabs,
      })
      tabStats.appendChild(chip)
    }
  }
  if (state === RelayState.UNCONFIGURED) {
    const chip = document.createElement('span')
    chip.className = 'tab-chip tab-chip-agent'
    chip.textContent = t('unconfigured_chip')
    tabStats.appendChild(chip)
  } else if (status?.lastError) {
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
    setPortStatus('ok', formatMessage('port_ok', { port }))
  } catch {
    setPortStatus('error', formatMessage('port_error', { port }))
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

function renderTabs(tabs = []) {
  _lastTabs = tabs
  tabs.sort((a, b) => {
    const rank = (t) => t.isRetained ? 0 : t.isAgent ? 1 : 2
    return rank(a) - rank(b)
  })
  const hasTabs = tabs.length > 0
  tabsSection.style.display = hasTabs ? '' : 'none'
  tabsList.innerHTML = ''
  for (const tab of tabs) {
    const row = document.createElement('div')
    row.className = 'tab-entry'
    row.style.cursor = 'pointer'
    row.addEventListener('click', () => {
      chrome.tabs.update(tab.tabId, { active: true })
      chrome.tabs.get(tab.tabId, (activeTab) => {
        if (activeTab?.windowId) chrome.windows.update(activeTab.windowId, { focused: true })
      })
    })

    const dot = document.createElement('span')
    dot.className = 'tab-entry-state'
    dot.dataset.state = tab.state
    dot.title = tab.state

    const title = document.createElement('span')
    title.className = 'tab-entry-title'
    title.textContent = tab.title || `Tab ${tab.tabId}`

    const url = document.createElement('span')
    url.className = 'tab-entry-url'
    url.textContent = tab.url || ''

    row.append(dot, title, url)

    if (tab.isRetained) {
      const badge = document.createElement('span')
      badge.className = 'tab-entry-badge'
      badge.dataset.type = 'retained'
      badge.textContent = t('badge_retained')
      row.appendChild(badge)
    } else if (tab.isAgent) {
      const badge = document.createElement('span')
      badge.className = 'tab-entry-badge'
      badge.dataset.type = 'agent'
      badge.textContent = t('badge_agent')
      row.appendChild(badge)
    }

    tabsList.appendChild(row)
  }
}

async function refreshTabList() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getTabList' })
    renderTabs(resp?.tabs || [])
  } catch { /* background not ready */ }
}

// ── Logs viewer ──

const logsContainer = document.getElementById('logs-container')
const logsRefresh = document.getElementById('logs-refresh')

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function renderLogs(logs = []) {
  _lastLogs = logs
  if (logs.length === 0) {
    logsContainer.innerHTML = `<div class="logs-empty">${t('logs_empty')}</div>`
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
}

async function refreshLogs() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'getLogs', limit: 100 })
    renderLogs(resp?.logs || [])
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

languageSelect?.addEventListener('change', async () => {
  const nextLang = normalizeLang(languageSelect.value)
  await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: nextLang })
  applyLanguage(nextLang)
})

// ── Init ──

void loadLanguage()
void loadPort()
void loadCloseGroupSetting()
void queryBackgroundStatus()
void refreshTabList()
void refreshLogs()
