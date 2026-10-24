import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppNavigationContext } from "@/contexts/AppNavigationContext";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SettingsTabs } from "@/types/settings";
import { BrowserManagementHeader } from "./BrowserManagementHeader";

let container: HTMLDivElement;
let root: Root;
const back = vi.fn();
const navigate = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  back.mockReset();
  navigate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "exposes translated navigation, a disabled forward action and working breadcrumbs in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await act(async () =>
      root.render(
        <AppNavigationContext.Provider value={navigate}>
          <BrowserManagementHeader title="Current page" onBack={back} />
        </AppNavigationContext.Provider>,
      ),
    );
    const controls = container.querySelector("[role=group]")!;
    const buttons = controls.querySelectorAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    for (const control of [
      controls,
      ...buttons,
      container.querySelector("nav")!,
    ]) {
      expect(control.getAttribute("aria-label")).toBeTruthy();
      expect(control.getAttribute("aria-label")).not.toContain(
        "browserManagement.",
      );
    }
    const ancestors =
      container.querySelectorAll<HTMLButtonElement>("nav button");
    expect(ancestors).toHaveLength(2);
    expect(container.querySelector("[aria-current=page] h1")?.textContent).toBe(
      "Current page",
    );
    expect(container.textContent).not.toMatch(
      /(?:browserManagement|settings)\./,
    );
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
      ancestors[1].click();
      ancestors[0].click();
    });
    expect(back).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("settings", {
      tab: SettingsTabs.General,
    });
  },
);
