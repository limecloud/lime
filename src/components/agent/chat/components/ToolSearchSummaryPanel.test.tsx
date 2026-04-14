import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolSearchSummaryPanel } from "./ToolSearchSummaryPanel";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: RenderResult[] = [];

function renderPanel(
  summary: ComponentProps<typeof ToolSearchSummaryPanel>["summary"],
): RenderResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ToolSearchSummaryPanel summary={summary} />);
  });

  const rendered = { container, root };
  mountedRoots.push(rendered);
  return rendered;
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
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("ToolSearchSummaryPanel", () => {
  it("应优先展示用户能看懂的工具标签，并隐藏内部状态标签", () => {
    const { container } = renderPanel({
      query: "browser click",
      count: 3,
      notes: ["未命中任何 deferred 工具"],
      tools: [
        {
          name: "Read",
          source: "native_registry",
          alwaysVisible: true,
        },
        {
          name: "mcp__playwright__browser_click",
          source: "extension",
          extensionName: "mcp__playwright",
          status: "deferred",
          deferredLoading: true,
        },
        {
          name: "WebSearch",
          source: "native_registry",
          status: "loaded",
        },
      ],
    });

    expect(container.textContent).toContain("找到工具：3 个");
    expect(container.textContent).toContain("查询：browser click");
    expect(container.textContent).toContain("查看文件");
    expect(container.textContent).toContain("页面点击");
    expect(container.textContent).toContain("搜索网页");
    expect(container.textContent).toContain("没有找到更多匹配工具");
    expect(container.textContent).not.toContain("Read");
    expect(container.textContent).not.toContain(
      "mcp__playwright__browser_click",
    );
    expect(container.textContent).not.toContain("WebSearch");
    expect(container.textContent).not.toContain("来源：");
    expect(container.textContent).not.toContain("状态：");
    expect(container.textContent).not.toContain("原生工具");
    expect(container.textContent).not.toContain("扩展工具");
    expect(container.textContent).not.toContain("已加载");
    expect(container.textContent).not.toContain("默认可见");
    expect(container.textContent).not.toContain("待加载");
  });

  it("内部筛选语法查询不应直接展示给用户", () => {
    const { container } = renderPanel({
      query: "select:Read,Write",
      count: 2,
      notes: [],
      tools: [{ name: "Read" }, { name: "Write" }],
    });

    expect(container.textContent).toContain("找到工具：2 个");
    expect(container.textContent).not.toContain("查询：");
    expect(container.textContent).not.toContain("select:Read,Write");
  });

  it("应展示仍在连接中的 MCP 服务", () => {
    const { container } = renderPanel({
      query: "slack send",
      count: 0,
      notes: [],
      tools: [],
      pendingMcpServers: ["slack", "playwright"],
    });

    expect(container.textContent).toContain(
      "以下 MCP 服务仍在连接中：slack、playwright",
    );
  });
});
