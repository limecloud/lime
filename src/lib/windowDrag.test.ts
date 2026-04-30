import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWindowDragInteractiveTarget,
  shouldStartWindowDragFromMouseEvent,
  startWindowDragFromMouseEvent,
} from "./windowDrag";

const { mockHasTauriInvokeCapability, mockStartDragging } = vi.hoisted(() => ({
  mockHasTauriInvokeCapability: vi.fn(() => true),
  mockStartDragging: vi.fn(),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: mockHasTauriInvokeCapability,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: mockStartDragging,
  }),
}));

function buildMouseEventLike(params: {
  button?: number;
  currentTarget?: EventTarget | null;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}) {
  const target = params.target ?? document.createElement("div");
  return {
    button: params.button ?? 0,
    currentTarget: params.currentTarget ?? target,
    defaultPrevented: params.defaultPrevented ?? false,
    target,
    preventDefault: vi.fn(),
  };
}

describe("windowDrag", () => {
  beforeEach(() => {
    mockHasTauriInvokeCapability.mockReturnValue(true);
    mockStartDragging.mockReset();
    mockStartDragging.mockResolvedValue(undefined);
  });

  it("桌面环境左键点击非交互区域时应启动窗口拖拽", async () => {
    const event = buildMouseEventLike({});

    await expect(
      startWindowDragFromMouseEvent(event, { source: "test" }),
    ).resolves.toBe(true);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockStartDragging).toHaveBeenCalledTimes(1);
  });

  it("非 Tauri 环境不应启动窗口拖拽", async () => {
    mockHasTauriInvokeCapability.mockReturnValue(false);
    const event = buildMouseEventLike({});

    await expect(startWindowDragFromMouseEvent(event)).resolves.toBe(false);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockStartDragging).not.toHaveBeenCalled();
  });

  it("非左键点击不应启动窗口拖拽", () => {
    const event = buildMouseEventLike({ button: 2 });

    expect(shouldStartWindowDragFromMouseEvent(event)).toBe(false);
    expect(mockStartDragging).not.toHaveBeenCalled();
  });

  it("交互控件及其子元素不应启动窗口拖拽", () => {
    const button = document.createElement("button");
    const label = document.createElement("span");
    button.appendChild(label);

    expect(isWindowDragInteractiveTarget(label)).toBe(true);
    expect(
      shouldStartWindowDragFromMouseEvent(
        buildMouseEventLike({ currentTarget: document.createElement("div"), target: label }),
      ),
    ).toBe(false);
  });

  it("要求只允许自身命中时，子元素不应启动窗口拖拽", () => {
    const container = document.createElement("div");
    const child = document.createElement("div");
    container.appendChild(child);

    expect(
      shouldStartWindowDragFromMouseEvent(
        buildMouseEventLike({ currentTarget: container, target: child }),
        { allowDescendantTargets: false },
      ),
    ).toBe(false);
  });

  it("声明 no-drag 的区域不应启动窗口拖拽", () => {
    const noDragRegion = document.createElement("div");
    noDragRegion.dataset.limeNoWindowDrag = "true";

    expect(isWindowDragInteractiveTarget(noDragRegion)).toBe(true);
    expect(
      shouldStartWindowDragFromMouseEvent(
        buildMouseEventLike({ target: noDragRegion }),
      ),
    ).toBe(false);
  });
});
