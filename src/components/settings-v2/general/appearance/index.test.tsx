import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { LIME_THEME_STORAGE_KEY } from "@/lib/appearance/themeMode";
import {
  LIME_COLOR_SCHEME_STORAGE_KEY,
  LIME_COLOR_SCHEMES,
} from "@/lib/appearance/colorSchemes";
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

  it("皮肤列表应保留全部真实预设并持久化选择", () => {
    act(() => root.render(<AppearanceSettings />));
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect(select.options).toHaveLength(LIME_COLOR_SCHEMES.length);
    const next = LIME_COLOR_SCHEMES.find((skin) => skin.id !== select.value)!;
    act(() => {
      select.value = next.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(window.localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY)).toBe(
      next.id,
    );
  });

  it("随机操作应切换到另一个真实皮肤", () => {
    act(() => root.render(<AppearanceSettings />));
    const previous =
      container.querySelector<HTMLSelectElement>("select")!.value;
    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="随机"]')!
        .click(),
    );
    const next = window.localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY);
    expect(next).not.toBe(previous);
    expect(LIME_COLOR_SCHEMES.some((skin) => skin.id === next)).toBe(true);
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 的模式和皮肤均有可访问名称",
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
      expect(
        container.querySelector("select")?.getAttribute("aria-label"),
      ).toBeTruthy();
      expect(container.textContent).not.toContain("settings.");
    },
  );
});
