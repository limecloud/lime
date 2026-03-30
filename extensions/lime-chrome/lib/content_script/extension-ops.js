/**
 * Extension.* virtual CDP commands.
 *
 * These commands are NOT part of the Chrome Debugger Protocol —
 * they use chrome.scripting.executeScript to inject page-level scripts
 * and chrome.tabs / chrome.debugger for viewport/zoom/screenshot operations.
 *
 * This avoids the need for a persistent content script while providing
 * capabilities similar to Manus (content extraction, element marking, etc).
 */

import { unwrapScriptResult } from './helpers.js'

// ── Viewport & Zoom ──

function wrapDebuggerCommand(tabId, fn) {
  return fn().catch((err) => {
    const msg = err?.message || String(err)
    if (msg.includes('attach') || msg.includes('debugger') || msg.includes('Another debugger')) {
      throw new Error(`Tab ${tabId} is not attached to debugger. Ensure ensureAttached was called first. Original: ${msg}`)
    }
    throw err
  })
}

export async function extGetViewportInfo(tabId) {
  const debuggee = { tabId }
  const result = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollX: Math.round(window.scrollX),
      scrollY: Math.round(window.scrollY),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      zoom: window.innerWidth > 0 ? Math.round(window.outerWidth / window.innerWidth * 100) / 100 : 1,
    })`,
    returnByValue: true,
  }))
  return JSON.parse(result?.result?.value || '{}')
}

export async function extEnsureZoom(tabId, params) {
  const targetZoom = typeof params?.zoom === 'number' ? params.zoom : 1
  const currentZoom = await chrome.tabs.getZoom(tabId)
  if (Math.abs(currentZoom - targetZoom) > 0.01) {
    await chrome.tabs.setZoom(tabId, targetZoom)
    await new Promise((r) => setTimeout(r, 150))
    return { changed: true, from: currentZoom, to: targetZoom }
  }
  return { changed: false, current: currentZoom }
}

// ── Screenshot ──

export async function extCaptureViewport(tabId, params) {
  const debuggee = { tabId }
  const format = params?.format || 'png'
  const quality = params?.quality || 80

  await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
    awaitPromise: true,
  })).catch(() => {})

  const metrics = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Page.getLayoutMetrics'))
  const vv = metrics?.visualViewport || {}

  const vpResult = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
    expression: 'JSON.stringify({ dpr: window.devicePixelRatio || 1 })',
    returnByValue: true,
  }))
  const { dpr } = JSON.parse(vpResult?.result?.value || '{"dpr":1}')

  const screenshot = await wrapDebuggerCommand(tabId, () => chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
    format,
    quality: format === 'jpeg' ? quality : undefined,
    clip: {
      x: vv.pageX || 0,
      y: vv.pageY || 0,
      width: vv.clientWidth || 1280,
      height: vv.clientHeight || 720,
      scale: 1 / dpr,
    },
    captureBeyondViewport: false,
  }))

  return {
    data: screenshot?.data,
    width: Math.round(vv.clientWidth || 1280),
    height: Math.round(vv.clientHeight || 720),
    dpr,
  }
}

// ── Content Extraction ──

export async function extExtractContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title
        || document.querySelector('meta[property="og:title"]')?.content
        || document.querySelector('h1')?.textContent?.trim() || ''

      const main = document.querySelector('main, article, [role="main"], #content, .content')
      const root = main || document.body

      function toMarkdown(el) {
        const lines = []
        const walk = (node) => {
          if (node.nodeType === 3) {
            const t = node.textContent.replace(/\s+/g, ' ').trim()
            if (t) lines.push(t)
            return
          }
          if (node.nodeType !== 1) return
          const tag = node.tagName
          try {
            const style = getComputedStyle(node)
            if (style.display === 'none' || style.visibility === 'hidden') return
          } catch { /* skip check */ }

          if (/^H[1-6]$/.test(tag)) {
            lines.push('\n' + '#'.repeat(+tag[1]) + ' ' + node.textContent.trim())
          } else if (tag === 'P') {
            lines.push('\n' + node.innerText.replace(/\s+/g, ' ').trim())
          } else if (tag === 'LI') {
            lines.push('- ' + node.innerText.replace(/\s+/g, ' ').trim())
          } else if (tag === 'A' && node.href) {
            lines.push(`[${node.textContent.trim()}](${node.href})`)
          } else if (tag === 'IMG' && node.alt) {
            lines.push(`![${node.alt}](${node.src})`)
          } else if (tag === 'PRE' || tag === 'CODE') {
            lines.push('\n```\n' + node.textContent.trim() + '\n```')
          } else if (tag === 'BR') {
            lines.push('\n')
          } else if (tag === 'TABLE') {
            lines.push('\n' + node.innerText.replace(/\t/g, ' | ').trim())
          } else {
            for (const child of node.childNodes) walk(child)
            if (node.shadowRoot) {
              for (const child of node.shadowRoot.childNodes) walk(child)
            }
          }
        }
        walk(el)
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      }

      return {
        title: title.trim(),
        url: location.href,
        content: toMarkdown(root).slice(0, 50000),
      }
    },
  })
  return unwrapScriptResult(results, 'Extension.extractContent')
}

// ── Interactive Element Marking ──

export async function extMarkElements(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (options) => {
      const INTERACTIVE_SELECTOR = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
        '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
        '[contenteditable="true"]', '[onclick]', '[tabindex]:not([tabindex="-1"])',
      ].join(',')

      const SKIP_TAGS = new Set([
        'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'META', 'LINK',
      ])

      function deepElementFromPoint(x, y) {
        const el = document.elementFromPoint(x, y)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(x, y)
          if (inner && inner !== el) return inner
        }
        return el
      }

      function isDescendantOrSelf(node, target) {
        let cur = node
        while (cur) {
          if (cur === target) return true
          if (cur.parentElement) { cur = cur.parentElement; continue }
          const root = cur.getRootNode()
          cur = root instanceof ShadowRoot ? root.host : null
        }
        return false
      }

      function isVisible(el, rect, vw, vh) {
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) return false
        const clipped = {
          left: Math.max(rect.left, 0), top: Math.max(rect.top, 0),
          right: Math.min(rect.right, vw), bottom: Math.min(rect.bottom, vh),
        }
        const cw = clipped.right - clipped.left
        const ch = clipped.bottom - clipped.top
        if (cw < 3 || ch < 3) return false

        const cols = Math.min(4, Math.max(1, Math.round(cw / 20)))
        const rows = Math.min(4, Math.max(1, Math.round(ch / 20)))
        let hits = 0, total = 0
        for (let r = 0; r <= rows; r++) {
          for (let c = 0; c <= cols; c++) {
            const px = clipped.left + (cols > 0 ? (c / cols) * cw : cw / 2)
            const py = clipped.top + (rows > 0 ? (r / rows) * ch : ch / 2)
            const top = deepElementFromPoint(px, py)
            if (top && isDescendantOrSelf(top, el)) hits++
            total++
          }
        }
        return total > 0 && (hits / total) >= 0.3
      }

      function collectInteractive(root, out) {
        for (const el of root.querySelectorAll('*')) {
          if (SKIP_TAGS.has(el.tagName)) continue
          if (el.matches(INTERACTIVE_SELECTOR)) out.push(el)
          if (el.shadowRoot) collectInteractive(el.shadowRoot, out)
        }
      }

      const vw = window.innerWidth || 1, vh = window.innerHeight || 1
      const candidates = []
      collectInteractive(document, candidates)

      const elements = []
      let idx = 1
      const maxElements = options?.maxElements || 200

      for (const el of candidates) {
        if (idx > maxElements) break
        const rect = el.getBoundingClientRect()
        if (rect.width < 5 || rect.height < 5) continue

        try {
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
        } catch { /* skip check */ }

        if (!isVisible(el, rect, vw, vh)) continue

        const tag = el.tagName.toLowerCase()
        const text = (el.textContent || el.value || el.placeholder
          || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 100)

        el.setAttribute('data-accio-idx', String(idx))

        elements.push({
          idx, tag,
          type: el.type || '',
          text,
          role: el.getAttribute('role') || '',
          rect: {
            x: Math.round(rect.left), y: Math.round(rect.top),
            w: Math.round(rect.width), h: Math.round(rect.height),
          },
          center: {
            nx: +(((rect.left + rect.width / 2) / vw).toFixed(4)),
            ny: +(((rect.top + rect.height / 2) / vh).toFixed(4)),
          },
        })
        idx++
      }

      return {
        elements,
        viewport: { width: vw, height: vh, dpr: window.devicePixelRatio || 1 },
        url: location.href,
        title: document.title,
      }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.markElements')
}

// ── DOM Actions ──

export async function extClick(tabId, params) {
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
      let el
      if (p.index != null) {
        const idx = Number(p.index)
        if (!Number.isInteger(idx) || idx <= 0) return { success: false, error: 'Invalid index' }
        el = deepQuery(document, `[data-accio-idx="${idx}"]`)
      } else if (p.selector) {
        try { el = deepQuery(document, p.selector) } catch { return { success: false, error: 'Invalid selector' } }
      } else if (p.x != null && p.y != null) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const cx = p.viewportWidth ? (p.x / p.viewportWidth) * vw : p.x
        const cy = p.viewportHeight ? (p.y / p.viewportHeight) * vh : p.y
        el = document.elementFromPoint(cx, cy)
        if (el?.shadowRoot) {
          const inner = el.shadowRoot.elementFromPoint(cx, cy)
          if (inner) el = inner
        }
      }
      if (!el) return { success: false, error: 'Element not found' }
      el.scrollIntoView({ block: 'center', behavior: 'instant' })
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2

      const clickType = (p.clickType || 'single_left').toLowerCase()
      const isRight = clickType.includes('right')
      const button = isRight ? 2 : 0
      const baseOpts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: cx, clientY: cy, button }

      if (clickType === 'double_left') {
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 2 }))
        el.dispatchEvent(new MouseEvent('dblclick', { ...baseOpts, detail: 2 }))
      } else if (clickType === 'triple_left') {
        for (let i = 1; i <= 3; i++) {
          el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: i }))
          el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: i }))
          el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: i }))
        }
      } else if (isRight) {
        el.dispatchEvent(new MouseEvent('mousedown', baseOpts))
        el.dispatchEvent(new MouseEvent('mouseup', baseOpts))
        el.dispatchEvent(new MouseEvent('contextmenu', baseOpts))
      } else {
        el.dispatchEvent(new MouseEvent('mousedown', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('mouseup', { ...baseOpts, detail: 1 }))
        el.dispatchEvent(new MouseEvent('click', { ...baseOpts, detail: 1 }))
      }

      return { success: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 80), clickType, _cx: cx, _cy: cy }
    },
    args: [params || {}],
  })
  const result = unwrapScriptResult(results, 'Extension.click')
  if (result?.success && result._cx != null) {
    showClickRipple(tabId, result._cx, result._cy).catch(() => {})
    delete result._cx
    delete result._cy
  }
  return result
}

async function showClickRipple(tabId, x, y) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cx, cy) => {
      if (!document.getElementById('accio-ripple-style')) {
        const s = document.createElement('style')
        s.id = 'accio-ripple-style'
        s.textContent = '@keyframes accio-r{0%{transform:scale(0);opacity:1}100%{transform:scale(2.5);opacity:0}}'
        document.head.appendChild(s)
      }
      const d = document.createElement('div')
      Object.assign(d.style, {
        position: 'fixed', left: `${cx - 16}px`, top: `${cy - 16}px`,
        width: '32px', height: '32px', borderRadius: '50%',
        background: 'rgba(99,102,241,0.4)', pointerEvents: 'none',
        zIndex: '2147483647', animation: 'accio-r .8s ease-out forwards',
      })
      document.body.appendChild(d)
      d.onanimationend = () => d.remove()
    },
    args: [x, y],
  })
}

export async function extInput(tabId, params) {
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
      let el
      if (p.index != null) {
        const idx = Number(p.index)
        if (!Number.isInteger(idx) || idx <= 0) return { success: false, error: 'Invalid index' }
        el = deepQuery(document, `[data-accio-idx="${idx}"]`)
      } else if (p.selector) {
        try { el = deepQuery(document, p.selector) } catch { return { success: false, error: 'Invalid selector' } }
      }
      if (!el) return { success: false, error: 'Element not found' }

      el.focus()
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const proto = tag === 'SELECT' ? HTMLSelectElement.prototype
          : tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (nativeSet) nativeSet.call(el, p.text || '')
        else el.value = p.text || ''
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      } else if (el.getAttribute('contenteditable') === 'true') {
        el.focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, p.text || '')
      }
      return { success: true }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.input')
}
