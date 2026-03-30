/**
 * Page dialog event handlers.
 *
 * Handles `Page.javascriptDialogOpening` and `Page.javascriptDialogClosed`.
 *
 * Requires: `Page.enable` (called in debugger-attach.js on attach).
 *
 * Dialog types: alert, confirm, prompt, beforeunload.
 *
 * CRITICAL: When `hasBrowserHandler` is false, failing to call
 * `Page.handleJavaScriptDialog` will STALL page execution indefinitely.
 *
 * Strategy:
 *   - beforeunload → always auto-accept (agent-initiated navigation/close)
 *   - alert        → auto-accept (dismiss)
 *   - confirm      → auto-accept (true)
 *   - prompt       → auto-accept with defaultPrompt value
 *
 * All dialog events are forwarded to the relay so the agent side
 * can observe them. The relay can also send Page.handleJavaScriptDialog
 * explicitly via normal CDP command path if it needs different behavior.
 */

import { createLogger } from '../../logger.js'

const log = createLogger('evt:dialog')

/**
 * @param {string} method
 * @param {number} tabId
 * @param {object} params
 * @param {import('./index.js').EventContext} _ctx
 * @returns {{ suppress?: boolean } | void}
 */
export function handleDialogEvent(method, tabId, params, _ctx) {
  if (method === 'Page.javascriptDialogOpening') {
    return handleDialogOpening(tabId, params)
  }

  if (method === 'Page.javascriptDialogClosed') {
    log.debug(
      'dialog closed:', tabId,
      'result:', params?.result,
      'userInput:', params?.userInput ? `"${truncate(params.userInput, 40)}"` : '(none)',
    )
  }
}

function handleDialogOpening(tabId, params) {
  const type = params?.type
  const message = params?.message || ''
  const defaultPrompt = params?.defaultPrompt || ''
  const hasBrowserHandler = params?.hasBrowserHandler

  log.info(
    'dialog opening:', tabId,
    `type=${type}`,
    `hasBrowserHandler=${hasBrowserHandler}`,
    `message="${truncate(message, 100)}"`,
  )

  switch (type) {
    case 'beforeunload':
    case 'alert':
    case 'confirm':
      acceptDialog(tabId, true)
      break
    case 'prompt':
      acceptDialog(tabId, true, defaultPrompt)
      break
    default:
      log.warn('unknown dialog type, auto-accepting:', tabId, type)
      acceptDialog(tabId, true)
      break
  }
}

/**
 * Accept/dismiss a dialog immediately.
 *
 * No setTimeout — in MV3 the SW can suspend before the timer fires,
 * leaving the page permanently stalled. The dialog event has already
 * been forwarded to the relay by the time we reach here, so the relay
 * can still override by sending its own Page.handleJavaScriptDialog
 * before observing the dialogClosed event.
 */
function acceptDialog(tabId, accept, promptText) {
  const cmdParams = { accept }
  if (promptText !== undefined) cmdParams.promptText = promptText

  chrome.debugger
    .sendCommand({ tabId }, 'Page.handleJavaScriptDialog', cmdParams)
    .then(() => log.debug('dialog handled:', tabId, accept ? 'accepted' : 'dismissed'))
    .catch((err) => log.warn('dialog handle failed:', tabId, err?.message || err))
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str
}
