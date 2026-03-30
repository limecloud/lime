/**
 * Extension.actionMask — Page overlay for blocking user interaction.
 *
 * Injects a Shadow DOM-isolated overlay that prevents user interaction
 * while AI is operating. Supports three states:
 *   ongoing  — blocks all interaction, cursor: wait
 *   idle     — hidden, no blocking
 *   takeover — transparent overlay, allows user interaction
 */

import { unwrapScriptResult } from './helpers.js'

export async function extActionMask(tabId, params) {
  const state = (params?.state || 'idle').toLowerCase()
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (maskState) => {
      const MASK_ID = 'accio-action-mask'
      let host = document.getElementById(MASK_ID)

      if (maskState === 'idle' || maskState === 'remove') {
        if (host) host.remove()
        return { success: true, state: 'idle' }
      }

      if (!host) {
        host = document.createElement('div')
        host.id = MASK_ID
        host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;'
        const shadow = host.attachShadow({ mode: 'open' })

        const style = document.createElement('style')
        style.textContent = `
          :host { all: initial; }
          .mask-layer {
            position: fixed; inset: 0; z-index: 2147483646;
            transition: opacity 0.3s ease;
          }
          .mask-layer[data-state="ongoing"] {
            pointer-events: auto; cursor: wait;
            background: rgba(0, 0, 0, 0.02);
          }
          .mask-layer[data-state="takeover"] {
            pointer-events: none;
            background: transparent;
          }
          .glow-border {
            position: fixed; inset: 0; z-index: 2147483645;
            pointer-events: none;
            box-shadow: inset 0 0 30px rgba(99, 102, 241, 0.15);
            animation: accio-glow 1.5s ease-in-out infinite alternate;
          }
          @keyframes accio-glow {
            from { opacity: 0.7; }
            to { opacity: 1; }
          }
          .status-bar {
            position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
            z-index: 2147483647;
            background: rgba(30, 30, 50, 0.9); color: #e0e0e0;
            padding: 8px 20px; border-radius: 24px;
            font: 13px/1.4 system-ui, -apple-system, sans-serif;
            backdrop-filter: blur(8px);
            pointer-events: none;
            display: flex; align-items: center; gap: 8px;
          }
          .status-dot {
            width: 8px; height: 8px; border-radius: 50%;
            background: #6366f1;
            animation: accio-pulse 1s ease-in-out infinite alternate;
          }
          @keyframes accio-pulse {
            from { opacity: 0.5; }
            to { opacity: 1; }
          }
        `

        const mask = document.createElement('div')
        mask.className = 'mask-layer'

        const glow = document.createElement('div')
        glow.className = 'glow-border'

        const bar = document.createElement('div')
        bar.className = 'status-bar'
        bar.innerHTML = '<span class="status-dot"></span><span>Accio is working…</span>'

        shadow.append(style, mask, glow, bar)
        document.body.appendChild(host)
      }

      const shadow = host.shadowRoot
      const mask = shadow.querySelector('.mask-layer')
      const glow = shadow.querySelector('.glow-border')
      const bar = shadow.querySelector('.status-bar')

      mask.dataset.state = maskState

      if (maskState === 'ongoing') {
        glow.style.display = ''
        bar.style.display = ''
        const BLOCKED_EVENTS = [
          'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu',
          'pointerdown', 'pointerup', 'pointermove',
          'keydown', 'keyup', 'keypress', 'wheel',
        ]
        if (!mask._blockers) {
          mask._blockers = []
          for (const evt of BLOCKED_EVENTS) {
            const handler = (e) => { if (e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation() } }
            document.addEventListener(evt, handler, { capture: true, passive: false })
            mask._blockers.push({ evt, handler })
          }
        }
      } else if (maskState === 'takeover') {
        glow.style.display = 'none'
        bar.style.display = 'none'
        if (mask._blockers) {
          for (const { evt, handler } of mask._blockers) {
            document.removeEventListener(evt, handler, { capture: true })
          }
          mask._blockers = null
        }
      }

      return { success: true, state: maskState }
    },
    args: [state],
  })
  return unwrapScriptResult(results, 'Extension.actionMask')
}
