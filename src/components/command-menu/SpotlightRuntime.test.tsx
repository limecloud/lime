import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpotlightRuntime } from "./SpotlightRuntime";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  handler: null as null | (() => void),
}));

vi.mock("@/lib/desktop-host/global-shortcut", () => ({
  register: mocks.register,
  unregister: mocks.unregister,
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

describe("SpotlightRuntime", () => {
  it("注册 Alt+K，并通过全局快捷键事件打开命令菜单", async () => {
    const opened = vi.fn();
    window.addEventListener("lime:open-command-menu", opened);
    await act(async () => {
      root.render(<SpotlightRuntime />);
      await Promise.resolve();
    });
    expect(mocks.register).toHaveBeenCalledWith("Alt+K", expect.any(Function));
    act(() => mocks.handler?.());
    expect(opened).toHaveBeenCalled();
    window.removeEventListener("lime:open-command-menu", opened);
  });
});
