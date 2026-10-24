import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageListScrollController } from "./useMessageListScrollController";

let root: Root;
let host: HTMLDivElement;
let controller: ReturnType<typeof useMessageListScrollController>;

function Timeline({ sessionId }: { sessionId: string }) {
  controller = useMessageListScrollController(sessionId);
  return <div key={sessionId} ref={controller.containerRef} />;
}

function open(sessionId: string) {
  act(() => root.render(<Timeline sessionId={sessionId} />));
  const element = host.firstElementChild as HTMLDivElement;
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 5000 },
    clientHeight: { configurable: true, value: 700 },
  });
  return element;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("聊天滚动容器生命周期", () => {
  it("切换聊天后新容器的上滚停止尾随，旧容器事件不再影响当前聊天", () => {
    const previous = open("first");
    act(() =>
      previous.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 })),
    );
    expect(controller.isFollowingTail()).toBe(false);
    expect(controller.isUserScrolling).toBe(true);

    const current = open("restored-history");
    expect(current).not.toBe(previous);
    expect(controller.isFollowingTail()).toBe(true);
    expect(controller.isUserScrolling).toBe(false);
    act(() =>
      previous.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 })),
    );
    expect(controller.isFollowingTail()).toBe(true);

    act(() => current.dispatchEvent(new WheelEvent("wheel", { deltaY: -120 })));
    expect(controller.isFollowingTail()).toBe(false);
    expect(controller.shouldAutoScroll).toBe(false);
    expect(controller.isUserScrolling).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    expect(controller.isUserScrolling).toBe(false);
    expect(controller.isFollowingTail()).toBe(false);
  });

  it("替换容器后键盘和滚动监听同步迁移，并清除旧程序滚动标记", () => {
    const previous = open("first");
    act(() => controller.setScrollTop(400));
    const current = open("second");
    act(() => {
      current.scrollTop = 400;
      current.dispatchEvent(new Event("scroll"));
    });
    expect(controller.isFollowingTail()).toBe(false);

    act(() => {
      current.scrollTop = 4300;
      current.dispatchEvent(new Event("scroll"));
    });
    expect(controller.isFollowingTail()).toBe(true);
    act(() =>
      previous.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" })),
    );
    expect(controller.isFollowingTail()).toBe(true);
    act(() =>
      current.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" })),
    );
    expect(controller.isFollowingTail()).toBe(false);
  });
});
