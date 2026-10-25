import { act } from "react";
import { describe, expect, it } from "vitest";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";
import { renderTool } from "./ToolCallDisplay.testFixtures";
import { ToolCallDisplay } from "./ToolCallDisplay";

const call: AgentToolCallState = {
  id: "dynamic-1",
  name: "executeCdpCommand",
  arguments:
    '{"method":"Runtime.evaluate","params":{"expression":"document.title"}}',
  metadata: { canonical_type: "dynamicToolCall", namespace: "browser" },
  status: "running",
  startTime: new Date("2026-10-25T00:00:00Z"),
};

describe("canonical dynamic tool content", () => {
  it("展开状态跨运行和完成保留，输入和全部结构化结果不被摘要截断", () => {
    const { root, container } = renderTool(call);
    const toggle = () => container.querySelector<HTMLButtonElement>("button")!;
    expect(
      container.querySelector('[data-testid="tool-call-content"]'),
    ).toBeNull();
    act(() => toggle().click());
    expect(container.textContent).toContain("document.title");
    act(() =>
      root.render(
        <ToolCallDisplay
          toolCall={{
            ...call,
            status: "completed",
            result: {
              success: true,
              output: "百度新闻",
              structuredContent: {
                title: "百度新闻",
                tabs: [1, 2, 3, 4],
                extra: { retained: true },
              },
            },
          }}
        />,
      ),
    );
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain('"retained": true');
    expect(container.textContent).toContain("4");
    expect(container.querySelectorAll("pre")).toHaveLength(3);
    act(() => toggle().click());
    expect(container.querySelector("pre")).toBeNull();
  });

  it("失败保留错误及结果，切换工具时重置展开状态，结果文本不能注入 DOM", () => {
    const { root, container } = renderTool({
      ...call,
      status: "failed",
      result: {
        success: false,
        output: "",
        error: "<script>unsafe()</script>",
      },
    });
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.textContent).toContain("<script>unsafe()</script>");
    expect(container.querySelector("script")).toBeNull();
    act(() =>
      root.render(<ToolCallDisplay toolCall={{ ...call, id: "dynamic-2" }} />),
    );
    expect(container.querySelector('[aria-expanded="false"]')).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});
