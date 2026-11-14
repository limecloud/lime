import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyLimeThemeMode, persistLimeThemeMode } from "./themeMode";
import {
  applyAppearancePreferences,
  initializeLimeAppearance,
} from "./applyAppearance";
import { resetAppearancePreferences } from "./reset";
import { getAccentColor, setAccentColor } from "./accent";
import {
  getCodeFontFamily,
  resetCodeFontFamilyForTest,
  setCodeFontFamily,
} from "./codeFontFamily";
import {
  getCodeFontSize,
  resetCodeFontSizeForTest,
  setCodeFontSize,
} from "./codeFontSize";
import {
  getContentFontFamily,
  resetContentFontFamilyForTest,
  setContentFontFamily,
} from "./contentFontFamily";
import {
  getFontSmoothingEnabled,
  resetFontSmoothingForTest,
  setFontSmoothingEnabled,
} from "./fontSmoothing";
import {
  getPointerCursorsEnabled,
  resetPointerCursorsForTest,
  setPointerCursorsEnabled,
} from "./pointerCursor";
import {
  getReducedMotionPreference,
  resetReducedMotionForTest,
  setReducedMotionPreference,
} from "./reducedMotion";
import {
  getSeparateModePreferences,
  resetSeparateModesForTest,
  setSeparateModePreferences,
  setSeparateModesEnabled,
} from "./separateModes";
import {
  getContentFontSize,
  resetContentFontSizeForTest,
  setContentFontSize,
} from "./typography";
import {
  getChromeTheme,
  getCodeTheme,
  resetThemePresetsForTest,
  setChromeTheme,
  setCodeTheme,
} from "./themePresets";
import {
  getUiFontFamily,
  resetUiFontFamilyForTest,
  setUiFontFamily,
} from "./uiFontFamily";
import {
  getUiFontSize,
  resetUiFontSizeForTest,
  setUiFontSize,
} from "./uiFontSize";

const root = document.documentElement;
let cleanup: (() => void) | null = null;

function resetAll() {
  resetUiFontFamilyForTest();
  resetContentFontFamilyForTest();
  resetUiFontSizeForTest();
  resetContentFontSizeForTest();
  resetCodeFontFamilyForTest();
  resetCodeFontSizeForTest();
  resetPointerCursorsForTest();
  resetReducedMotionForTest();
  resetFontSmoothingForTest();
  setAccentColor("default");
  resetThemePresetsForTest();
  resetSeparateModesForTest();
}

beforeEach(() => {
  window.localStorage.clear();
  resetAll();
  cleanup = initializeLimeAppearance();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  window.localStorage.clear();
  document.documentElement.className = "";
});

