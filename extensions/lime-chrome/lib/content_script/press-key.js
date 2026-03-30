/**
 * Extension.pressKey — Keyboard event simulation.
 *
 * Supports single keys, modifier keys, and combo strings like "Ctrl+A", "Shift+Enter".
 * Dispatches keydown, keypress (for printable), and keyup events.
 */

import { unwrapScriptResult } from './helpers.js'

export async function extPressKey(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      const KEY_MAP = {
        enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
        tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
        escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
        esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
        backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
        delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
        space: { key: ' ', code: 'Space', keyCode: 32 },
        arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
        arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
        arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
        arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
        home: { key: 'Home', code: 'Home', keyCode: 36 },
        end: { key: 'End', code: 'End', keyCode: 35 },
        pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
        pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
      }

      for (let i = 1; i <= 12; i++) {
        KEY_MAP[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i }
      }

      const MODIFIER_NAMES = new Set(['ctrl', 'control', 'shift', 'alt', 'meta', 'cmd', 'command'])

      function resolveKey(name) {
        const lower = name.toLowerCase().trim()
        if (KEY_MAP[lower]) return KEY_MAP[lower]
        if (lower.length === 1) {
          const upper = lower.toUpperCase()
          return { key: lower, code: `Key${upper}`, keyCode: upper.charCodeAt(0) }
        }
        return { key: name, code: name, keyCode: 0 }
      }

      function parseCombo(combo) {
        const parts = String(combo).split('+').map(s => s.trim()).filter(Boolean)
        const modifiers = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
        let mainKey = null

        for (const part of parts) {
          const lower = part.toLowerCase()
          if (lower === 'ctrl' || lower === 'control') modifiers.ctrlKey = true
          else if (lower === 'shift') modifiers.shiftKey = true
          else if (lower === 'alt') modifiers.altKey = true
          else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.metaKey = true
          else mainKey = resolveKey(part)
        }

        if (!mainKey && parts.length === 1) mainKey = resolveKey(parts[0])
        return { modifiers, mainKey }
      }

      const target = document.activeElement || document.body
      const combo = p.key || p.combo || ''
      const { modifiers, mainKey } = parseCombo(combo)

      if (!mainKey) return { success: false, error: `Cannot resolve key: ${combo}` }

      const isPrintable = mainKey.key.length === 1 && !modifiers.ctrlKey && !modifiers.metaKey

      const baseOpts = {
        bubbles: true, cancelable: true, composed: true,
        key: mainKey.key, code: mainKey.code, keyCode: mainKey.keyCode, which: mainKey.keyCode,
        ...modifiers,
      }

      target.dispatchEvent(new KeyboardEvent('keydown', baseOpts))
      if (isPrintable) {
        target.dispatchEvent(new KeyboardEvent('keypress', { ...baseOpts, charCode: mainKey.key.charCodeAt(0) }))
      }
      target.dispatchEvent(new KeyboardEvent('keyup', baseOpts))

      return { success: true, key: mainKey.key, modifiers }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.pressKey')
}
