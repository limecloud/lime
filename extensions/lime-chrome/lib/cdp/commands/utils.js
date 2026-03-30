/**
 * Shared CDP dispatch utilities and constants.
 */

export const RUNTIME_ENABLE_DELAY = 10
export const TARGET_CREATE_DELAY = 100
export const CDP_COMMAND_TIMEOUT = 30000
export const DEFAULT_MAX_RETAINED_TABS = 10

export function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`CDP command timed out after ${ms}ms: ${label}`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
