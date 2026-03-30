/**
 * Extension.scroll — Page and container scrolling with verification.
 *
 * Supports directional scrolling (up/down/left/right), scroll-to-end,
 * and container-specific scrolling by coordinates.
 */

import { unwrapScriptResult } from './helpers.js'

export async function extScroll(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      const direction = (p.direction || 'down').toLowerCase()
      const toEnd = p.toEnd === true
      const amount = p.amount || null

      function findScrollable(x, y) {
        let el = document.elementFromPoint(x, y)
        let depth = 0
        while (el && depth < 80) {
          const style = getComputedStyle(el)
          const overflowY = style.overflowY
          const overflowX = style.overflowX
          const isScrollableY = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
          const isScrollableX = (overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth
          if ((direction === 'up' || direction === 'down') && isScrollableY) return el
          if ((direction === 'left' || direction === 'right') && isScrollableX) return el
          el = el.parentElement
          depth++
        }
        return null
      }

      const vw = window.innerWidth
      const vh = window.innerHeight

      let target = null
      if (p.x != null && p.y != null) {
        const cx = p.viewportWidth ? (p.x / p.viewportWidth) * vw : p.x
        const cy = p.viewportHeight ? (p.y / p.viewportHeight) * vh : p.y
        target = findScrollable(cx, cy)
      }

      const scrollTarget = target || document.scrollingElement || document.documentElement
      const isWindow = scrollTarget === document.scrollingElement || scrollTarget === document.documentElement

      const scrollAmount = amount || Math.max(120, Math.round((direction === 'left' || direction === 'right' ? vw : vh) * 0.6))

      const beforeX = isWindow ? window.scrollX : scrollTarget.scrollLeft
      const beforeY = isWindow ? window.scrollY : scrollTarget.scrollTop

      let targetX = beforeX
      let targetY = beforeY

      if (toEnd) {
        if (direction === 'down') targetY = scrollTarget.scrollHeight
        else if (direction === 'up') targetY = 0
        else if (direction === 'right') targetX = scrollTarget.scrollWidth
        else if (direction === 'left') targetX = 0
      } else {
        if (direction === 'down') targetY = beforeY + scrollAmount
        else if (direction === 'up') targetY = beforeY - scrollAmount
        else if (direction === 'right') targetX = beforeX + scrollAmount
        else if (direction === 'left') targetX = beforeX - scrollAmount
      }

      if (isWindow) {
        window.scrollTo({ left: targetX, top: targetY, behavior: 'instant' })
      } else {
        scrollTarget.scrollTo({ left: targetX, top: targetY, behavior: 'instant' })
      }

      const afterX = isWindow ? window.scrollX : scrollTarget.scrollLeft
      const afterY = isWindow ? window.scrollY : scrollTarget.scrollTop

      const scrolledX = Math.round(afterX - beforeX)
      const scrolledY = Math.round(afterY - beforeY)

      const totalHeight = scrollTarget.scrollHeight
      const clientHeight = isWindow ? vh : scrollTarget.clientHeight
      const pixelsAbove = Math.round(afterY)
      const pixelsBelow = Math.max(0, Math.round(totalHeight - afterY - clientHeight))

      return {
        success: true,
        direction,
        scrolled: { x: scrolledX, y: scrolledY },
        container: target ? target.tagName.toLowerCase() : 'window',
        pixelsAbove,
        pixelsBelow,
        atTop: afterY <= 0,
        atBottom: pixelsBelow <= 1,
      }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.scroll')
}
