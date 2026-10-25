import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConversationSidebarKey,
  useConversationSidebar,
} from "./useConversationSidebar";

type HookProps = Parameters<typeof useConversationSidebar>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<
    typeof useConversationSidebar
  > | null = null;

  const defaultProps: HookProps = {
    contentId: null,
    externalProjectId: null,
    newChatAt: null,
    normalizedEntryTheme: "general",
    sessionId: null,
    shouldCollapseConversationSidebar: true,
    setShowSidebar: vi.fn(),
  };

  function Probe(currentProps: HookProps) {
    latestValue = useConversationSidebar(currentProps);
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
});

describe("buildConversationSidebarKey", () => {
  it("非 classic Claw 入口不生成 reset key", () => {
    expect(
      buildConversationSidebarKey({
        contentId: "content-1",
        externalProjectId: "project-1",
        newChatAt: 12,
        normalizedEntryTheme: "general",
        sessionId: "session-1",
        shouldCollapseConversationSidebar: false,
      }),
    ).toBeNull();
  });

  it("classic Claw 入口应稳定归一入口字段", () => {
    expect(
      buildConversationSidebarKey({
        contentId: undefined,
        externalProjectId: "project-1",
        newChatAt: 12,
        normalizedEntryTheme: "general",
        sessionId: "session-1",
        shouldCollapseConversationSidebar: true,
      }),
    ).toBe(
      JSON.stringify({
        projectId: "project-1",
        contentId: null,
        sessionId: "session-1",
        theme: "general",
        newChatAt: 12,
      }),
    );
  });
});

describe("useConversationSidebar", () => {
  it("classic Claw 入口挂载时应收起主题侧栏", async () => {
    const setShowSidebar = vi.fn();
    const { render, getValue } = renderHook({ setShowSidebar });

    await render();

    expect(setShowSidebar).toHaveBeenCalledWith(false);
    expect(getValue().autoCollapsedTopicSidebarRef.current).toBe(false);
  });

  it("入口 reset key 变化后应清掉自动折叠标记并重新收起", async () => {
    const setShowSidebar = vi.fn();
    const { render, getValue } = renderHook({ setShowSidebar });

    await render({ sessionId: "session-a" });
    getValue().autoCollapsedTopicSidebarRef.current = true;

    await render({ sessionId: "session-b" });

    expect(getValue().autoCollapsedTopicSidebarRef.current).toBe(false);
    expect(setShowSidebar).toHaveBeenCalledTimes(2);
  });

  it("非 classic Claw 入口不应主动收起侧栏", async () => {
    const setShowSidebar = vi.fn();
    const { render } = renderHook({
      setShowSidebar,
      shouldCollapseConversationSidebar: false,
    });

    await render();

    expect(setShowSidebar).not.toHaveBeenCalled();
  });
});
