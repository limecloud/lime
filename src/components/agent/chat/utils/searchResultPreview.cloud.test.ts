import { describe, expect, it } from "vitest";
import { resolveSearchResultPreviewItemsFromText } from "./searchResultPreview";

describe("Cloud 联网工具来源", () => {
  it("读取原生搜索结果并保留标题、摘要和来源锚点", () => {
    const output = {
      id: "web_search_runtime",
      kind: "search",
      status: "completed",
      search: {
        items: [{
          title: "Rust release",
          url: "https://blog.rust-lang.org/releases/#stable",
          summary: "Published release",
          retrievedAt: "2026-11-12T00:00:00Z",
        }],
        truncated: false,
      },
      operationKey: `tool_${"a".repeat(64)}`,
      recoveryPath: `/web/operations/tool_${"a".repeat(64)}`,
    };
    expect(resolveSearchResultPreviewItemsFromText(JSON.stringify(output))).toEqual([
      expect.objectContaining({
        title: "Rust release",
        url: "https://blog.rust-lang.org/releases/#stable",
        hostname: "blog.rust-lang.org",
        snippet: "Published release",
      }),
    ]);
  });

  it("原操作尚未取得结果时不显示虚构来源", () => {
    expect(resolveSearchResultPreviewItemsFromText(JSON.stringify({
      status: "outcome_unknown",
      errorCode: "operation_not_found",
      httpStatus: 404,
      operationKey: `tool_${"a".repeat(64)}`,
      recoveryPath: `/web/operations/tool_${"a".repeat(64)}`,
    }))).toEqual([]);
  });
});
