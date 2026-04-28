import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIME_THEME_STORAGE_KEY,
  applyLimeThemeMode,
  bindLimeSystemThemeModeListener,
  initializeLimeThemeMode,
  loadLimeThemeMode,
  persistLimeThemeMode,
  resolveLimeThemeMode,
} from "./themeMode";

afterEach(() => {
  const cleanup = bindLimeSystemThemeModeListener();
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-lime-theme");
  document.documentElement.removeAttribute("data-lime-theme-effective");
  document.documentElement.removeAttribute("data-lime-color-scheme");
  document.documentElement.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("themeMode", () => {
  it("未知主题模式应回退到跟随系统", () => {
    expect(resolveLimeThemeMode("legacy")).toBe("system");
    expect(resolveLimeThemeMode(null)).toBe("system");
  });

  it("应用深色模式时应同步根节点 class 与 dataset", () => {
    const effectiveMode = applyLimeThemeMode("dark");

    expect(effectiveMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.limeTheme).toBe("dark");
    expect(document.documentElement.dataset.limeThemeEffective).toBe("dark");
    expect(
      document.documentElement.style.getPropertyValue("--lime-app-bg"),
    ).toBe("#0b1120");
  });

  it("持久化主题模式后应可重新读取", () => {
    persistLimeThemeMode("light");

    expect(localStorage.getItem(LIME_THEME_STORAGE_KEY)).toBe("light");
    expect(loadLimeThemeMode()).toBe("light");
  });

  it("初始化主题模式时应读取持久化配置并应用", () => {
    localStorage.setItem(LIME_THEME_STORAGE_KEY, "dark");

    const effectiveMode = initializeLimeThemeMode();

    expect(effectiveMode).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.limeTheme).toBe("dark");
    expect(document.documentElement.dataset.limeThemeEffective).toBe("dark");
  });

  it("跟随系统时应在系统明暗变化后重新应用主题变量", () => {
    const changeHandlers: Array<() => void> = [];
    const mediaQueryList = {
      matches: true,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_event: string, handler: () => void) => {
        changeHandlers.push(handler);
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQueryList),
    );

    localStorage.setItem(LIME_THEME_STORAGE_KEY, "system");
    const cleanup = bindLimeSystemThemeModeListener();
    const changeHandler = changeHandlers[0];
    if (!changeHandler) {
      throw new Error("未绑定系统主题变化监听");
    }
    changeHandler();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.limeTheme).toBe("system");
    expect(document.documentElement.dataset.limeThemeEffective).toBe("dark");

    cleanup();
  });
});
