import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleMinimumDelayIdleTask } from "./scheduleMinimumDelayIdleTask";

describe("scheduleMinimumDelayIdleTask", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("应先等待最小延迟，再进入 idle 阶段执行任务", () => {
    const task = vi.fn();
    const requestIdleCallback = vi.fn(
      (callback: (deadline: IdleDeadline) => void) => {
        callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline);
        return 1;
      },
    );

    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());

    scheduleMinimumDelayIdleTask(task, {
      minimumDelayMs: 6_000,
      idleTimeoutMs: 1_500,
    });

    vi.advanceTimersByTime(5_999);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("在最小延迟前取消时不应执行任务", () => {
    const task = vi.fn();
    const cancel = scheduleMinimumDelayIdleTask(task, {
      minimumDelayMs: 1_500,
    });

    cancel();
    vi.advanceTimersByTime(1_500);

    expect(task).not.toHaveBeenCalled();
  });
});
