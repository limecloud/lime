import { describe, expect, it } from "vitest";
import { normalizeSearchContextResult } from "./contextSearch";

describe("normalizeSearchContextResult", () => {
  it("应优先解析 JSON 结果", () => {
    const result = normalizeSearchContextResult(
      JSON.stringify({
        title: "智能体市场观察",
        summary: "市场讨论聚焦推理成本、工作流平台和企业落地节奏。",
        citations: [{ title: "官方博客", url: "https://example.com/blog" }],
      }),
      "智能体市场 2026",
      "web",
    );

    expect(result.title).toBe("智能体市场观察");
    expect(result.summary).toContain("推理成本");
    expect(result.citations).toEqual([
      { title: "官方博客", url: "https://example.com/blog" },
    ]);
  });

  it("JSON 不可解析时应回退到文本与链接提取", () => {
    const result = normalizeSearchContextResult(
      [
        "2026 年社交媒体讨论聚焦 Agent 产品的真实 ROI。",
        "参考链接：",
        "[小红书热议](https://example.com/xhs)",
        "https://example.com/weibo",
      ].join("\n"),
      "Agent 社媒讨论",
      "social",
    );

    expect(result.title).toContain("Agent 社媒讨论");
    expect(result.summary).toContain("真实 ROI");
    expect(result.citations).toEqual([
      { title: "小红书热议", url: "https://example.com/xhs" },
      { title: "example.com", url: "https://example.com/weibo" },
    ]);
  });
});
