import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { LIME_THEME_STORAGE_KEY } from "@/lib/appearance/themeMode";
import { AppearanceSettings } from "./index";

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
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
});
