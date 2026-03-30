/**
 * Shared utilities for content_script commands.
 */

export function unwrapScriptResult(results, label) {
  const first = results?.[0]
  if (!first) throw new Error(`${label}: no injection result (page may be restricted)`)
  if (first.error) throw new Error(`${label}: ${typeof first.error === 'string' ? first.error : JSON.stringify(first.error)}`)
  return first.result
}

