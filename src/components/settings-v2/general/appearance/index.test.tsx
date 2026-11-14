import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { LIME_THEME_STORAGE_KEY } from "@/lib/appearance/themeMode";
import { initializeLimeAppearance } from "@/lib/appearance/applyAppearance";
import { setUiFontFamily } from "@/lib/appearance/uiFontFamily";
import {
  resetThemePresetsForTest,
  setChromeTheme,
  setCodeTheme,
} from "@/lib/appearance/themePresets";
import { resetSeparateModesForTest } from "@/lib/appearance/separateModes";
import { AppearanceSettings } from "./index";

let root: Root;
let container: HTMLDivElement;
let cleanupAppearance: (() => void) | null = null;
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  resetThemePresetsForTest();
  resetSeparateModesForTest();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  await changeLimeLocale("zh-CN");
  cleanupAppearance = initializeLimeAppearance();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  cleanupAppearance?.();
  cleanupAppearance = null;
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-reduced-motion");
  vi.unstubAllGlobals();
});

describe("AppearanceSettings", () => {
  it("主题选择应持久化并立即更新应用的明暗模式", () => {
    act(() => root.render(<AppearanceSettings />));
    const dark = container.querySelector<HTMLButtonElement>(
      '[role="radio"][aria-label="深色"]',
    )!;
    act(() => dark.click());
    expect(window.localStorage.getItem(LIME_THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(
      container.querySelectorAll('[role="radio"][aria-checked="true"]'),
    ).toHaveLength(1);
  });

  it("方向键切换模式并移动焦点，Tab 只进入已选模式", () => {
    act(() => root.render(<AppearanceSettings />));
    const radios = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    const current = radios.find((radio) => radio.tabIndex === 0)!;
    current.focus();
    act(() =>
      current.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(radios.at(-1));
    expect(radios.at(-1)?.getAttribute("aria-checked")).toBe("true");
    act(() =>
      radios
        .at(-1)!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        ),
    );
    expect(document.activeElement).toBe(radios[0]);
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual([radios[0]]);
    expect(window.localStorage.getItem(LIME_THEME_STORAGE_KEY)).toBe("system");
  });

  it("忽略旧皮肤偏好，外观页只提供系统、浅色和深色模式", () => {
    localStorage.setItem("lime.appearance.skin", "dream-blossom");
    act(() => root.render(<AppearanceSettings />));
    expect(container.querySelector("select")).toBeNull();
    expect(
      container.querySelector('[data-settings-target="appearance-skin"]'),
    ).toBeNull();
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(document.documentElement.dataset.limeSkin).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--lime-app-bg"),
    ).toBe("");
  });

  it("另一个窗口修改外观模式后应同步当前选项和根节点", () => {
    act(() => root.render(<AppearanceSettings />));
    act(() => {
      localStorage.setItem(LIME_THEME_STORAGE_KEY, "dark");
      window.dispatchEvent(
        new StorageEvent("storage", { key: LIME_THEME_STORAGE_KEY }),
      );
    });
    expect(
      container
        .querySelector('[role="radio"][aria-label="深色"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 的三种外观模式均有可访问名称",
    async (locale) => {
      await changeLimeLocale(locale);
      act(() => root.render(<AppearanceSettings />));
      expect(container.querySelector("h1")?.textContent).not.toContain(
        "settings.",
      );
      expect(
        container
          .querySelector('[role="radiogroup"]')
          ?.getAttribute("aria-label"),
      ).toBeTruthy();
      expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
      expect(container.querySelector("select")).toBeNull();
      expect(container.textContent).not.toContain("settings.");
    },
  );

  it("Codex 字号范围写入根节点并在外观页关闭后保持", () => {
    act(() => root.render(<AppearanceSettings />));
    const codeSize = container.querySelector<HTMLInputElement>(
      '[data-settings-search-target="appearance-code-font-size"] input[type="number"]',
    )!;
    expect(codeSize.value).toBe("12");
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(codeSize, "18");
      codeSize.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() =>
      codeSize.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(
      document.documentElement.style.getPropertyValue("--lime-code-font-size"),
    ).toBe("18px");

    act(() => root.unmount());
    expect(
      document.documentElement.style.getPropertyValue("--lime-code-font-size"),
    ).toBe("18px");
    root = createRoot(container);
  });

  it("减少动态效果按 Codex 三态写入 data-reduced-motion", () => {
    act(() => root.render(<AppearanceSettings />));
    const row = container.querySelector(
      '[data-settings-search-target="appearance-reduced-motion"]',
    )!;
    const choices = [...row.querySelectorAll<HTMLButtonElement>("button")];
    expect(choices.map((button) => button.textContent)).toEqual([
      "跟随系统",
      "开启",
      "关闭",
    ]);
    act(() => choices[1].click());
    expect(document.documentElement.dataset.reducedMotion).toBe("true");
    act(() => choices[2].click());
    expect(document.documentElement.dataset.reducedMotion).toBe("false");
    act(() => choices[0].click());
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
  });

  it("分别设置模式时提供浅色和深色的强调色与字体", () => {
    setUiFontFamily("serif");
    act(() => root.render(<AppearanceSettings />));
    const separate = container.querySelector<HTMLButtonElement>(
      '[data-settings-search-target="appearance-separate-modes"] [role="switch"]',
    )!;
    act(() => separate.click());
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-light-accent"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-light-ui-font"]',
      )?.textContent,
    ).toContain("衬线");
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-light-code-font"]',
      )?.textContent,
    ).toContain("系统等宽");
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-dark-content-font"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-dark-code-font"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-accent-color"]',
      ),
    ).toBeNull();
    expect(
      JSON.parse(localStorage.getItem("lime.appearance.separate-modes.v1")!),
    ).toMatchObject({
      enabled: true,
      light: {
        uiFontFamily: "serif",
        chromeTheme: "codex",
        codeTheme: "codex",
      },
      dark: { uiFontFamily: "serif", chromeTheme: "codex", codeTheme: "codex" },
    });
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-light-chrome-theme"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-dark-code-theme"]',
      ),
    ).not.toBeNull();
  });

  it("主题选择器展示 Codex 预设名称并持久化", () => {
    setChromeTheme("github");
    setCodeTheme("solarized");
    act(() => root.render(<AppearanceSettings />));
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-chrome-theme"]',
      )?.textContent,
    ).toContain("GitHub");
    expect(
      container.querySelector(
        '[data-settings-search-target="appearance-code-theme"]',
      )?.textContent,
    ).toContain("Solarized");
    expect(localStorage.getItem("lime.appearance.chrome-theme.v1")).toBe(
      "github",
    );
    expect(localStorage.getItem("lime.appearance.code-theme.v1")).toBe(
      "solarized",
    );
  });

  it("重置覆盖页面全部外观设置但不改动明暗模式", () => {
    act(() => root.render(<AppearanceSettings />));
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[role="radio"][aria-label="深色"]')!
        .click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-settings-search-target="appearance-smart-punctuation"] [role="switch"]',
        )!
        .click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-settings-search-target="appearance-reduced-motion"] button:nth-of-type(2)',
        )!
        .click(),
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-settings-search-target="appearance-pointer-cursors"] [role="switch"]',
        )!
        .click(),
    );
    expect(localStorage.getItem("lime.appearance.smart-punctuation.v1")).toBe(
      "true",
    );
    expect(document.documentElement.dataset.reducedMotion).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="appearance-reset-defaults"]',
        )!
        .click(),
    );
    expect(localStorage.getItem("lime.appearance.smart-punctuation.v1")).toBe(
      "false",
    );
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
    expect(localStorage.getItem("lime.appearance.pointer-cursors.v1")).toBe(
      "false",
    );
    expect(localStorage.getItem("lime.appearance.code-font-size.v1")).toBe(
      "12",
    );
    expect(localStorage.getItem("lime.appearance.code-font-family.v1")).toBe(
      "system",
    );
    expect(localStorage.getItem(LIME_THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      container
        .querySelector('[role="radio"][aria-label="深色"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("字体平滑仅在 macOS 显示并实际写入根节点", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Macintosh");
    act(() => root.render(<AppearanceSettings />));
    const row = container.querySelector(
      '[data-settings-search-target="appearance-font-smoothing"]',
    )!;
    expect(row).not.toBeNull();
    act(() => row.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(document.documentElement.dataset.fontSmoothing).toBe("false");
  });
});
