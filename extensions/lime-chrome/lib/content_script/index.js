/**
 * Content Script channel — Manus-style DOM interaction.
 *
 * Uses chrome.scripting.executeScript to inject page-level scripts
 * for viewport info, content extraction, element marking, click/input,
 * keyboard, scrolling, keyword search, mouse hover, and Shadow DOM traversal.
 * No debugger attachment required for DOM operations.
 *
 * Active commands (wired into CDP dispatch):
 *   extension-ops.js        — Core: viewport, screenshot, content, mark, click, input
 *   press-key.js            — Keyboard event simulation with modifiers/combos
 *   scroll.js               — Page/container scrolling with verification
 *   find-keyword.js         — In-page keyword search with context
 *   move-mouse.js           — Mouse hover simulation
 *   highlight-screenshot.js — Screenshot annotation with element highlights
 *
 * Reserved commands (implemented but not wired — enable when needed):
 *   wait-ready.js           — Page readyState + MutationObserver
 *   action-mask.js          — Shadow DOM overlay to block user interaction
 *   input-enhanced.js       — DraftEditor / Slate / Rich Text Editor support
 *   extract-readability.js  — Dual-path content extraction with scoring fallback
 *   keepalive.js            — MV3 Service Worker heartbeat mechanism
 *
 *   helpers.js              — Shared utilities (unwrapScriptResult)
 */

// ── Active exports ──

export {
  extGetViewportInfo,
  extEnsureZoom,
  extCaptureViewport,
  extExtractContent,
  extMarkElements,
  extClick,
  extInput,
} from './extension-ops.js'

export { extPressKey } from './press-key.js'
export { extScroll } from './scroll.js'
export { extFindKeyword } from './find-keyword.js'
export { extMoveMouse } from './move-mouse.js'
export { renderHighlightedScreenshot } from './highlight-screenshot.js'

// ── Reserved exports (not wired into dispatch) ──

export { extWaitForReady } from './wait-ready.js'
export { extActionMask } from './action-mask.js'
export { extInputEnhanced } from './input-enhanced.js'
export { extExtractContentEnhanced } from './extract-readability.js'
export { startKeepAlive, stopKeepAlive, registerKeepAliveListener } from './keepalive.js'
