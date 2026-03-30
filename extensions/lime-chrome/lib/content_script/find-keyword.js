/**
 * Extension.findKeyword — In-page keyword search with context expansion.
 *
 * Uses sentence segmentation to find keyword occurrences and returns
 * surrounding context (~20 words). Handles CJK characters correctly.
 */

import { unwrapScriptResult } from './helpers.js'

export async function extFindKeyword(tabId, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (p) => {
      const keyword = (p.keyword || '').trim()
      if (!keyword) return { success: false, error: 'No keyword provided' }

      const body = document.body?.innerText || ''
      if (!body) return { success: true, matches: [], count: 0 }

      const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/
      const isCJK = CJK_RE.test(keyword)

      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = isCJK ? new RegExp(escaped, 'gi') : new RegExp(`\\b${escaped}\\b`, 'gi')

      let sentences
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
        sentences = [...segmenter.segment(body)].map(s => s.segment)
      } catch {
        sentences = body.split(/[.!?\n]+/).filter(Boolean)
      }

      const matches = []
      const MAX_MATCHES = 20
      const CONTEXT_WORDS = 20

      for (const sentence of sentences) {
        if (matches.length >= MAX_MATCHES) break
        if (!pattern.test(sentence)) continue
        pattern.lastIndex = 0

        const words = sentence.split(/\s+/)
        let match
        while ((match = pattern.exec(sentence)) !== null && matches.length < MAX_MATCHES) {
          const beforeText = sentence.slice(0, match.index)
          const wordsBefore = beforeText.split(/\s+/).filter(Boolean)
          const startWord = Math.max(0, wordsBefore.length - CONTEXT_WORDS)

          const afterText = sentence.slice(match.index + match[0].length)
          const wordsAfter = afterText.split(/\s+/).filter(Boolean)
          const endWord = Math.min(wordsAfter.length, CONTEXT_WORDS)

          const contextBefore = wordsBefore.slice(startWord).join(' ')
          const contextAfter = wordsAfter.slice(0, endWord).join(' ')
          const context = `${contextBefore} ${match[0]} ${contextAfter}`.trim()

          matches.push({
            keyword: match[0],
            context,
            sentenceIndex: sentences.indexOf(sentence),
          })
        }
      }

      return {
        success: true,
        keyword,
        count: matches.length,
        matches,
        url: location.href,
      }
    },
    args: [params || {}],
  })
  return unwrapScriptResult(results, 'Extension.findKeyword')
}
