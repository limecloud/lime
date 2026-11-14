import { useSyncExternalStore } from "react";
import { ACCENT_COLORS, getAccentColor, type AccentColor } from "./accent";
import {
  CODE_FONT_FAMILIES,
  getCodeFontFamily,
  type CodeFontFamily,
} from "./codeFontFamily";
import {
  DEFAULT_CHROME_THEME_ID,
  DEFAULT_CODE_THEME_ID,
  isCodexThemeId,
  type ChromeThemeId,
  type CodeThemeId,
} from "./codexThemePresets";
import { getChromeTheme, getCodeTheme } from "./themePresets";
import {
  CONTENT_FONT_FAMILIES,
  getContentFontFamily,
  type ContentFontFamily,
} from "./contentFontFamily";
import {
  UI_FONT_FAMILIES,
  getUiFontFamily,
  type UiFontFamily,
} from "./uiFontFamily";

/**
 * Codex's "Separate light and dark modes" switch reveals independent saved
 * theme, color, and font values for each mode.  Lime keeps its fixed Lime
 * color system and exposes the same per-mode accent and font ownership.
 */
export interface SeparateModeValues {
  accent: AccentColor;
  chromeTheme: ChromeThemeId;
  codeTheme: CodeThemeId;
  uiFontFamily: UiFontFamily;
  contentFontFamily: ContentFontFamily;
  codeFontFamily: CodeFontFamily;
}

export interface SeparateModePreferences {
  enabled: boolean;
  light: SeparateModeValues;
  dark: SeparateModeValues;
}

export const DEFAULT_SEPARATE_MODE_VALUES: SeparateModeValues = {
  accent: "default",
  chromeTheme: DEFAULT_CHROME_THEME_ID,
  codeTheme: DEFAULT_CODE_THEME_ID,
  uiFontFamily: "system",
  contentFontFamily: "ui",
  codeFontFamily: "system",
};

const STORAGE_KEY = "lime.appearance.separate-modes.v1";
const DEFAULTS: SeparateModePreferences = {
  enabled: false,
  light: DEFAULT_SEPARATE_MODE_VALUES,
  dark: DEFAULT_SEPARATE_MODE_VALUES,
};
let current = read();
const listeners = new Set<() => void>();

function normalizeSeparateModeValues(
  value: unknown,
): SeparateModeValues | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SeparateModeValues>;
  if (
    !ACCENT_COLORS.includes(candidate.accent as AccentColor) ||
    !UI_FONT_FAMILIES.includes(candidate.uiFontFamily as UiFontFamily) ||
    !CONTENT_FONT_FAMILIES.includes(
      candidate.contentFontFamily as ContentFontFamily,
    ) ||
    !CODE_FONT_FAMILIES.includes(candidate.codeFontFamily as CodeFontFamily)
  ) {
    return null;
  }
  return {
    ...DEFAULT_SEPARATE_MODE_VALUES,
    ...candidate,
    chromeTheme: isCodexThemeId(candidate.chromeTheme)
      ? candidate.chromeTheme
      : DEFAULT_CHROME_THEME_ID,
    codeTheme: isCodexThemeId(candidate.codeTheme)
      ? candidate.codeTheme
      : DEFAULT_CODE_THEME_ID,
  };
}

function read(): SeparateModePreferences {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<SeparateModePreferences> | null;
    if (!parsed || parsed.enabled !== true) {
      return { ...DEFAULTS, enabled: parsed?.enabled === true };
    }
    return {
      enabled: true,
      light:
        normalizeSeparateModeValues(parsed.light) ??
        DEFAULT_SEPARATE_MODE_VALUES,
      dark:
        normalizeSeparateModeValues(parsed.dark) ??
        DEFAULT_SEPARATE_MODE_VALUES,
    };
  } catch {
    return DEFAULTS;
  }
}

function publish() {
  for (const listener of listeners) listener();
}

function persist(next: SeparateModePreferences) {
  current = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // Preference stays in memory.
    }
  }
  publish();
}

function isUntouched(values: SeparateModeValues) {
  return (
    values.accent === DEFAULT_SEPARATE_MODE_VALUES.accent &&
    values.chromeTheme === DEFAULT_SEPARATE_MODE_VALUES.chromeTheme &&
    values.codeTheme === DEFAULT_SEPARATE_MODE_VALUES.codeTheme &&
    values.uiFontFamily === DEFAULT_SEPARATE_MODE_VALUES.uiFontFamily &&
    values.contentFontFamily ===
      DEFAULT_SEPARATE_MODE_VALUES.contentFontFamily &&
    values.codeFontFamily === DEFAULT_SEPARATE_MODE_VALUES.codeFontFamily
  );
}

export function getSeparateModePreferences(): SeparateModePreferences {
  return current;
}

export interface SeparateModePreferencesPatch {
  enabled?: boolean;
  light?: Partial<SeparateModeValues>;
  dark?: Partial<SeparateModeValues>;
}

export function setSeparateModePreferences(next: SeparateModePreferencesPatch) {
  persist({
    enabled: next.enabled ?? current.enabled,
    light: {
      ...current.light,
      ...(next.light ?? {}),
    },
    dark: {
      ...current.dark,
      ...(next.dark ?? {}),
    },
  });
}

/**
 * Enabling separate modes must not change the appearance the user is looking
 * at.  Seed both modes from the current global values only while their saved
 * values are still untouched; previously customised modes keep their values.
 */
export function setSeparateModesEnabled(enabled: boolean) {
  if (!enabled) {
    setSeparateModePreferences({ enabled: false });
    return;
  }
  const seed = {
    accent: getAccentColor(),
    chromeTheme: getChromeTheme(),
    codeTheme: getCodeTheme(),
    uiFontFamily: getUiFontFamily(),
    contentFontFamily: getContentFontFamily(),
    codeFontFamily: getCodeFontFamily(),
  };
  setSeparateModePreferences({
    enabled: true,
    light: isUntouched(current.light) ? seed : current.light,
    dark: isUntouched(current.dark) ? seed : current.dark,
  });
}

export function subscribeSeparateModes(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSeparateModePreferences(): SeparateModePreferences {
  return useSyncExternalStore(
    subscribeSeparateModes,
    getSeparateModePreferences,
    getSeparateModePreferences,
  );
}

export function resetSeparateModes() {
  persist(DEFAULTS);
}

export const resetSeparateModesForTest = resetSeparateModes;
