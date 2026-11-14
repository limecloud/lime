import { describe, expect, it } from "vitest";
import {
  CODEX_THEME_IDS,
  DEFAULT_CHROME_THEME_ID,
  DEFAULT_CODE_THEME_ID,
  buildChromeThemeVariables,
  buildCodeThemeVariables,
  getChromeThemeOptions,
  getCodeThemeName,
  getCodeThemeOptions,
  getCodexThemePreset,
  resolveChromeTheme,
  resolveCodeTheme,
} from "./codexThemePresets";
import { initializeLimeAppearance } from "./applyAppearance";
import { setChromeTheme } from "./themePresets";

describe("Codex theme presets", () => {
  it("contains every Codex chrome/code theme id with the extracted labels", () => {
    expect(CODEX_THEME_IDS).toHaveLength(29);
    expect(getCodexThemePreset("codex").label).toBe("Codex");
    expect(getCodexThemePreset("github").label).toBe("GitHub");
    expect(getCodexThemePreset("night-owl").label).toBe("Night Owl");
    expect(getCodexThemePreset("rose-pine").label).toBe("Rose Pine");
    expect(getCodexThemePreset("vscode-plus").label).toBe("VS Code Plus");
    expect(getCodeThemeName("codex", "light")).toBe("Codex Light");
    expect(getCodeThemeName("codex", "dark")).toBe("Codex Dark");
    expect(getCodeThemeName("github", "light")).toBe("github-light-default");
    expect(DEFAULT_CHROME_THEME_ID).toBe("codex");
    expect(DEFAULT_CODE_THEME_ID).toBe("codex");
  });

  it("keeps exact Codex chrome anchor colors", () => {
    const light = resolveChromeTheme("github", "light");
    expect(light).toMatchObject({
      accent: "#0969da",
      ink: "#1f2328",
      surface: "#ffffff",
      semanticColors: { diffAdded: "#1a7f37", diffRemoved: "#cf222e" },
    });
    const dark = resolveChromeTheme("github", "dark");
    expect(dark).toMatchObject({
      accent: "#1f6feb",
      ink: "#e6edf3",
      surface: "#0d1117",
    });
    expect(resolveChromeTheme("codex", "light")).toBeNull();
    expect(resolveChromeTheme("proof", "dark")).toBeNull();
  });

  it("filters options exactly like Codex's variant registry", () => {
    const light = getChromeThemeOptions("light").map((option) => option.id);
    const dark = getChromeThemeOptions("dark").map((option) => option.id);
    expect(light).toContain("github");
    expect(light).toContain("proof");
    expect(light).not.toContain("ayu");
    expect(light).not.toContain("tokyo-night");
    expect(dark).toContain("ayu");
    expect(dark).toContain("tokyo-night");
    expect(dark).not.toContain("proof");

    const dual = getChromeThemeOptions("light", {
      requireBothVariants: true,
    }).map((option) => option.id);
    expect(dual).toContain("codex");
    expect(dual).toContain("github");
    expect(dual).not.toContain("proof");
    expect(dual).not.toContain("ayu");
    expect(getCodeThemeOptions("dark")).toEqual(getChromeThemeOptions("dark"));
  });

  it("projects chrome anchors onto Lime semantic variables", () => {
    const light = resolveChromeTheme("github", "light")!;
    const variables = buildChromeThemeVariables(light, "light", {
      useThemeAccent: true,
    });
    expect(variables["--lime-surface"]).toBe("#ffffff");
    expect(variables["--lime-text"]).toBe("#1f2328");
    expect(variables["--lime-brand"]).toBe("#0969da");
    expect(variables["--lime-diff-add-border"]).toBe("#1a7f37");
    expect(variables["--background"]).toBe("0 0% 100%");
    expect(variables["--lime-code-surface"]).toBeUndefined();

    const withoutAccent = buildChromeThemeVariables(light, "light", {
      useThemeAccent: false,
    });
    expect(withoutAccent["--lime-brand"]).toBeUndefined();
    expect(withoutAccent["--lime-surface"]).toBe("#ffffff");
  });

  it("projects exact Codex code editor and syntax colors", () => {
    const light = buildCodeThemeVariables(resolveCodeTheme("codex", "light"));
    expect(light["--lime-code-surface"]).toBe("#ffffff");
    expect(light["--lime-code-diff-surface"]).toBe("#ffffff");
    expect(light["--lime-code-text"]).toBe("#0d0d0d");
    expect(light["--lime-code-diff-text"]).toBe("#0d0d0d");
    expect(light["--lime-code-syntax-comment"]).toBe("#666666");
    expect(light["--lime-code-syntax-keyword"]).toBe("#d53538");
    expect(light["--lime-code-syntax-string"]).toBe("#008809");

    const dark = buildCodeThemeVariables(resolveCodeTheme("github", "dark"));
    expect(dark["--lime-code-surface"]).toBe("#0d1117");
    expect(dark["--lime-code-text"]).toBe("#e6edf3");
    expect(dark["--lime-code-syntax-keyword"]).toBe("#ff7b72");

    const fallback = buildCodeThemeVariables(resolveCodeTheme("proof", "dark"));
    expect(fallback["--lime-code-surface"]).toBe("#111111");
  });

  it("applies chrome and code presets through the theme owner", () => {
    const cleanup = initializeLimeAppearance();
    try {
      setChromeTheme("github");
      const root = document.documentElement;
      expect(root.style.getPropertyValue("--lime-surface")).toBe("#ffffff");
      expect(root.style.getPropertyValue("--lime-brand")).toBe("#0969da");
      expect(root.style.getPropertyValue("--lime-code-surface")).toBe(
        "#ffffff",
      );

      setChromeTheme("codex");
      expect(root.style.getPropertyValue("--lime-surface")).toBe("");
      expect(root.style.getPropertyValue("--lime-code-surface")).toBe(
        "#ffffff",
      );
    } finally {
      cleanup();
    }
  });
});
