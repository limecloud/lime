import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  installStreamingRendererTestHarness,
  renderStreamingRendererHarness as renderHarness,
} from "./StreamingRenderer.testHarness";

installStreamingRendererTestHarness();

describe("StreamingRenderer WebSearch canonical rendering", () => {
  it("历史工具流应复用普通命令与网页检索展示", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "tool_use",
          toolCall: {
            id: "local-history-import-command",
            name: "Bash",
            arguments: JSON.stringify({
              command: "npm test",
              cwd: "/workspace/canonical-local-history",
            }),
            status: "completed",
            result: {
              success: true,
              output: "Exit code: 0\nOutput:\nok",
              metadata: {
                environmentId: "environment-main",
                exit_code: 0,
              },
            },
            startTime: new Date("2026-06-02T09:00:00.000Z"),
            endTime: new Date("2026-06-02T09:00:01.000Z"),
          },
        },
        {
          type: "tool_use",
          toolCall: {
            id: "local-history-import-search",
            name: "web_search",
            arguments: JSON.stringify({
              action: "search_query",
              query: "Lime history import",
            }),
            status: "completed",
            result: {
              success: true,
              output: "search result summary",
              metadata: {
                environmentId: "environment-main",
              },
            },
            startTime: new Date("2026-06-02T09:00:02.000Z"),
            endTime: new Date("2026-06-02T09:00:03.000Z"),
          },
        },
      ],
    });

    const processGroup = container.querySelector(
      '[data-testid="streaming-process-group"]',
    );
    const processGroupButton = processGroup?.querySelector("button");
    const processGroupButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="streaming-process-group"] > button',
    );
    const searchGroupButton = processGroupButtons.item(
      0,
    ) as HTMLButtonElement | null;

    expect(processGroupButtons).toHaveLength(1);
    expect(processGroupButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("已运行 npm test");
    expect(searchGroupButton?.textContent).toContain(
      "已搜索网页：Lime history import",
    );
    expect(container.textContent).not.toContain("历史的命令记录");
    expect(searchGroupButton?.textContent).toContain("Lime history import");

    act(() => {
      searchGroupButton?.click();
    });

    expect(searchGroupButton?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Lime history import");
  });

  it("历史网页检索批次应复用搜索与读取分段展示", () => {
    const canonicalMetadata = {
      environmentId: "environment-main",
    };
    const onOpenUrlPreview = vi.fn();
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "tool_use",
          toolCall: {
            id: "local-history-canonical-web-search-only",
            name: "web_search",
            arguments: JSON.stringify({
              action: "search_query",
              query: "Lime renderer roadmap",
            }),
            status: "completed",
            result: {
              success: true,
              output: JSON.stringify({
                results: [
                  {
                    title: "Lime renderer roadmap",
                    url: "https://example.com/lime-renderer-roadmap",
                    snippet: "Renderer roadmap summary",
                  },
                ],
              }),
              metadata: canonicalMetadata,
            },
            startTime: new Date("2026-06-17T10:00:00.000Z"),
            endTime: new Date("2026-06-17T10:00:01.000Z"),
          },
        },
        {
          type: "tool_use",
          toolCall: {
            id: "local-history-canonical-web-fetch-only",
            name: "WebFetch",
            arguments: JSON.stringify({
              url: "https://example.com/lime-renderer-roadmap",
            }),
            status: "completed",
            result: {
              success: true,
              output: JSON.stringify({
                title: "Renderer roadmap snapshot",
                markdown: "# Renderer roadmap\n\nCanonical page content.",
              }),
              metadata: canonicalMetadata,
            },
            startTime: new Date("2026-06-17T10:00:02.000Z"),
            endTime: new Date("2026-06-17T10:00:03.000Z"),
          },
        },
      ],
      isStreaming: false,
      onOpenUrlPreview,
    });

    const processGroupButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="streaming-process-group"] button',
    );
    const processGroup = container.querySelector<HTMLElement>(
      '[data-testid="streaming-process-group"]',
    );
    expect(processGroupButton?.getAttribute("aria-expanded")).toBe("false");
    expect(processGroup?.getAttribute("data-process-kind")).toBe("web_search");
    expect(processGroup?.getAttribute("data-visual-tone")).toBe("activity");
    expect(
      processGroup?.querySelector(
        '[data-testid="streaming-process-status-bullet"]',
      ),
    ).not.toBeNull();
    expect(processGroupButton?.textContent).toContain(
      "已搜索网页 1 次，读取网页 1 次",
    );
    expect(container.textContent).not.toContain("搜索来源");
    expect(container.textContent).not.toContain("读取页面");
    expect(container.textContent).not.toContain("Lime renderer roadmap");
    expect(container.textContent).not.toContain(
      "https://example.com/lime-renderer-roadmap",
    );

    act(() => {
      processGroupButton?.click();
    });

    expect(container.textContent).toContain("搜索来源");
    expect(container.textContent).toContain("读取页面");
    expect(container.textContent).toContain("Lime renderer roadmap");
    expect(container.textContent).toContain(
      "example.com/lime-renderer-roadmap",
    );
    expect(container.textContent).not.toContain(
      "https://example.com/lime-renderer-roadmap",
    );
    expect(container.textContent).not.toContain("历史的命令记录");
    expect(container.textContent).not.toContain("environmentId");
    expect(container.textContent).not.toContain("canonical_synthetic");
    expect(container.textContent).not.toContain("local_history");

    act(() => {
      const result = document.body.querySelector(
        '[aria-label="打开搜索结果：Lime renderer roadmap"]',
      ) as HTMLButtonElement | null;
      result?.click();
    });

    expect(onOpenUrlPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Lime renderer roadmap",
        url: "https://example.com/lime-renderer-roadmap",
      }),
    );
  });

  it("canonical web_search action object 应显示 query 且不泄露 JSON", () => {
    const { container } = renderHarness({
      content: "",
      contentParts: [
        {
          type: "tool_use",
          toolCall: {
            id: "canonical-web-search-action-object",
            name: "web_search",
            arguments: JSON.stringify({
              action: {
                type: "search_query",
                query: "codex desktop rendering parity",
              },
            }),
            status: "running",
            metadata: {
              environmentId: "environment-main",
            },
            startTime: new Date("2026-06-17T10:00:00.000Z"),
          },
        },
      ],
      isStreaming: true,
    });

    const processGroupButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="streaming-process-group"] button',
    );
    const processGroup = container.querySelector<HTMLElement>(
      '[data-testid="streaming-process-group"]',
    );

    expect(processGroupButton?.getAttribute("aria-expanded")).toBe("true");
    expect(processGroup?.getAttribute("data-process-kind")).toBe("web_search");
    expect(processGroup?.getAttribute("data-process-running")).toBe("yes");
    expect(processGroupButton?.textContent).toContain(
      "正在搜索网页 codex desktop rendering parity",
    );
    expect(container.textContent).toContain("codex desktop rendering parity");
    expect(container.textContent).not.toContain('"type"');
    expect(container.textContent).not.toContain('"search_query"');
  });
});
