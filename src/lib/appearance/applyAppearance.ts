import {
  applyAccentColor,
  getAccentColor,
  subscribeAccentColor,
} from "./accent";
import {
  getCodeFontFamily,
  resolveCodeFontFamily,
  subscribeCodeFontFamily,
} from "./codeFontFamily";
import { getCodeFontSize, subscribeCodeFontSize } from "./codeFontSize";
import {
  buildChromeThemeVariables,
  buildCodeThemeVariables,
  resolveChromeTheme,
  resolveCodeTheme,
  type ChromeThemeId,
  type CodeThemeId,
} from "./codexThemePresets";
import {
  getContentFontFamily,
  resolveContentFontFamily,
  subscribeContentFontFamily,
} from "./contentFontFamily";
import {
  getFontSmoothingEnabled,
  subscribeFontSmoothing,
} from "./fontSmoothing";
import {
  getPointerCursorsEnabled,
  subscribePointerCursors,
} from "./pointerCursor";
import {
  getReducedMotionPreference,
  resolveReducedMotionAttribute,
  subscribeReducedMotion,
} from "./reducedMotion";
import {
  getSeparateModePreferences,
  subscribeSeparateModes,
  type SeparateModeValues,
} from "./separateModes";
import {
  getChromeTheme,
  getCodeTheme,
  subscribeChromeTheme,
  subscribeCodeTheme,
} from "./themePresets";
import {
  getUiFontFamily,
  resolveUiFontFamily,
  subscribeUiFontFamily,
} from "./uiFontFamily";
import { getUiFontSize, subscribeUiFontSize } from "./uiFontSize";
import { getContentFontSize, subscribeContentFontSize } from "./typography";
import {
  LIME_THEME_CHANGED_EVENT,
  getEffectiveLimeThemeMode,
  loadLimeThemeMode,
  type LimeEffectiveThemeMode,
} from "./themeMode";

function currentEffectiveTheme(): LimeEffectiveThemeMode {
  if (typeof document === "undefined") return "light";
  const value = document.documentElement.dataset.limeThemeEffective;
  if (value === "light" || value === "dark") return value;
  return getEffectiveLimeThemeMode(loadLimeThemeMode());
}

function currentModeValues(): SeparateModeValues {
  const separate = getSeparateModePreferences();
  if (separate.enabled) {
    return currentEffectiveTheme() === "dark" ? separate.dark : separate.light;
  }
  return {
    accent: getAccentColor(),
    chromeTheme: getChromeTheme(),
    codeTheme: getCodeTheme(),
    uiFontFamily: getUiFontFamily(),
    contentFontFamily: getContentFontFamily(),
    codeFontFamily: getCodeFontFamily(),
  };
}

let appliedChromeThemeVariableNames: string[] = [];
let appliedCodeThemeVariableNames: string[] = [];

function setRootVariables(
  root: HTMLElement,
  variables: Record<string, string>,
): string[] {
  const names = Object.keys(variables);
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
  }
  return names;
}

function clearRootVariables(root: HTMLElement, names: readonly string[]) {
  for (const name of names) root.style.removeProperty(name);
}

function clearChromeTheme(root: HTMLElement) {
  clearRootVariables(root, appliedChromeThemeVariableNames);
  appliedChromeThemeVariableNames = [];
}

function applyChromeTheme(
  root: HTMLElement,
  id: ChromeThemeId,
  variant: LimeEffectiveThemeMode,
  accent: SeparateModeValues["accent"],
) {
  const theme = resolveChromeTheme(id, variant);
  if (!theme) return;
  const variables = buildChromeThemeVariables(theme, variant, {
    useThemeAccent: accent === "default",
  });
  appliedChromeThemeVariableNames = setRootVariables(root, variables);
}

function applyCodeTheme(
  root: HTMLElement,
  id: CodeThemeId,
  variant: LimeEffectiveThemeMode,
) {
  clearRootVariables(root, appliedCodeThemeVariableNames);
  const variables = buildCodeThemeVariables(resolveCodeTheme(id, variant));
  appliedCodeThemeVariableNames = setRootVariables(root, variables);
}

/**
 * Single owner that projects appearance preferences onto the document.
 * The settings page only updates stores; values stay active while the page is
 * closed and are applied before React renders.
 */
export function applyAppearancePreferences() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const values = currentModeValues();
  const uiFontFamily = resolveUiFontFamily(values.uiFontFamily);

  root.style.setProperty("--lime-ui-font-family", uiFontFamily);
  root.style.setProperty(
    "--lime-content-font-family",
    resolveContentFontFamily(values.contentFontFamily, values.uiFontFamily),
  );
  root.style.setProperty(
    "--lime-content-font-size",
    `${getContentFontSize()}px`,
  );
  root.style.setProperty(
    "--lime-code-font-family",
    resolveCodeFontFamily(values.codeFontFamily),
  );
  root.style.setProperty("--lime-code-font-size", `${getCodeFontSize()}px`);
  root.style.fontSize = `${getUiFontSize()}px`;

  root.dataset.pointerCursors = String(getPointerCursorsEnabled());
  root.dataset.fontSmoothing = String(getFontSmoothingEnabled());

  const reducedMotion = resolveReducedMotionAttribute(
    getReducedMotionPreference(),
  );
  if (reducedMotion === null) {
    delete root.dataset.reducedMotion;
  } else {
    root.dataset.reducedMotion = reducedMotion;
  }

  const effectiveTheme = currentEffectiveTheme();
  clearChromeTheme(root);
  applyAccentColor(values.accent);
  applyChromeTheme(root, values.chromeTheme, effectiveTheme, values.accent);
  applyCodeTheme(root, values.codeTheme, effectiveTheme);
}

let cleanup: (() => void) | null = null;

export function initializeLimeAppearance(): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (cleanup) return cleanup;

  const root = document.documentElement;
  const apply = () => applyAppearancePreferences();
  const unsubscribe = [
    subscribeAccentColor(apply),
    subscribeSeparateModes(apply),
    subscribeChromeTheme(apply),
    subscribeCodeTheme(apply),
    subscribeUiFontFamily(apply),
    subscribeContentFontFamily(apply),
    subscribeUiFontSize(apply),
    subscribeContentFontSize(apply),
    subscribeCodeFontFamily(apply),
    subscribeCodeFontSize(apply),
    subscribePointerCursors(apply),
    subscribeReducedMotion(apply),
    subscribeFontSmoothing(apply),
  ];

  const onThemeChanged = () => apply();
  window.addEventListener(LIME_THEME_CHANGED_EVENT, onThemeChanged);
  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(apply);
  observer?.observe(root, {
    attributes: true,
    attributeFilter: ["data-lime-theme-effective"],
  });

  apply();

  cleanup = () => {
    for (const off of unsubscribe) off();
    window.removeEventListener(LIME_THEME_CHANGED_EVENT, onThemeChanged);
    observer?.disconnect();
    clearChromeTheme(root);
    clearRootVariables(root, appliedCodeThemeVariableNames);
    appliedCodeThemeVariableNames = [];
    root.style.removeProperty("--lime-ui-font-family");
    root.style.removeProperty("--lime-content-font-family");
    root.style.removeProperty("--lime-content-font-size");
    root.style.removeProperty("--lime-code-font-family");
    root.style.removeProperty("--lime-code-font-size");
    root.style.removeProperty("font-size");
    delete root.dataset.pointerCursors;
    delete root.dataset.reducedMotion;
    delete root.dataset.fontSmoothing;
    applyAccentColor("default");
    cleanup = null;
  };
  return cleanup;
}
