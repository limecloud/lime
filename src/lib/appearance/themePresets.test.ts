import { beforeEach, describe, expect, it } from "vitest";
import {
  CHROME_THEME_STORAGE_KEY,
  CODE_THEME_STORAGE_KEY,
  getChromeTheme,
  getCodeTheme,
  resetThemePresetsForTest,
  setChromeTheme,
  setCodeTheme,
} from "./themePresets";
import type { CodeThemeId } from "./codexThemePresets";

describe("theme preset preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetThemePresetsForTest();
  });

  it("persists chrome and code theme ids", () => {
    setChromeTheme("github");
    setCodeTheme("solarized");
    expect(getChromeTheme()).toBe("github");
    expect(getCodeTheme()).toBe("solarized");
    expect(window.localStorage.getItem(CHROME_THEME_STORAGE_KEY)).toBe(
      "github",
    );
    expect(window.localStorage.getItem(CODE_THEME_STORAGE_KEY)).toBe(
      "solarized",
    );
  });

  it("falls back to Codex defaults for unknown ids", () => {
    setChromeTheme("not-a-theme" as CodeThemeId);
    setCodeTheme("not-a-theme" as CodeThemeId);
    expect(getChromeTheme()).toBe("codex");
    expect(getCodeTheme()).toBe("codex");
  });

  it("resets both presets", () => {
    setChromeTheme("tokyo-night");
    setCodeTheme("dracula");
    resetThemePresetsForTest();
    expect(getChromeTheme()).toBe("codex");
    expect(getCodeTheme()).toBe("codex");
  });
});
