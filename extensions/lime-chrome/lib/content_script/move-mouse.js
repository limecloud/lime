/**
 * Extension.moveMouse — Mouse hover simulation.
 *
 * Dispatches mousemove and mouseover events to trigger hover states.
 * Supports coordinate-based and element-based targeting.
 */

import { unwrapScriptResult } from './helpers.js'

export async function extMoveMouse(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      function deepQuery(root, sel) {
        const found = root.querySelector(sel)
        if (found) return found
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            const inner = deepQuery(el.shadowRoot, sel)
            if (inner) return inner
          }
        }
        return null
      }

      let el, cx, cy

      if (p.index) {
        el = deepQuery(document, `[data-accio-idx="${p.index}"]`)
      } else if (p.selector) {
        el = deepQuery(document, p.selector)
      }

      if (el) {
        const rect = el.getBoundingClientRect()
        cx = rect.left + rect.width / 2
        cy = rect.top + rect.height / 2
      } else if (p.x != null && p.y != null) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        cx = p.viewportWidth ? (p.x / p.viewportWidth) * vw : p.x
        cy = p.viewportHeight ? (p.y / p.viewportHeight) * vh : p.y
        el = document.elementFromPoint(cx, cy)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(cx, cy)
          if (inner) el = inner
        }
      }

      if (!el) return { success: false, error: 'Target element not found' }

      const eventOpts = {
        bubbles: true, cancelable: true, composed: true,
        clientX: cx, clientY: cy, view: window,
      }

      el.dispatchEvent(new MouseEvent('mouseover', eventOpts))
      el.dispatchEvent(new MouseEvent('mouseenter', { ...eventOpts, bubbles: false }))
      el.dispatchEvent(new MouseEvent('mousemove', eventOpts))

      return {
        success: true,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 80),
        position: { x: Math.round(cx), y: Math.round(cy) },
      }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.moveMouse')
}
