import { RelayState } from '../../lib/constants.js'

const statusCard = document.getElementById('status-card')
const label = document.getElementById('label')
const toggle = document.getElementById('toggle')
const meta = document.getElementById('meta')
const tabsSection = document.getElementById('tabs-section')
const tabsHeader = document.getElementById('tabs-header')
const tabsList = document.getElementById('tabs-list')

const STATE_LABELS = {
  [RelayState.DISABLED]: 'Offline',
  [RelayState.UNCONFIGURED]: 'Setup Required',
  [RelayState.DISCONNECTED]: 'Connecting…',
  [RelayState.CONNECTED]: 'Connected',
}

const ARROW_SVG =
  '<svg class="tab-go" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 2.5l4 3.5-4 3.5"/></svg>'

function escapeHtml(str) {
  const div = document.createElement('div')
  div.appendChild(document.createTextNode(str))
  return div.innerHTML
}

function render(status) {
  const state = status?.state || RelayState.DISABLED
  statusCard.dataset.state = state
  label.textContent = STATE_LABELS[state] || 'Unknown'

  if (!toggleBusy) {
    toggle.checked = state !== RelayState.DISABLED
  }

  meta.innerHTML = ''
  if (status?.attachedTabs > 0) {
    addChip(`${status.attachedTabs}`, status.attachedTabs === 1 ? 'tab' : 'tabs', 'tabs')
  }
  if (status?.agentTabs > 0) {
    const nonRetained = status.agentTabs - (status.retainedTabs || 0)
    if (nonRetained > 0) addChip(`${nonRetained}`, 'agent', 'agent')
    if (status.retainedTabs > 0) addChip(`${status.retainedTabs}`, 'retained', 'retained')
  }
}

function addChip(num, text, kind) {
  const chip = document.createElement('span')
  chip.className = `chip chip-${kind}`
  chip.innerHTML = `<span class="chip-num">${num}</span> ${text}`
  meta.appendChild(chip)
}

function tabSortKey(t) {
  if (t.isRetained) return 0
  if (t.isAgent) return 1
  return 2
}

function renderTabs(tabs) {
  if (tabs) tabs.sort((a, b) => tabSortKey(a) - tabSortKey(b))
  const hasTabs = tabs && tabs.length > 0
  tabsSection.dataset.empty = String(!hasTabs)

  if (!hasTabs) {
    tabsList.innerHTML = ''
    return
  }

  tabsList.innerHTML = ''
  tabs.forEach((tab) => {
    const el = document.createElement('div')
    el.className = 'tab-item'
    el.addEventListener('click', () => {
      chrome.tabs.update(tab.tabId, { active: true })
      if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true })
      window.close()
    })

    const displayTitle = tab.title || tab.url || `Tab ${tab.tabId}`
    const safeTitle = escapeHtml(displayTitle)
    const safeState = escapeHtml(tab.state || 'virtual')
    let badge = ''
    if (tab.isAgent && !tab.isRetained) {
      badge = '<span class="tab-badge tab-badge-agent">agent</span>'
    } else if (tab.isRetained) {
      badge = '<span class="tab-badge tab-badge-retained">retained</span>'
    }

    el.innerHTML =
      `<span class="tab-dot" data-state="${safeState}"></span>` +
      `<span class="tab-title" title="${safeTitle}">${safeTitle}</span>` +
      badge +
      ARROW_SVG
    tabsList.appendChild(el)
  })
}

tabsHeader.addEventListener('click', () => {
  const isOpen = tabsSection.dataset.open === 'true'
  tabsSection.dataset.open = String(!isOpen)
})

async function refresh() {
  try {
    const [status, tabResp] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'getRelayStatus' }),
      chrome.runtime.sendMessage({ type: 'getTabList' }),
    ])
    render(status)
    renderTabs(tabResp?.tabs)
  } catch {
    render(null)
    renderTabs([])
  }
}

let toggleBusy = false
toggle.addEventListener('change', async () => {
  if (toggleBusy) return
  toggleBusy = true
  try {
    await chrome.runtime.sendMessage({ type: 'toggleRelay' })
    await refresh()
  } finally {
    toggleBusy = false
  }
})

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
  window.close()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('relayEnabled' in changes || '_relayState' in changes)) {
    void refresh()
  }
})

void refresh()
setInterval(() => void refresh(), 1000)
