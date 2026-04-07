import { describe, expect, it } from "vitest";

import { getMcpInnerToolName } from "./mcp";

describe("mcp", () => {
  it("应在已知 server 名下提取 inner tool 名", () => {
    expect(getMcpInnerToolName("mcp__docs__search_docs", "docs")).toBe(
      "search_docs",
    );
  });

  it("应保留 inner tool 名中的双下划线片段", () => {
    expect(getMcpInnerToolName("mcp__docs__admin__search_docs", "docs")).toBe(
      "admin__search_docs",
    );
  });

  it("对非 MCP 工具名保持原样", () => {
    expect(getMcpInnerToolName("WebSearch", "docs")).toBe("WebSearch");
  });
});
