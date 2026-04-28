import { applyLimeColorScheme, loadLimeColorSchemeId } from "./colorSchemes";

export const LIME_THEME_STORAGE_KEY = "theme";
export const LIME_THEME_CHANGED_EVENT = "lime-theme-changed";

export type LimeThemeMode = "light" | "dark" | "system";
export type LimeEffectiveThemeMode = "light" | "dark";

export interface LimeThemeModeOption {
  id: LimeThemeMode;
  label: string;
  description: string;
}

export interface LimeThemeChangedEventDetail {
  themeMode: LimeThemeMode;
  effectiveThemeMode: LimeEffectiveThemeMode;
}

export const LIME_THEME_MODE_OPTIONS: readonly LimeThemeModeOption[] = [
  {
    id: "light",
    label: "浅色",
    description: "适合白天和高亮环境。",
  },
  {
    id: "dark",
    label: "深色",
    description: "降低夜间使用时的眩光。",
  },
  {
    id: "system",
    label: "跟随系统",
    description: "自动同步系统外观。",
  },
];

const themeModes = new Set<LimeThemeMode>(["light", "dark", "system"]);
let systemThemeCleanup: (() => void) | null = null;

export function resolveLimeThemeMode(
  value: string | null | undefined,
): LimeThemeMode {
  return themeModes.has(value as LimeThemeMode)
    ? (value as LimeThemeMode)
    : "system";
}

export function getSystemLimeThemeMode(): LimeEffectiveThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getEffectiveLimeThemeMode(
  themeMode: LimeThemeMode,
): LimeEffectiveThemeMode {
  return themeMode === "system" ? getSystemLimeThemeMode() : themeMode;
}

export function loadLimeThemeMode(): LimeThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  return resolveLimeThemeMode(
    window.localStorage.getItem(LIME_THEME_STORAGE_KEY),
  );
}

export function applyLimeThemeMode(themeMode: string): LimeEffectiveThemeMode {
  const resolvedThemeMode = resolveLimeThemeMode(themeMode);
  const effectiveThemeMode = getEffectiveLimeThemeMode(resolvedThemeMode);

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle(
      "dark",
      effectiveThemeMode === "dark",
    );
    document.documentElement.dataset.limeTheme = resolvedThemeMode;
    document.documentElement.dataset.limeThemeEffective = effectiveThemeMode;
    applyLimeColorScheme(loadLimeColorSchemeId(), { effectiveThemeMode });
  }

  return effectiveThemeMode;
}

function dispatchLimeThemeChanged(
  themeMode: LimeThemeMode,
  effectiveThemeMode: LimeEffectiveThemeMode,
) {
  if (typeof window === "undefined") {
    return;
  }

  const detail: LimeThemeChangedEventDetail = {
    themeMode,
    effectiveThemeMode,
  };
  window.dispatchEvent(new CustomEvent(LIME_THEME_CHANGED_EVENT, { detail }));
}

export function bindLimeSystemThemeModeListener(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }

  if (systemThemeCleanup) {
    return systemThemeCleanup;
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChanged = () => {
    if (loadLimeThemeMode() !== "system") {
      return;
    }

    const effectiveThemeMode = applyLimeThemeMode("system");
    dispatchLimeThemeChanged("system", effectiveThemeMode);
  };

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", handleSystemThemeChanged);
  } else {
    mediaQuery.addListener?.(handleSystemThemeChanged);
  }

  systemThemeCleanup = () => {
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener("change", handleSystemThemeChanged);
    } else {
      mediaQuery.removeListener?.(handleSystemThemeChanged);
    }
    systemThemeCleanup = null;
  };

  return systemThemeCleanup;
}

export function initializeLimeThemeMode(): LimeEffectiveThemeMode {
  const effectiveThemeMode = applyLimeThemeMode(loadLimeThemeMode());
  bindLimeSystemThemeModeListener();
  return effectiveThemeMode;
}

export function persistLimeThemeMode(themeMode: string): LimeThemeMode {
  const resolvedThemeMode = resolveLimeThemeMode(themeMode);
  const effectiveThemeMode = applyLimeThemeMode(resolvedThemeMode);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(LIME_THEME_STORAGE_KEY, resolvedThemeMode);
    dispatchLimeThemeChanged(resolvedThemeMode, effectiveThemeMode);
  }

  return resolvedThemeMode;
}
