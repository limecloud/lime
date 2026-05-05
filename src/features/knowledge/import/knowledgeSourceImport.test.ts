import { describe, expect, it, vi } from "vitest";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { readKnowledgeTextSourceFromPath } from "./knowledgeSourceImport";

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
});
