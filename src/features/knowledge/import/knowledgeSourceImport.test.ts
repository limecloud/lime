import { describe, expect, it, vi } from "vitest";
import { readFilePreview } from "@/lib/api/fileBrowser";
import {
  buildKnowledgeImportDraft,
  readKnowledgeTextSourceFromPath,
} from "./knowledgeSourceImport";

vi.mock("@/lib/api/fileBrowser", () => ({
  readFilePreview: vi.fn(),
}));

describe("knowledgeSourceImport", () => {
  it("浏览器文件管理器 mock 文本资料读取失败时应返回可整理内容", async () => {
    vi.mocked(readFilePreview).mockRejectedValueOnce(
      new Error("No such file or directory"),
    );

    const result = await readKnowledgeTextSourceFromPath({
      name: "brief.md",
      path: "/Users/mock/brief.md",
      isDir: false,
      mimeType: "text/markdown",
    });

    expect(result.sourceName).toBe("brief.md");
    expect(result.sourceText).toContain("从文件管理器加入的文本资料");
    expect(result.sourceText).not.toContain("/Users/mock/brief.md");
  });

  it("应识别运营类资料类型", () => {
    expect(
      buildKnowledgeImportDraft({
        sourceName: "内容日历.md",
        sourceText: "公众号和短视频选题节奏，每周复盘一次。",
      }).packType,
    ).toBe("content-operations");
    expect(
      buildKnowledgeImportDraft({
        sourceName: "私域SOP.md",
        sourceText: "会员群触达、私聊转化和社群运营话术。",
      }).packType,
    ).toBe("private-domain-operations");
    expect(
      buildKnowledgeImportDraft({
        sourceName: "直播排期.md",
        sourceText: "主播开场、场控提醒和带货复盘指标。",
      }).packType,
    ).toBe("live-commerce-operations");
    expect(
      buildKnowledgeImportDraft({
        sourceName: "活动方案.md",
        sourceText: "沙龙活动节奏、物料清单和会务风险预案。",
      }).packType,
    ).toBe("campaign-operations");
  });
});
