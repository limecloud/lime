import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolDefinition } from "@/lib/api/mcp";
import { McpToolsBrowser } from "./McpToolsBrowser";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function createTool(
  overrides: Partial<McpToolDefinition> = {},
): McpToolDefinition {
  return {
    name: "mcp__demo__search_docs",
    description: "搜索文档",
    input_schema: { type: "object" },
    server_name: "demo",
    ...overrides,
  };
}

async function renderBrowser(
  props: Partial<React.ComponentProps<typeof McpToolsBrowser>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof McpToolsBrowser> = {
    tools: [],
    loading: false,
    onRefresh: vi.fn(async () => undefined),
  };

  await act(async () => {
    root.render(<McpToolsBrowser {...defaultProps} {...props} />);
    await Promise.resolve();
    await Promise.resolve();
  });

  mountedRoots.push({ container, root });
  return container;
}

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
});

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("McpToolsBrowser", () => {
  it("已配置但未启动服务器时，应给出进入运行状态的引导，而不是笼统提示无工具", async () => {
    const onOpenRuntimeTab = vi.fn();
    const container = await renderBrowser({
      serverCount: 2,
      runningServerCount: 0,
      onOpenRuntimeTab,
    });

    expect(container.textContent).toContain(
      "已配置服务器，但当前没有运行中的 MCP 服务器",
    );
    expect(container.textContent).toContain("去启动服务器");

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("去启动服务器"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenRuntimeTab).toHaveBeenCalledTimes(1);
  });

  it("未配置服务器时，应引导去配置管理", async () => {
    const onOpenConfigTab = vi.fn();
    const container = await renderBrowser({
      serverCount: 0,
      runningServerCount: 0,
      onOpenConfigTab,
    });

    expect(container.textContent).toContain("还没有配置 MCP 服务器");
    expect(container.textContent).toContain("去配置管理");

    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("去配置管理"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenConfigTab).toHaveBeenCalledTimes(1);
  });

  it("重复工具定义只应渲染一份，并默认展开服务器分组", async () => {
    const container = await renderBrowser({
      serverCount: 1,
      runningServerCount: 1,
      tools: [
        createTool(),
        createTool(),
        createTool({
          name: "mcp__demo__read_docs",
          description: "读取文档",
        }),
      ],
    });

    expect(container.textContent).toContain("(2)");
    expect(container.textContent).toContain("(2 个工具)");
    expect(
      container.querySelectorAll('[title="mcp__demo__search_docs"]').length,
    ).toBe(1);
    expect(
      container.querySelectorAll('[title="mcp__demo__read_docs"]').length,
    ).toBe(1);
  });
});
