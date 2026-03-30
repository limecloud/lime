/**
 * Extension.waitForReady — Page readiness tracking.
 *
 * Waits for the page to reach a ready state before executing actions.
 * Uses document.readyState and optional MutationObserver for body detection.
 *
 * Ready criteria: "complete" OR ("interactive" + 1000ms elapsed)
 */

import { unwrapScriptResult } from './helpers.js'

export async function extWaitForReady(tabId, params) {
  const timeoutMs = params?.timeout || 10000
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (timeout) => {
      return new Promise((resolve) => {
        const t0 = Date.now()

        function check() {
          const state = document.readyState
          const elapsed = Date.now() - t0

          if (state === 'complete') {
            return resolve({ ready: true, state, elapsed })
          }
          if (state === 'interactive' && elapsed >= 1000) {
            return resolve({ ready: true, state, elapsed, note: 'interactive + 1s' })
          }
          if (elapsed >= timeout) {
            return resolve({ ready: false, state, elapsed, error: 'Timeout waiting for page ready' })
          }
          setTimeout(check, 200)
        }

        if (!document.body) {
          const observer = new MutationObserver(() => {
            if (document.body) {
              observer.disconnect()
              check()
            }
          })
          observer.observe(document.documentElement, { childList: true })
          setTimeout(() => {
            observer.disconnect()
            check()
          }, Math.min(timeout, 5000))
        } else {
          check()
        }
      })
    },
    args: [timeoutMs],
  })
  return unwrapScriptResult(results, 'Extension.waitForReady')
}
