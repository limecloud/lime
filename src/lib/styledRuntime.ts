import {
  hasTauriInvokeCapability,
  hasTauriRuntimeMarkers,
} from "@/lib/tauri-runtime";
import { reportFrontendDebugLog } from "@/lib/api/frontendDebug";

/**
 * Tauri WebView 在生产构建下偶发 CSSOM 注入失效；
 * 切回文本注入可以避开 styled-components #17 启动崩溃。
 */
export function shouldDisableStyledCssomInjection(): boolean {
  return hasTauriRuntimeMarkers() || hasTauriInvokeCapability();
}

interface StyledRuntimeSnapshot {
  phase: string;
  protocol: string;
  readyState: string;
  tauriRuntimeMarkers: boolean;
  tauriInvokeCapability: boolean;
  scDisableSpeedyType: string;
  scDisableSpeedyValue: unknown;
  styledTagCount: number;
  styledTagTextLength: number;
  styledTagHasSheet: boolean;
  styledTagParentTagName: string | null;
  styledTagChildNodeCount: number;
  styledTagPreview: string | null;
  styledFallbackSheetPresent: boolean;
  styledFallbackSheetTextLength: number;
  styledFallbackSheetHasSheet: boolean;
  styledFallbackSheetProtocol: string | null;
  styleSheetCount: number;
  styledClassElementCount: number;
  rootChildCount: number;
  rootFirstElementClassName: string | null;
  rootFirstElementRulePresent: boolean;
  rootFirstElementDisplay: string | null;
  sidebarExists: boolean;
  sidebarClassName: string | null;
  sidebarRulePresent: boolean;
  sidebarDisplay: string | null;
  sidebarWidth: string | null;
  sidebarMinWidth: string | null;
  sidebarPosition: string | null;
  sidebarBackgroundColor: string | null;
  sidebarBorderRightWidth: string | null;
}

const STYLED_FALLBACK_ATTR = "data-lime-sc-fallback";
const STYLED_RUNTIME_SIGNATURE_ATTR = "data-lime-sc-signature";

function buildStyledTagSignature(text: string): string {
  return `${text.length}:${text.slice(0, 64)}:${text.slice(-32)}`;
}

function hasResolvableSheet(
  node: HTMLStyleElement | HTMLLinkElement | null,
): boolean {
  if (!node) {
    return false;
  }

  if (node.sheet) {
    return true;
  }

  const rootNode = node.getRootNode();
  const styleSheets =
    "styleSheets" in rootNode &&
    rootNode.styleSheets instanceof StyleSheetList
      ? rootNode.styleSheets
      : document.styleSheets;

  return Array.from(styleSheets).some((sheet) => sheet.ownerNode === node);
}

function getCssTextFromStyledTags(styledTags: HTMLStyleElement[]): string {
  return styledTags.map((tag) => tag.textContent ?? "").join("");
}

interface StyledFallbackSnapshot {
  present: boolean;
  textLength: number;
  hasSheet: boolean;
  protocol: string | null;
}

function syncStyledFallbackTag(
  styledTags: HTMLStyleElement[],
): StyledFallbackSnapshot {
  if (typeof document === "undefined") {
    return {
      present: false,
      textLength: 0,
      hasSheet: false,
      protocol: null,
    };
  }

  const cssText = getCssTextFromStyledTags(styledTags);
  const head = document.head ?? document.documentElement;
  let fallbackTag = document.querySelector<HTMLLinkElement>(
    `link[${STYLED_FALLBACK_ATTR}]`,
  );

  if (!cssText) {
    fallbackTag?.remove();
    return {
      present: false,
      textLength: 0,
      hasSheet: false,
      protocol: null,
    };
  }

  if (!fallbackTag) {
    fallbackTag = document.createElement("link");
    fallbackTag.setAttribute(STYLED_FALLBACK_ATTR, "active");
  }

  fallbackTag.rel = "stylesheet";
  fallbackTag.type = "text/css";

  if (head && fallbackTag.parentNode !== head) {
    head.appendChild(fallbackTag);
  }

  const signature = buildStyledTagSignature(cssText);
  if (fallbackTag.getAttribute(STYLED_RUNTIME_SIGNATURE_ATTR) !== signature) {
    fallbackTag.href = `data:text/css;charset=utf-8,${encodeURIComponent(cssText)}`;
    fallbackTag.setAttribute(STYLED_RUNTIME_SIGNATURE_ATTR, signature);
  }

  return {
    present: true,
    textLength: cssText.length,
    hasSheet: hasResolvableSheet(fallbackTag),
    protocol: fallbackTag.href ? new URL(fallbackTag.href).protocol : null,
  };
}

