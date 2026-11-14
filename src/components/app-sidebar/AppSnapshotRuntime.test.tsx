import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSnapshotRuntime } from "./AppSnapshotRuntime";

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  start: vi.fn(),
  sound: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  listen: vi.fn(),
  invoke: vi.fn(),
  handler: null as null | ((event: { payload: unknown }) => void),
}));

vi.mock("@/lib/appSnapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/appSnapshot")>();
  return {
    ...actual,
    triggerAppSnapshot: mocks.trigger,
    startBareModifierMonitor: mocks.start,
    playSnapshotSound: mocks.sound,
  };
});
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mocks.invoke,
  safeListen: mocks.listen,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
  mocks.trigger.mockResolvedValue(true);
  mocks.start.mockResolvedValue({ started: true });
  mocks.listen.mockImplementation((_event, handler) => {
    mocks.handler = handler;
    return Promise.resolve(() => undefined);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AppSnapshotRuntime />));
  await act(async () => Promise.resolve());
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  container.remove();
});

describe("AppSnapshotRuntime", () => {
  it("启动裸修饰键监听，双 ⌘ 触发快照", async () => {
    expect(mocks.start).toHaveBeenCalled();
    mocks.handler?.({
      payload: { modifier: "command", phase: "down", timestamp: 1 },
    });
    mocks.handler?.({
      payload: { modifier: "command", phase: "down", timestamp: 1.2 },
    });
    await act(async () => Promise.resolve());
    expect(mocks.trigger).toHaveBeenCalledOnce();
    expect(mocks.sound).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
  });

  it("窗口手动触发事件同样执行快照", async () => {
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lime-app-snapshot-trigger"));
    });
    await act(async () => Promise.resolve());
    expect(mocks.trigger).toHaveBeenCalledOnce();
  });

  it("无法投递时提示失败", async () => {
    mocks.trigger.mockResolvedValueOnce(false);
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lime-app-snapshot-trigger"));
    });
    await act(async () => Promise.resolve());
    expect(mocks.toastError).toHaveBeenCalledOnce();
  });
});
