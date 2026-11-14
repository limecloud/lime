import { useSyncExternalStore } from "react";
import {
  DEFAULT_CHROME_THEME_ID,
  DEFAULT_CODE_THEME_ID,
  isCodexThemeId,
  type ChromeThemeId,
  type CodeThemeId,
} from "./codexThemePresets";

export const CHROME_THEME_STORAGE_KEY = "lime.appearance.chrome-theme.v1";
export const CODE_THEME_STORAGE_KEY = "lime.appearance.code-theme.v1";

let currentChromeTheme: ChromeThemeId = readTheme(
  CHROME_THEME_STORAGE_KEY,
  DEFAULT_CHROME_THEME_ID,
);
let currentCodeTheme: CodeThemeId = readTheme(
  CODE_THEME_STORAGE_KEY,
  DEFAULT_CODE_THEME_ID,
);
const chromeThemeListeners = new Set<() => void>();
const codeThemeListeners = new Set<() => void>();

function readTheme(key: string, fallback: CodeThemeId): CodeThemeId {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return isCodexThemeId(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function publish(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}

export function getChromeTheme(): ChromeThemeId {
  return currentChromeTheme;
}

export function getCodeTheme(): CodeThemeId {
  return currentCodeTheme;
}

export function setChromeTheme(id: ChromeThemeId) {
  currentChromeTheme = isCodexThemeId(id) ? id : DEFAULT_CHROME_THEME_ID;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CHROME_THEME_STORAGE_KEY, currentChromeTheme);
    } catch {
      // Preference stays in memory.
    }
  }
  publish(chromeThemeListeners);
}

export function setCodeTheme(id: CodeThemeId) {
  currentCodeTheme = isCodexThemeId(id) ? id : DEFAULT_CODE_THEME_ID;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CODE_THEME_STORAGE_KEY, currentCodeTheme);
    } catch {
      // Preference stays in memory.
    }
  }
  publish(codeThemeListeners);
}

export function subscribeChromeTheme(listener: () => void) {
  chromeThemeListeners.add(listener);
  return () => chromeThemeListeners.delete(listener);
}

export function subscribeCodeTheme(listener: () => void) {
  codeThemeListeners.add(listener);
  return () => codeThemeListeners.delete(listener);
}

export function useChromeTheme(): ChromeThemeId {
  return useSyncExternalStore(
    subscribeChromeTheme,
    getChromeTheme,
    getChromeTheme,
  );
}

export function useCodeTheme(): CodeThemeId {
  return useSyncExternalStore(subscribeCodeTheme, getCodeTheme, getCodeTheme);
}

export function resetThemePresets() {
  setChromeTheme(DEFAULT_CHROME_THEME_ID);
  setCodeTheme(DEFAULT_CODE_THEME_ID);
}

export const resetThemePresetsForTest = resetThemePresets;
