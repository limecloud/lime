import { describe, expect, it } from "vitest";
import {
  getKnowledgeSourceDisplayName,
  getKnowledgeUnsupportedSourceMessage,
  isKnowledgeTextSourceCandidate,
  normalizeKnowledgeSourceTitle,
} from "./knowledgeSourceSupport";

describe("knowledgeSourceSupport", () => {
  it("应只把 Markdown 与文本类文件识别为可直接整理资料", () => {
    expect(
      isKnowledgeTextSourceCandidate({
        name: "brief.md",
        path: "/project/brief.md",
        isDir: false,
      }),
    ).toBe(true);
    expect(
      isKnowledgeTextSourceCandidate({
        name: "notes",
        path: "/project/notes",
        isDir: false,
        mimeType: "text/plain",
      }),
    ).toBe(true);
    expect(
      isKnowledgeTextSourceCandidate({
        name: "contract.pdf",
        path: "/project/contract.pdf",
        isDir: false,
        mimeType: "application/pdf",
      }),
    ).toBe(false);
  });

  it("应给普通用户返回可执行的非文本资料提示", () => {
    expect(
      getKnowledgeUnsupportedSourceMessage({
        name: "contract.pdf",
        path: "/project/contract.pdf",
        isDir: false,
      }),
    ).toContain("转成 Markdown");
    expect(
      getKnowledgeUnsupportedSourceMessage({
        name: "docs",
        path: "/project/docs",
        isDir: true,
      }),
    ).toContain("先添加到对话");
  });

  it("应从路径生成稳定展示名与标题", () => {
    expect(
      getKnowledgeSourceDisplayName({
        path: "/project/20260505-brand_brief.md",
      }),
    ).toBe("20260505-brand_brief.md");
    expect(normalizeKnowledgeSourceTitle("20260505-brand_brief.md")).toBe(
      "brand brief",
    );
  });
});
