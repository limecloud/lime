import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { QuickCaptureOverlay } from "./QuickCaptureOverlay";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  newTab: vi.fn(),
}));
vi.mock("@/lib/desktop-host/global-shortcut", () => ({
  register: mocks.register,
  unregister: mocks.unregister,
}));
vi.mock("@/lib/conversationTabs", () => ({
  requestNewConversationTab: mocks.newTab,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  mocks.register.mockResolvedValue(undefined);
  mocks.unregister.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("QuickCaptureOverlay", () => {
  it("Alt+Space 打开，Enter 创建新聊天并注入 draft", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<QuickCaptureOverlay />);
        await Promise.resolve();
      });
      expect(mocks.register).toHaveBeenCalledWith("Alt+Space", expect.any(Function));
      await act(async () => {
        window.dispatchEvent(new CustomEvent("lime:open-quick-capture"));
      });
      const textarea = document.querySelector("textarea")!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        setter?.call(textarea, "quick idea");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(mocks.newTab).toHaveBeenCalled();
      const drafts: string[] = [];
      window.addEventListener("lime:set-composer-draft", (event) => {
        drafts.push((event as CustomEvent<{ text: string }>).detail.text);
      });
      act(() => vi.advanceTimersByTime(350));
      expect(drafts).toEqual(["quick idea"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
