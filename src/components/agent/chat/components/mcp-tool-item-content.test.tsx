import { act } from "react";
import { describe, expect, it } from "vitest";
import type { AgentToolCallState } from "@/lib/api/agentProtocol";
import { renderTool } from "./ToolCallDisplay.testFixtures";
import { ToolCallDisplay } from "./ToolCallDisplay";
import { InlineToolProcessStep } from "./InlineToolProcessStep";
import { changeLimeLocale } from "@/i18n/createI18n";

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

describe("canonical MCP tool content", () => {
  const mcpCall: AgentToolCallState = {
    ...call,
    id: "mcp-1",
    name: "diagnostic_probe",
    arguments: '{"question":"structured content display"}',
    metadata: { canonical_type: "mcpToolCall", server: "docs" },
    status: "completed",
    result: {
      success: true,
      output: JSON.stringify({
        request_metadata: { trace_id: "hidden-transport-id" },
        diagnostics: { raw_transport_payload: "hidden-envelope" },
      }),
      structuredContent: { answer: "完整答案", ids: ["doc-1"] },
    },
  };

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 保留服务与工具身份，默认折叠，展开完整答案并隐藏协议包络",
    async (locale) => {
      await changeLimeLocale(locale);
      const { container } = renderTool(mcpCall);
      const row = container.querySelector('[data-testid="tool-call-row"]');
      expect(row?.getAttribute("data-tool-call-id")).toBe("mcp-1");
      expect(row?.getAttribute("data-tool-name")).toBe("diagnostic_probe");
      expect(row?.getAttribute("data-mcp-server")).toBe("docs");
      expect(row?.textContent).toContain("docs / diagnostic probe");
      expect(row?.querySelector("pre")).toBeNull();
      act(() => row?.querySelector<HTMLButtonElement>("button")?.click());
      expect(row?.textContent).toContain("完整答案");
      expect(row?.textContent).toContain("doc-1");
      expect(row?.textContent).not.toContain("hidden-envelope");
      expect(row?.textContent).not.toContain("request_metadata");
      expect(row?.querySelectorAll("pre")).toHaveLength(2);
    },
  );

  it("行内时间线复用同一 MCP 结果，失败错误始终可查看", () => {
    const { root, container } = renderTool(mcpCall);
    act(() => root.render(<InlineToolProcessStep toolCall={mcpCall} />));
    expect(container.textContent).toContain("docs / diagnostic probe");
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.textContent).toContain("doc-1");
    act(() =>
      root.render(
        <InlineToolProcessStep
          toolCall={{
            ...mcpCall,
            status: "failed",
            result: {
              success: false,
              output: "",
              error: "MCP request rejected",
            },
          }}
        />,
      ),
    );
    expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(container.textContent).toContain("MCP request rejected");
  });
});
