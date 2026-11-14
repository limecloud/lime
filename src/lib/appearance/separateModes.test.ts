import { beforeEach, describe, expect, it } from "vitest";
import { resetAccentColorForTest, setAccentColor } from "./accent";
import { resetCodeFontFamilyForTest } from "./codeFontFamily";
import { resetContentFontFamilyForTest } from "./contentFontFamily";
import {
  getSeparateModePreferences,
  resetSeparateModesForTest,
  setSeparateModePreferences,
  setSeparateModesEnabled,
} from "./separateModes";
import {
  getChromeTheme,
  getCodeTheme,
  resetThemePresetsForTest,
  setChromeTheme,
  setCodeTheme,
} from "./themePresets";
import { resetUiFontFamilyForTest, setUiFontFamily } from "./uiFontFamily";

describe("separateModes", () => {
  beforeEach(() => {
    resetSeparateModesForTest();
    resetAccentColorForTest();
    resetThemePresetsForTest();
    resetUiFontFamilyForTest();
    resetContentFontFamilyForTest();
    resetCodeFontFamilyForTest();
  });

  it("seeds both modes from the current appearance when enabled", () => {
    setAccentColor("green");
    setUiFontFamily("serif");
    setChromeTheme("solarized");
    setCodeTheme("github");
    setSeparateModesEnabled(true);
    const preferences = getSeparateModePreferences();
    expect(preferences.enabled).toBe(true);
    expect(preferences.light.accent).toBe("green");
    expect(preferences.dark.accent).toBe("green");
    expect(preferences.light.uiFontFamily).toBe("serif");
    expect(preferences.dark.uiFontFamily).toBe("serif");
    expect(preferences.light.codeFontFamily).toBe("system");
    expect(preferences.dark.codeFontFamily).toBe("system");
    expect(preferences.light.chromeTheme).toBe("solarized");
    expect(preferences.dark.chromeTheme).toBe("solarized");
    expect(preferences.light.codeTheme).toBe("github");
    expect(preferences.dark.codeTheme).toBe("github");
    expect(getChromeTheme()).toBe("solarized");
    expect(getCodeTheme()).toBe("github");
  });

  it("persists independent light and dark values", () => {
    setSeparateModesEnabled(true);
    setSeparateModePreferences({
      light: {
        accent: "blue",
        chromeTheme: "github",
        codeTheme: "solarized",
        contentFontFamily: "serif",
      },
      dark: {
        accent: "orange",
        chromeTheme: "tokyo-night",
        codeTheme: "dracula",
        contentFontFamily: "mono",
      },
    });
    const preferences = getSeparateModePreferences();
    expect(preferences.light).toMatchObject({
      accent: "blue",
      chromeTheme: "github",
      codeTheme: "solarized",
      contentFontFamily: "serif",
    });
    expect(preferences.dark).toMatchObject({
      accent: "orange",
      chromeTheme: "tokyo-night",
      codeTheme: "dracula",
      contentFontFamily: "mono",
    });
  });

  it("does not overwrite customised modes when re-enabled", () => {
    setSeparateModesEnabled(true);
    setSeparateModePreferences({
      light: {
        accent: "pink",
        chromeTheme: "rose-pine",
        codeTheme: "xcode",
        uiFontFamily: "mono",
      },
      dark: {
        accent: "yellow",
        chromeTheme: "nord",
        codeTheme: "one",
        uiFontFamily: "serif",
      },
    });
    setSeparateModesEnabled(false);
    setAccentColor("green");
    setChromeTheme("solarized");
    setSeparateModesEnabled(true);
    const preferences = getSeparateModePreferences();
    expect(preferences.light.accent).toBe("pink");
    expect(preferences.dark.accent).toBe("yellow");
    expect(preferences.light.chromeTheme).toBe("rose-pine");
    expect(preferences.dark.chromeTheme).toBe("nord");
    expect(preferences.light.codeTheme).toBe("xcode");
    expect(preferences.dark.codeTheme).toBe("one");
  });
});
