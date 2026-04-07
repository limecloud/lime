/**
 * I18nPatchProvider Component
 *
 * React Provider component that manages the i18n patch state.
 * Applies DOM text replacement when language changes and watches for
 * dynamic content via MutationObserver.
 *
 * This is the core of the Patch Layer architecture - it intercepts
 * text rendering and applies translations without modifying original components.
 */

/* eslint-disable react-refresh/only-export-components */
import {
  useEffect,
  useState,
  createContext,
  useContext,
  ReactNode,
} from "react";
import { replaceTextInDOM, replaceTextInNode } from "./dom-replacer";
import { Language, isValidLanguage } from "./text-map";

export interface I18nPatchContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const I18nPatchContext = createContext<I18nPatchContextValue>({
  language: "zh",
  setLanguage: () => {},
});

const EDITABLE_CONTAINER_SELECTOR =
  "input, textarea, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only'], .ProseMirror";

function resolveMutationElement(node: Node): Element | null {
  if (node instanceof Element) {
    return node;
  }
  return node.parentElement;
}

function isIgnoredMutationNode(node: Node): boolean {
  const element = resolveMutationElement(node);
  if (!element) {
    return true;
  }

  if (element.matches(EDITABLE_CONTAINER_SELECTOR)) {
    return true;
  }

  if (element.closest(EDITABLE_CONTAINER_SELECTOR)) {
    return true;
  }

  return false;
}

/**
 * Hook to access i18n patch context
 * Must be used within I18nPatchProvider
 */
export const useI18nPatch = () => {
  const context = useContext(I18nPatchContext);
  if (!context) {
    throw new Error("useI18nPatch must be used within I18nPatchProvider");
  }
  return context;
};

export interface I18nPatchProviderProps {
  children: ReactNode;
  initialLanguage?: Language;
}

/**
 * I18nPatchProvider Component
 *
 * Provides i18n context and manages DOM text replacement.
 * Automatically patches new content via MutationObserver.
 */
export function I18nPatchProvider({
  children,
  initialLanguage = "zh",
}: I18nPatchProviderProps) {
  const [language, setLanguage] = useState<Language>(initialLanguage);

  // Validate and normalize language
  const normalizeLanguage = (lang: string): Language => {
    if (isValidLanguage(lang)) {
      return lang;
    }
    console.warn(`[i18n] Invalid language "${lang}", falling back to "zh"`);
    return "zh";
  };

  // Handle language change
  const handleSetLanguage = (lang: Language) => {
    const normalized = normalizeLanguage(lang);
    setLanguage(normalized);
  };

  useEffect(() => {
    // Apply patches when language changes
    replaceTextInDOM(language);

    // Track language changes
    if (window.__I18N_METRICS__) {
      window.__I18N_METRICS__.languageChanges++;
    }

    // Set up MutationObserver for dynamic content with debouncing
    const pendingRoots = new Set<Node>();
    let timeoutId: number | null = null;

    const enqueueRoot = (candidate: Node | null) => {
      if (!candidate) {
        return;
      }
      const rootNode =
        candidate.nodeType === Node.TEXT_NODE
          ? candidate.parentElement
          : candidate;
      if (
        !rootNode ||
        !rootNode.isConnected ||
        isIgnoredMutationNode(rootNode)
      ) {
        return;
      }

      for (const existing of pendingRoots) {
        if (!(existing instanceof Node) || !(rootNode instanceof Node)) {
          continue;
        }

        if (
          existing.nodeType === Node.ELEMENT_NODE &&
          rootNode.nodeType === Node.ELEMENT_NODE &&
          (existing as Element).contains(rootNode)
        ) {
          return;
        }

        if (
          existing.nodeType === Node.ELEMENT_NODE &&
          rootNode.nodeType === Node.ELEMENT_NODE &&
          (rootNode as Element).contains(existing)
        ) {
          pendingRoots.delete(existing);
        }
      }

      pendingRoots.add(rootNode);
    };

    const flushPendingRoots = () => {
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      roots.forEach((root) => {
        if (!root.isConnected || isIgnoredMutationNode(root)) {
          return;
        }
        replaceTextInNode(root, language);
      });
    };

    const observer = new MutationObserver((mutations) => {
      // 忽略输入框的变化（避免输入卡顿）
      const shouldIgnore = mutations.every((mutation) => {
        const targetIgnored = isIgnoredMutationNode(mutation.target);
        if (targetIgnored) {
          return true;
        }

        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          return Array.from(mutation.addedNodes).every((node) =>
            isIgnoredMutationNode(node),
          );
        }

        return false;
      });

      if (shouldIgnore) return;

      mutations.forEach((mutation) => {
        if (isIgnoredMutationNode(mutation.target)) {
          return;
        }

        if (mutation.type === "characterData") {
          enqueueRoot(mutation.target);
          return;
        }

        if (mutation.type === "childList") {
          if (mutation.addedNodes.length === 0) {
            enqueueRoot(mutation.target);
            return;
          }
          mutation.addedNodes.forEach((node) => enqueueRoot(node));
        }
      });

      if (pendingRoots.size === 0) {
        return;
      }

      // 防抖：延迟 300ms 执行，避免频繁触发
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        flushPendingRoots();
        timeoutId = null;
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      pendingRoots.clear();
    };
  }, [language]);

  return (
    <I18nPatchContext.Provider
      value={{ language, setLanguage: handleSetLanguage }}
    >
      {children}
    </I18nPatchContext.Provider>
  );
}
