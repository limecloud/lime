import { describe, expect, it } from "vitest";
import {
  normalizeToolSearchResultSummary,
  resolveToolSearchItemSourceLabel,
  resolveToolSearchItemStatusLabel,
  resolveUserFacingToolSearchItemLabel,
} from "./toolSearchResultSummary";

describe("toolSearchResultSummary", () => {
  it("应解析 bridge 版 ToolSearch 结果", () => {
    const summary = normalizeToolSearchResultSummary(
      JSON.stringify({
        query: "select:Read,Write",
        caller: "assistant",
        count: 2,
        notes: [],
        tools: [
          {
            name: "Read",
            source: "native_registry",
            description: "read a file",
            deferred_loading: false,
            always_visible: true,
          },
          {
            name: "mcp__playwright__browser_click",
            source: "extension",
            extension_name: "mcp__playwright",
            status: "deferred",
            deferred_loading: true,
          },
        ],
      }),
    );

    expect(summary).toEqual({
      query: "select:Read,Write",
      caller: "assistant",
      count: 2,
      notes: [],
      tools: [
        {
          name: "Read",
          source: "native_registry",
          description: "read a file",
          deferredLoading: false,
          alwaysVisible: true,
        },
        {
          name: "mcp__playwright__browser_click",
          source: "extension",
          extensionName: "mcp__playwright",
          status: "deferred",
          deferredLoading: true,
        },
      ],
    });
  });

  it("应兼容旧 ToolSearch matches 结果", () => {
    const summary = normalizeToolSearchResultSummary(
      JSON.stringify({
        query: "browser click",
        matches: ["mcp__playwright__browser_click"],
        notes: ["未命中任何 deferred 工具"],
        total_deferred_tools: 12,
      }),
    );

    expect(summary).toEqual({
      query: "browser click",
      count: 1,
      notes: ["未命中任何 deferred 工具"],
      tools: [{ name: "mcp__playwright__browser_click" }],
      totalDeferredTools: 12,
    });
  });

  it("应生成来源与状态标签", () => {
    expect(
      resolveToolSearchItemSourceLabel({
        name: "Read",
        source: "native_registry",
      }),
    ).toBe("原生工具");
    expect(
      resolveToolSearchItemSourceLabel({
        name: "mcp__playwright__browser_click",
        source: "extension",
        extensionName: "mcp__playwright",
      }),
    ).toBe("扩展工具 · mcp__playwright");
    expect(
      resolveToolSearchItemStatusLabel({
        name: "mcp__playwright__browser_click",
        status: "deferred",
        deferredLoading: true,
      }),
    ).toBe("待加载");
  });

  it("应把常见工具名转换成更自然的搜索展示文案", () => {
    expect(resolveUserFacingToolSearchItemLabel("Read")).toBe("查看文件");
    expect(resolveUserFacingToolSearchItemLabel("Write")).toBe("保存文件");
    expect(resolveUserFacingToolSearchItemLabel("glob")).toBe("查找文件");
    expect(resolveUserFacingToolSearchItemLabel("TaskOutput")).toBe(
      "查看任务结果",
    );
    expect(resolveUserFacingToolSearchItemLabel("mcp__playwright__browser_click")).toBe(
      "页面点击",
    );
  });
});
