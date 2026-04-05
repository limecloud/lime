import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useA2UISubmissionNotice } from "./useA2UISubmissionNotice";

type HookProps = Parameters<typeof useA2UISubmissionNotice>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(_initialProps: HookProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useA2UISubmissionNotice> | null = null;

  function Probe(currentProps: HookProps) {
    latestValue = useA2UISubmissionNotice(currentProps);
    return null;
  }

  const render = async (nextProps: HookProps) => {
    await act(async () => {
      root.render(<Probe {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    return window.setTimeout(() => callback(0), 0);
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => {
    window.clearTimeout(handle);
  });
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useA2UISubmissionNotice", () => {
  it("确认提示应在 3 秒后自动淡出并卸载", async () => {
    const notice = {
      title: "需求已确认",
      summary: "已收到你的补充信息。",
    };
    const { render, getValue } = renderHook({
      notice,
      enabled: true,
      displayMs: 3000,
      fadeOutMs: 180,
    });

    await render({
      notice,
      enabled: true,
      displayMs: 3000,
      fadeOutMs: 180,
    });

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(getValue().visibleNotice).toEqual(notice);
    expect(getValue().isVisible).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(getValue().visibleNotice).toEqual(notice);
    expect(getValue().isVisible).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(180);
      await Promise.resolve();
    });

    expect(getValue().visibleNotice).toBeNull();
    expect(getValue().isVisible).toBe(false);
  });
});
