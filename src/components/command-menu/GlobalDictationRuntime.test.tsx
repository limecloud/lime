import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDictationRuntime } from "./GlobalDictationRuntime";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  handler: null as null | (() => void),
}));

vi.mock("@/lib/desktop-host/global-shortcut", () => ({
  register: mocks.register,
  unregister: mocks.unregister,
}));
vi.mock("@/lib/electron-host", () => ({
  getElectronHostBridge: () => ({ window: { show: vi.fn(), setFocus: vi.fn() } }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.register.mockImplementation(async (_shortcut, handler) => {
    mocks.handler = handler;
  });
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

describe("GlobalDictationRuntime", () => {
  it("注册 Alt+D 并在延迟后切换当前听写", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root.render(<GlobalDictationRuntime />);
        await Promise.resolve();
      });
      expect(mocks.register).toHaveBeenCalledWith("Alt+D", expect.any(Function));
      const toggled = vi.fn();
      window.addEventListener("lime:toggle-dictation", toggled);
      act(() => mocks.handler?.());
      act(() => vi.advanceTimersByTime(180));
      expect(toggled).toHaveBeenCalled();
      window.removeEventListener("lime:toggle-dictation", toggled);
    } finally {
      vi.useRealTimers();
    }
  });
});
