import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { A2UIResponse } from "@/lib/workspace/a2ui";
import { useStickyA2UIForm } from "./useStickyA2UIForm";

type HookProps = Parameters<typeof useStickyA2UIForm>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createA2UIForm(id: string): A2UIResponse {
  return {
    id,
    version: "1.0",
    data: {},
    components: [],
  } as unknown as A2UIResponse;
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useStickyA2UIForm> | null = null;

  const defaultProps: HookProps = {
    form: null,
    clearImmediately: false,
    holdMs: 1200,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useStickyA2UIForm(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useStickyA2UIForm", () => {
  it("pending 表单短暂消失时应先保留，避免输入区闪烁", async () => {
    const form = createA2UIForm("a2ui-pending");
    const { render, getValue } = renderHook({
      form,
      holdMs: 1200,
    });

    await render();
    expect(getValue().visibleForm).toEqual(form);
    expect(getValue().isStale).toBe(false);

    await render({
      form: null,
    });
    expect(getValue().visibleForm).toEqual(form);
    expect(getValue().isStale).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1199);
    });
    expect(getValue().visibleForm).toEqual(form);
    expect(getValue().isStale).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(getValue().visibleForm).toBeNull();
    expect(getValue().isStale).toBe(false);
  });

  it("进入已提交提示后应立即清空旧表单，避免叠层残留", async () => {
    const form = createA2UIForm("a2ui-submitted");
    const { render, getValue } = renderHook({
      form,
      holdMs: 1200,
    });

    await render();
    expect(getValue().visibleForm).toEqual(form);

    await render({
      form: null,
      clearImmediately: true,
    });
    expect(getValue().visibleForm).toBeNull();
    expect(getValue().isStale).toBe(false);
  });
});
