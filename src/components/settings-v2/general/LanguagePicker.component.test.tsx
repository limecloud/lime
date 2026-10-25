import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { LanguagePicker } from "./LanguagePicker";
import type { LocalePreference } from "@/i18n/locales";

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const settle = async () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await changeLimeLocale("zh-CN");
});
async function mount(value: LocalePreference = "auto", disabled = false) {
  await act(async () =>
    root.render(
      <LanguagePicker value={value} disabled={disabled} onChange={onChange} />,
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>("button")!;
async function open() {
  act(() => trigger().click());
  await settle();
}
async function search(value: string) {
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s 本地化自动检测和搜索，保留五种语言本名并按本地化名称搜索",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    const t = getLimeI18n().getFixedT(locale, "settings");
    expect(trigger().textContent).toBe(
      t("settings.desktop.autoDetectLanguage"),
    );
    expect(trigger().textContent).not.toContain("settings.");
    await open();
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
    expect(input.placeholder).toBe(t("settings.desktop.searchLanguages"));
    expect(document.activeElement).toBe(input);
    for (const label of [
      "简体中文",
      "繁體中文",
      "English",
      "日本語",
      "한국어",
    ]) {
      expect(
        [...document.querySelectorAll("[cmdk-item]")].some(
          (node) => node.textContent === label,
        ),
      ).toBe(true);
    }
    await search(
      new Intl.DisplayNames([locale], { type: "language" }).of("ja-JP")!,
    );
    expect(
      [...document.querySelectorAll("[cmdk-item]")].map(
        (node) => node.textContent,
      ),
    ).toEqual([t("settings.desktop.autoDetectLanguage"), "日本語"]);
  },
);

it("本名与英文别名都可搜索；自动检测固定在列表首位，Escape 不保存并恢复焦点", async () => {
  await changeLimeLocale("zh-CN");
  await mount("ko-KR");
  await open();
  for (const query of ["日本語", " Japanese "]) {
    await search(query);
    expect(document.querySelectorAll("[cmdk-item]")).toHaveLength(2);
    expect(document.querySelector("[cmdk-item]:last-child")?.textContent).toBe(
      "日本語",
    );
  }
  await search("no matching language");
  expect(document.querySelectorAll("[cmdk-item]")).toHaveLength(1);
  act(() =>
    document.querySelector<HTMLInputElement>("[cmdk-input]")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  expect(document.querySelector("[cmdk-input]")).toBeNull();
  await act(async () => {
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger()));
  });
  await open();
  expect(document.querySelector<HTMLInputElement>("[cmdk-input]")!.value).toBe(
    "",
  );
});

it("选择仅提交一次；disabled 或重新选择当前语言不写入", async () => {
  await mount("zh-CN", true);
  expect(trigger().disabled).toBe(true);
  await mount("zh-CN");
  await open();
  const select = (value: string) =>
    act(() =>
      document
        .querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!
        .click(),
    );
  select("zh-CN");
  await settle();
  expect(onChange).not.toHaveBeenCalled();
  await open();
  select("en-US");
  await settle();
  expect(onChange).toHaveBeenCalledExactlyOnceWith("en-US");
  expect(document.querySelector("[cmdk-input]")).toBeNull();
});

it("搜索后可用方向键和 Enter 选择，选择完成恢复触发器焦点", async () => {
  await mount("zh-CN");
  await open();
  await search("Japanese");
  const input = document.querySelector<HTMLInputElement>("[cmdk-input]")!;
  const press = (key: string) =>
    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      ),
    );
  press("Home");
  press("ArrowDown");
  await settle();
  press("Enter");
  await settle();
  expect(onChange).toHaveBeenCalledExactlyOnceWith("ja-JP");
  await act(async () =>
    vi.waitFor(() => expect(document.activeElement).toBe(trigger())),
  );
});
