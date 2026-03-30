/**
 * Enhanced content extraction with Readability-like fallback.
 *
 * Dual-path extraction:
 *   Path 1: Custom DOM walker (same as extExtractContent)
 *   Path 2: Scoring-based extraction inspired by Mozilla Readability
 *
 * Picks the longer result. Falls back to body.innerText if both are short.
 */

import { unwrapScriptResult } from './helpers.js'

export async function extExtractContentEnhanced(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title
        || document.querySelector('meta[property="og:title"]')?.content
        || document.querySelector('h1')?.textContent?.trim() || ''

      // Path 1: Simple walker
      function simpleExtract() {
        const main = document.querySelector('main, article, [role="main"], #content, .content')
        const root = main || document.body

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
          } catch { /* skip */ }

          if (/^H[1-6]$/.test(tag)) lines.push('\n' + '#'.repeat(+tag[1]) + ' ' + node.textContent.trim())
          else if (tag === 'P') lines.push('\n' + node.innerText.replace(/\s+/g, ' ').trim())
          else if (tag === 'LI') lines.push('- ' + node.innerText.replace(/\s+/g, ' ').trim())
          else if (tag === 'A' && node.href) lines.push(`[${node.textContent.trim()}](${node.href})`)
          else if (tag === 'IMG' && node.alt) lines.push(`![${node.alt}](${node.src})`)
          else if (tag === 'PRE' || tag === 'CODE') lines.push('\n```\n' + node.textContent.trim() + '\n```')
          else if (tag === 'BR') lines.push('\n')
          else if (tag === 'TABLE') lines.push('\n' + node.innerText.replace(/\t/g, ' | ').trim())
          else {
            for (const child of node.childNodes) walk(child)
            if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) walk(child)
          }
        }
        walk(root)
        return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      }

      // Path 2: Scoring-based extraction (Readability-inspired)
      function scoringExtract() {
        const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'FORM'])
        const candidates = []

        function score(el) {
          if (SKIP.has(el.tagName)) return 0
          const text = el.innerText || ''
          const textLen = text.length
          if (textLen < 25) return 0

          let s = 0
          const paragraphs = el.querySelectorAll('p')
          s += paragraphs.length * 3
          s += Math.min(textLen / 100, 30)

          const links = el.querySelectorAll('a')
          const linkText = [...links].reduce((sum, a) => sum + (a.textContent || '').length, 0)
          const linkDensity = textLen > 0 ? linkText / textLen : 1
          if (linkDensity > 0.5) s *= 0.3

          const commas = (text.match(/[,，、]/g) || []).length
          s += commas

          if (el.id?.match(/article|content|main|post|body/i)) s *= 1.5
          if (el.className?.match(/article|content|main|post|body/i)) s *= 1.3
          if (el.className?.match(/sidebar|comment|footer|nav|menu|ad|banner/i)) s *= 0.3

          return s
        }

        for (const el of document.querySelectorAll('div, section, article, main')) {
          const s = score(el)
          if (s > 0) candidates.push({ el, score: s })
        }

        candidates.sort((a, b) => b.score - a.score)
        const best = candidates[0]
        if (!best || best.score < 10) return ''

        const text = best.el.innerText || ''
        return text.replace(/\t/g, ' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      }

      const simple = simpleExtract()
      const scored = scoringExtract()

      let content
      if (simple.length >= scored.length || simple.length > 800) {
        content = simple
      } else {
        content = scored
      }

      if (content.length < 200) {
        const fallback = (document.body?.innerText || '')
          .replace(/\t/g, ' ').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
        if (fallback.length > content.length) content = fallback
      }

      return {
        title: title.trim(),
        url: location.href,
        content: content.slice(0, 50000),
        method: content === simple ? 'walker' : content.length < 200 ? 'body-fallback' : 'scoring',
      }
    },
  })
  return unwrapScriptResult(results, 'Extension.extractContentEnhanced')
}
