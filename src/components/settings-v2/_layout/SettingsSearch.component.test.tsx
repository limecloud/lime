import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { SettingsTabs } from "@/types/settings";
import { SettingsSidebar } from "./SettingsSidebar";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.__LIME_OEM_CLOUD__ = { enabled: false };
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.__LIME_OEM_CLOUD__;
  await changeLimeLocale("zh-CN");
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s searches an existing field whose text is absent from the section title",
  async (locale) => {
    await changeLimeLocale(locale);
    const t = getLimeI18n().getFixedT(locale, "settings");
    await act(async () =>
      root.render(
        <SettingsSidebar
          activeTab={SettingsTabs.About}
          onTabChange={vi.fn()}
        />,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="settings-sidebar-search"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, t("settings.personalization.instructions"));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[role="option"]')?.textContent).toContain(
      t("settings.personalization.instructions"),
    );
  },
);

async function mountSidebar() {
  await changeLimeLocale("en-US");
  const select = vi.fn();
  const prefetch = vi.fn();
  await act(async () =>
    root.render(
      <SettingsSidebar
        activeTab={SettingsTabs.About}
        onTabChange={vi.fn()}
        onSearchSelect={select}
        onTabPrefetch={prefetch}
      />,
    ),
  );
  return { select, prefetch };
}
async function enter(
  value: string,
  input = container.querySelector<HTMLInputElement>(
    '[data-testid="settings-sidebar-search"]',
  )!,
) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
async function key(
  input: HTMLElement,
  value: string,
  options: { ctrlKey?: boolean; isComposing?: boolean } = {},
) {
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, ...options }),
    ),
  );
}

it("selects a highlighted result with arrows/Enter and prefetches its section", async () => {
  const { select, prefetch } = await mountSidebar();
  const input = await enter("a");
  const options = [...container.querySelectorAll('[role="option"]')];
  expect(options.length).toBeGreaterThan(1);
  await key(input, "ArrowDown");
  expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
  expect(options[1].getAttribute("aria-selected")).toBe("true");
  expect(prefetch).toHaveBeenCalled();
  await key(input, "ArrowUp");
  expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);
  await key(input, "Enter");
  expect(select).toHaveBeenCalledTimes(1);
  expect(select.mock.calls[0][0].label).toBe(options[0].textContent);
});
it("does not select during IME composition, then accepts a real Enter", async () => {
  const { select } = await mountSidebar();
  const input = await enter("instructions");
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await key(input, "Enter");
  await key(input, "Enter", { isComposing: true });
  expect(select).not.toHaveBeenCalled();
  await act(async () =>
    input.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    ),
  );
  await key(input, "Enter");
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: "memory-instructions" }),
  );
});
it("Escape and clear restore navigation; no-results cannot select", async () => {
  const { select } = await mountSidebar();
  const input = await enter("no such setting 7634");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "No matching settings",
  );
  await key(input, "Enter");
  expect(select).not.toHaveBeenCalled();
  await key(input, "Escape");
  expect(input.value).toBe("");
  expect(
    container.querySelector('[data-testid="settings-sidebar-tab-about"]'),
  ).not.toBeNull();
  await enter("instructions");
  const clear = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Clear settings search"]',
  )!;
  await act(async () => clear.click());
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
});
it("pointer selection keeps the input available for dirty-navigation focus restoration", async () => {
  const { select } = await mountSidebar();
  const input = await enter("instructions");
  const result = container.querySelector<HTMLElement>('[role="option"]')!;
  await act(async () => {
    expect(
      result.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
    result.click();
  });
  expect(document.activeElement).toBe(input);
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: "memory-instructions" }),
  );
});
it("narrow-screen shortcut focuses the same search and preserves keyboard navigation", async () => {
  const { select } = await mountSidebar();
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
  await key(document.body, "f", { ctrlKey: true });
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="settings-sidebar-search"]',
  )!;
  expect(document.activeElement).toBe(input);
  await enter("instructions", input);
  expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(1);
  await key(input, "Enter");
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({ targetId: "memory-instructions" }),
  );
  await key(input, "Escape");
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
  vi.restoreAllMocks();
});
