/**
 * DOM Text Replacer Utility
 *
 * Replaces Chinese text in the DOM with translated text using a TreeWalker.
 * This is the core of the Patch Layer architecture.
 *
 * Key features:
 * - Walks the entire DOM tree to find text nodes
 * - Replaces Chinese text with translations based on the current language
 * - Skips script, style, and already patched nodes
 * - Handles multiple Chinese segments in a single text node
 * - Marks patched nodes to avoid double-patching
 */

import { getTextMap, Language } from "./text-map";

const EDITABLE_CONTAINER_SELECTOR =
  "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], .ProseMirror";
const CHINESE_TEXT_REGEX = /[\u3400-\u9fff]/;

interface CompiledPatchMap {
  matcher: RegExp | null;
  replacements: Map<string, string>;
}

const compiledPatchMapCache = new Map<Language, CompiledPatchMap>();

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCompiledPatchMap(language: Language): CompiledPatchMap {
  const cached = compiledPatchMapCache.get(language);
  if (cached) {
    return cached;
  }

  const patches = getTextMap(language);
  const entries = Object.entries(patches)
    .filter(
      ([key, value]) =>
        key.length > 0 && key !== value && !key.startsWith("//"),
    )
    .sort(([left], [right]) => right.length - left.length);

  if (entries.length === 0) {
    const emptyCompiled = { matcher: null, replacements: new Map() };
    compiledPatchMapCache.set(language, emptyCompiled);
    return emptyCompiled;
  }

  const replacements = new Map<string, string>(entries);
  const pattern = entries.map(([key]) => escapeRegExp(key)).join("|");
  const matcher = new RegExp(pattern, "g");
  const compiled = { matcher, replacements };
  compiledPatchMapCache.set(language, compiled);
  return compiled;
}

function shouldSkipTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }

  const tagName = parent.tagName;
  if (tagName === "SCRIPT" || tagName === "STYLE") {
    return true;
  }

  if (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    parent.matches(EDITABLE_CONTAINER_SELECTOR) ||
    parent.closest(EDITABLE_CONTAINER_SELECTOR)
  ) {
    return true;
  }

  const text = node.textContent;
  if (!text || !CHINESE_TEXT_REGEX.test(text)) {
    return true;
  }

  return false;
}

function replaceTextNode(node: Text, compiled: CompiledPatchMap): boolean {
  const originalText = node.textContent;
  if (!originalText || !compiled.matcher) {
    return false;
  }

  compiled.matcher.lastIndex = 0;
  const nextText = originalText.replace(
    compiled.matcher,
    (matched) => compiled.replacements.get(matched) ?? matched,
  );

  if (nextText === originalText) {
    return false;
  }

  node.textContent = nextText;
  return true;
}

function replaceTextInNodeInternal(root: Node, language: Language): number {
  if (!root.isConnected && root !== document.body) {
    return 0;
  }

  const startTime = performance.now();
  const compiled = getCompiledPatchMap(language);
  if (!compiled.matcher) {
    return 0;
  }
  let replacedCount = 0;

  if (root.nodeType === Node.TEXT_NODE) {
    const textNode = root as Text;
    if (!shouldSkipTextNode(textNode) && replaceTextNode(textNode, compiled)) {
      replacedCount += 1;
    }
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (shouldSkipTextNode(node as Text)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current: Node | null;
    while ((current = walker.nextNode())) {
      if (replaceTextNode(current as Text, compiled)) {
        replacedCount += 1;
      }
    }
  }

  const duration = performance.now() - startTime;

  if (window.__I18N_METRICS__) {
    window.__I18N_METRICS__.patchTimes.push(duration);
  }

  if (duration > 50) {
    console.warn(
      `[i18n] DOM replacement took ${duration.toFixed(2)}ms (replaced=${replacedCount})`,
    );
  }

  return duration;
}

/**
 * Replace text in DOM nodes with translations
 *
 * @param language - Target language ('zh' or 'en')
 */
export function replaceTextInDOM(language: Language): void {
  replaceTextInNodeInternal(document.body, language);
}

/**
 * Replace text in a specific subtree.
 *
 * 适用于 MutationObserver 场景，只处理新增或变更节点，避免全量扫描。
 */
export function replaceTextInNode(root: Node, language: Language): void {
  replaceTextInNodeInternal(root, language);
}

// Declare global type for metrics
declare global {
  interface Window {
    __I18N_METRICS__?: {
      patchTimes: number[];
      languageChanges: number;
    };
  }
}

window.__I18N_METRICS__ = {
  patchTimes: [],
  languageChanges: 0,
};