function installStyledTagNormalizationObserver(): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return;
  }

  const observeRoot = document.head ?? document.documentElement;
  if (!observeRoot) {
    return;
  }

  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const styledTags = Array.from(
      document.querySelectorAll<HTMLStyleElement>("style[data-styled]"),
    );
    syncStyledFallbackTag(styledTags);
  };

  const schedule = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(flush);
  };

  const observer = new MutationObserver(() => {
    schedule();
  });

  observer.observe(observeRoot, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  window.addEventListener(
    "beforeunload",
    () => {
      observer.disconnect();
    },
    { once: true },
  );

  schedule();
}

function hasSidebarStyledRule(
  elementClassName: string | null,
  cssText: string,
): boolean {
  if (!elementClassName || !cssText) {
    return false;
  }

  const tokens = elementClassName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return false;
  }

  return tokens.some((token) => cssText.includes(`.${token}{`));
}

function collectStyledRuntimeSnapshot(
  phase: string,
): StyledRuntimeSnapshot | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const styledTags = Array.from(
    document.querySelectorAll<HTMLStyleElement>("style[data-styled]"),
  );
  const styledTagTextLength = styledTags.reduce(
    (sum, tag) => sum + (tag.textContent?.length ?? 0),
    0,
  );
  const firstStyledTag = styledTags[0] ?? null;
  const rootFirstElement = document.getElementById("root")
    ?.firstElementChild as HTMLElement | null;
  const rootFirstElementStyle = rootFirstElement
    ? window.getComputedStyle(rootFirstElement)
    : null;
  const sidebar = document.querySelector<HTMLElement>("aside");
  const sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null;
  const sidebarClassName = sidebar?.className || null;
  const cssText = getCssTextFromStyledTags(styledTags);
  const fallbackSnapshot = syncStyledFallbackTag(styledTags);
  const runtimeWindow = window as typeof window & {
    SC_DISABLE_SPEEDY?: unknown;
  };

  return {
    phase,
    protocol: window.location.protocol,
    readyState: document.readyState,
    tauriRuntimeMarkers: hasTauriRuntimeMarkers(),
    tauriInvokeCapability: hasTauriInvokeCapability(),
    scDisableSpeedyType: typeof runtimeWindow.SC_DISABLE_SPEEDY,
    scDisableSpeedyValue:
      runtimeWindow.SC_DISABLE_SPEEDY === undefined
        ? null
        : runtimeWindow.SC_DISABLE_SPEEDY,
    styledTagCount: styledTags.length,
    styledTagTextLength,
    styledTagHasSheet: hasResolvableSheet(firstStyledTag),
    styledTagParentTagName: firstStyledTag?.parentElement?.tagName ?? null,
    styledTagChildNodeCount: firstStyledTag?.childNodes.length ?? 0,
    styledTagPreview: firstStyledTag?.textContent?.slice(0, 160) ?? null,
    styledFallbackSheetPresent: fallbackSnapshot.present,
    styledFallbackSheetTextLength: fallbackSnapshot.textLength,
    styledFallbackSheetHasSheet: fallbackSnapshot.hasSheet,
    styledFallbackSheetProtocol: fallbackSnapshot.protocol,
    styleSheetCount: document.styleSheets.length,
    styledClassElementCount:
      document.querySelectorAll('[class*="sc-"]').length,
    rootChildCount: document.getElementById("root")?.children.length ?? 0,
    rootFirstElementClassName: rootFirstElement?.className || null,
    rootFirstElementRulePresent: hasSidebarStyledRule(
      rootFirstElement?.className || null,
      cssText,
    ),
    rootFirstElementDisplay: rootFirstElementStyle?.display || null,
    sidebarExists: Boolean(sidebar),
    sidebarClassName,
    sidebarRulePresent: hasSidebarStyledRule(sidebarClassName, cssText),
    sidebarDisplay: sidebarStyle?.display || null,
    sidebarWidth: sidebarStyle?.width || null,
    sidebarMinWidth: sidebarStyle?.minWidth || null,
    sidebarPosition: sidebarStyle?.position || null,
    sidebarBackgroundColor: sidebarStyle?.backgroundColor || null,
    sidebarBorderRightWidth: sidebarStyle?.borderRightWidth || null,
  };
}

function reportStyledRuntimeSnapshot(phase: string): void {
  const snapshot = collectStyledRuntimeSnapshot(phase);
  if (!snapshot) {
    return;
  }

  void reportFrontendDebugLog({
    level: "info",
    category: "styled-runtime",
    message: `styled-runtime.${phase}`,
    context: snapshot,
  }).catch(() => {
    // 诊断日志不上抛，避免影响主流程。
  });
}

export function scheduleStyledRuntimeDiagnostics(): void {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !shouldDisableStyledCssomInjection()
  ) {
    return;
  }

  installStyledTagNormalizationObserver();
  reportStyledRuntimeSnapshot("bootstrap");

  window.requestAnimationFrame(() => {
    reportStyledRuntimeSnapshot("raf");
  });

  window.setTimeout(() => {
    reportStyledRuntimeSnapshot("settled");
  }, 1200);
}