describe("applyAppearance", () => {
  it("applies Codex defaults to the document before React renders", () => {
    expect(root.style.getPropertyValue("--lime-ui-font-family")).toContain(
      "system-ui",
    );
    expect(root.style.getPropertyValue("--lime-content-font-family")).toContain(
      "system-ui",
    );
    expect(root.style.getPropertyValue("--lime-content-font-size")).toBe(
      "15px",
    );
    expect(root.style.getPropertyValue("--lime-code-font-family")).toContain(
      "ui-monospace",
    );
    expect(root.style.getPropertyValue("--lime-code-font-size")).toBe("12px");
    expect(root.style.fontSize).toBe("14px");
    expect(root.dataset.pointerCursors).toBe("false");
    expect(root.dataset.fontSmoothing).toBe("true");
    expect(root.dataset.reducedMotion).toBeUndefined();
    expect(root.style.getPropertyValue("--lime-code-surface")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--lime-code-text")).toBe("#0d0d0d");
  });

  it("keeps settings active outside the settings page", () => {
    setPointerCursorsEnabled(true);
    setUiFontSize(16);
    setContentFontSize(20);
    setCodeFontFamily("menlo");
    setCodeFontSize(18);
    setUiFontFamily("mono");
    setContentFontFamily("ui");

    expect(root.dataset.pointerCursors).toBe("true");
    expect(root.style.fontSize).toBe("16px");
    expect(root.style.getPropertyValue("--lime-content-font-size")).toBe(
      "20px",
    );
    expect(root.style.getPropertyValue("--lime-code-font-size")).toBe("18px");
    expect(root.style.getPropertyValue("--lime-code-font-family")).toContain(
      "Menlo",
    );
    expect(root.style.getPropertyValue("--lime-content-font-family")).toBe(
      root.style.getPropertyValue("--lime-ui-font-family"),
    );
    expect(root.style.getPropertyValue("--lime-ui-font-family")).toContain(
      "ui-monospace",
    );
  });

  it("writes Codex reduced-motion ownership and font smoothing", () => {
    setReducedMotionPreference("on");
    expect(root.dataset.reducedMotion).toBe("true");
    setReducedMotionPreference("off");
    expect(root.dataset.reducedMotion).toBe("false");
    setReducedMotionPreference("system");
    expect(root.dataset.reducedMotion).toBeUndefined();

    setFontSmoothingEnabled(false);
    expect(root.dataset.fontSmoothing).toBe("false");
  });

  it("resolves per-mode accent and fonts only while separate modes are on", () => {
    setAccentColor("blue");
    setSeparateModesEnabled(true);
    setSeparateModePreferences({
      light: { accent: "green", uiFontFamily: "serif" },
      dark: { accent: "purple", uiFontFamily: "mono" },
    });

    applyLimeThemeMode("light");
    applyAppearancePreferences();
    expect(root.style.getPropertyValue("--lime-brand")).toBe("#10b981");
    expect(root.style.getPropertyValue("--lime-ui-font-family")).toContain(
      "ui-serif",
    );

    applyLimeThemeMode("dark");
    applyAppearancePreferences();
    expect(root.style.getPropertyValue("--lime-brand")).toBe("#8b5cf6");
    expect(root.style.getPropertyValue("--lime-ui-font-family")).toContain(
      "ui-monospace",
    );

    setSeparateModePreferences({ enabled: false });
    applyAppearancePreferences();
    expect(root.style.getPropertyValue("--lime-brand")).toBe("#3b82f6");
    expect(root.style.getPropertyValue("--lime-ui-font-family")).toContain(
      "system-ui",
    );
  });

  it("projects separate chrome and code theme values per effective mode", () => {
    setSeparateModesEnabled(true);
    setSeparateModePreferences({
      light: { chromeTheme: "github", codeTheme: "github", accent: "default" },
      dark: {
        chromeTheme: "tokyo-night",
        codeTheme: "dracula",
        accent: "default",
      },
    });

    applyLimeThemeMode("light");
    applyAppearancePreferences();
    expect(root.style.getPropertyValue("--lime-surface")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--lime-brand")).toBe("#0969da");
    expect(root.style.getPropertyValue("--lime-code-surface")).toBe("#ffffff");
    expect(root.style.getPropertyValue("--lime-code-syntax-keyword")).toBe(
      "#cf222e",
    );

    applyLimeThemeMode("dark");
    applyAppearancePreferences();
    expect(root.style.getPropertyValue("--lime-surface")).toBe("#1a1b26");
    expect(root.style.getPropertyValue("--lime-brand")).toBe("#3d59a1");
    expect(root.style.getPropertyValue("--lime-code-surface")).toBe("#282a36");
    expect(root.style.getPropertyValue("--lime-code-syntax-keyword")).toBe(
      "#ff79c6",
    );
  });

  it("resets every appearance preference except the mode", () => {
    persistLimeThemeMode("dark");
    setUiFontFamily("serif");
    setContentFontFamily("mono");
    setUiFontSize(16);
    setContentFontSize(24);
    setCodeFontFamily("consolas");
    setCodeFontSize(24);
    setPointerCursorsEnabled(true);
    setReducedMotionPreference("on");
    setFontSmoothingEnabled(false);
    setAccentColor("pink");
    setChromeTheme("solarized");
    setCodeTheme("github");
    setSeparateModesEnabled(true);

    resetAppearancePreferences();

    expect(getUiFontFamily()).toBe("system");
    expect(getContentFontFamily()).toBe("ui");
    expect(getUiFontSize()).toBe(14);
    expect(getContentFontSize()).toBe(15);
    expect(getCodeFontFamily()).toBe("system");
    expect(getCodeFontSize()).toBe(12);
    expect(getPointerCursorsEnabled()).toBe(false);
    expect(getReducedMotionPreference()).toBe("system");
    expect(getFontSmoothingEnabled()).toBe(true);
    expect(getAccentColor()).toBe("default");
    expect(getChromeTheme()).toBe("codex");
    expect(getCodeTheme()).toBe("codex");
    expect(getSeparateModePreferences().enabled).toBe(false);
    expect(root.style.getPropertyValue("--lime-surface")).toBe("");
    expect(root.style.getPropertyValue("--lime-code-surface")).toBe("#111111");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
  });
});
