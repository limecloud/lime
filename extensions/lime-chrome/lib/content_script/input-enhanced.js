/**
 * Enhanced input handling — DraftEditor and Rich Text Editor support.
 *
 * Detects and handles React DraftEditor (Facebook/Meta ecosystem),
 * Slate, ProseMirror, and other contenteditable-based editors.
 *
 * Detection strategy:
 *   1. Check for DraftEditor class on element or ancestors
 *   2. Check for data-contents attribute (DraftEditor signature)
 *   3. Check for Slate/ProseMirror data attributes
 *
 * Input strategy for rich text:
 *   1. Focus element
 *   2. Select all content (Selection API)
 *   3. For DraftEditor: execCommand("delete") + execCommand("insertText")
 *   4. For others: direct textContent set + InputEvent dispatch
 */

import { unwrapScriptResult } from './helpers.js'

export async function extInputEnhanced(tabId, params) {
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
      if (p.index) el = deepQuery(document, `[data-accio-idx="${p.index}"]`)
      else if (p.selector) el = deepQuery(document, p.selector)
      if (!el) return { success: false, error: 'Element not found' }

      const text = p.text || ''
      const tag = el.tagName
      const isContentEditable = el.getAttribute('contenteditable') === 'true' ||
        el.isContentEditable

      function isDraftEditor(element) {
        if (element.classList?.contains('DraftEditor-content')) return true
        if (element.hasAttribute('data-contents')) return true
        let cur = element
        for (let i = 0; i < 5 && cur; i++) {
          if (cur.classList?.contains('DraftEditor-root')) return true
          cur = cur.parentElement
        }
        return false
      }

      function isSlateEditor(element) {
        return element.hasAttribute('data-slate-editor') ||
          element.closest?.('[data-slate-editor]') != null
      }

      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        el.focus()
        const proto = tag === 'SELECT' ? HTMLSelectElement.prototype
          : tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype
        const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        if (nativeSet) nativeSet.call(el, text)
        else el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return { success: true, method: 'native-setter' }
      }

      if (isContentEditable) {
        el.focus()

        const selection = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(el)
        selection.removeAllRanges()
        selection.addRange(range)

        if (isDraftEditor(el)) {
          document.execCommand('delete', false)
          document.execCommand('insertText', false, text)
          return { success: true, method: 'draft-editor' }
        }

        if (isSlateEditor(el)) {
          document.execCommand('insertText', false, text)
          return { success: true, method: 'slate-editor' }
        }

        const ok = document.execCommand('insertText', false, text)
        if (ok) return { success: true, method: 'execCommand' }

        el.textContent = text
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: text,
        }))
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: text,
        }))
        return { success: true, method: 'textContent-fallback' }
      }

      return { success: false, error: `Unsupported element: ${tag}, contentEditable=${el.isContentEditable}` }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.inputEnhanced')
}
