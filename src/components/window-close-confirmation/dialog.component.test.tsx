import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { WindowCloseConfirmationDialog } from "./dialog";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
};

describe("WindowCloseConfirmationDialog", () => {
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s defaults focus to Cancel and confirms the checkbox value",
    async (locale) => {
      await changeLimeLocale(locale);
      const confirm = vi.fn(),
        close = vi.fn();
      act(() =>
        root.render(
          <WindowCloseConfirmationDialog onClose={close} onConfirm={confirm} />,
        ),
      );
      await settle();
      const t = getLimeI18n().getFixedT(locale, "settings");
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain(
        t("desktop.windowCloseConfirmation.title"),
      );
      expect(document.activeElement?.textContent).toBe(
        t("desktop.windowCloseConfirmation.cancel"),
      );
      expect(dialog.querySelectorAll("button")).toHaveLength(3);
      const checkbox =
        dialog.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
      act(() => checkbox.click());
      act(() =>
        dialog
          .querySelector<HTMLFormElement>("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(confirm).toHaveBeenCalledExactlyOnceWith(true);
      expect(close).not.toHaveBeenCalled();
      expect(dialog.textContent).not.toMatch(/codex/i);
    },
  );
  it("Escape cancels and restores focus on unmount", async () => {
    await changeLimeLocale("en-US");
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const close = vi.fn(),
      confirm = vi.fn();
    act(() =>
      root.render(
        <WindowCloseConfirmationDialog onClose={close} onConfirm={confirm} />,
      ),
    );
    await settle();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    act(() => root.render(null));
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });
});
