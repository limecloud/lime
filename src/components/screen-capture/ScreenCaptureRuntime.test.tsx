import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ScreenCaptureRuntime } from "./ScreenCaptureRuntime";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  capture: vi.fn(),
  deliver: vi.fn(),
  newTab: vi.fn(),
}));
vi.mock("@/lib/desktop-host/global-shortcut", () => ({
  register: mocks.register,
  unregister: mocks.unregister,
}));
vi.mock("@/lib/screenCapture", () => ({
  captureScreenRegion: mocks.capture,
}));
vi.mock("@/lib/appSnapshot", () => ({
  deliverAppSnapshot: mocks.deliver,
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
  mocks.capture.mockResolvedValue(new File(["x"], "shot.png", { type: "image/png" }));
  mocks.deliver.mockReturnValue(true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ScreenCaptureRuntime", () => {
  it("注册两个全局截图快捷键，当前聊天直接投递", async () => {
    await act(async () => {
      root.render(<ScreenCaptureRuntime />);
      await Promise.resolve();
    });
    expect(mocks.register).toHaveBeenCalledWith(
      "Control+Shift+4",
      expect.any(Function),
    );
    expect(mocks.register).toHaveBeenCalledWith(
      "Control+Alt+Shift+4",
      expect.any(Function),
    );
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lime:screenshot-current-chat"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.capture).toHaveBeenCalled();
    expect(mocks.deliver).toHaveBeenCalled();
    expect(mocks.newTab).not.toHaveBeenCalled();
  });

  it("新聊天截图先创建标签再投递", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<ScreenCaptureRuntime />);
        await Promise.resolve();
      });
      await act(async () => {
        window.dispatchEvent(new CustomEvent("lime:screenshot-new-chat"));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.newTab).toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(450);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.deliver).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
