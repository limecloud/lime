import { describe, expect, it } from "vitest";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import {
  resolveArtifactWorkbenchJsonFilename,
  resolveArtifactWorkbenchMarkdownFilename,
  serializeArtifactDocumentToMarkdown,
  updateArtifactDocumentStatus,
} from "./artifactWorkbenchActions";

function createArtifact(): Artifact {
  return {
    id: "artifact-1",
    type: "document",
    title: "q1-review.artifact.json",
    content: "",
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/q1-review.artifact.json",
      filename: "q1-review.artifact.json",
      language: "json",
    },
    position: { start: 0, end: 0 },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDocument(): ArtifactDocumentV1 {
  return {
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:q1-review",
    kind: "report",
    title: "董事会季度复盘",
    status: "ready",
    language: "zh-CN",
    summary: "本季度增长稳定，但交付效率仍需提升。",
    blocks: [
      {
        id: "section-1",
        type: "section_header",
        title: "执行摘要",
        description: "先看结论，再看展开分析。",
      },
      {
        id: "hero-1",
        type: "hero_summary",
        eyebrow: "季度经营",
        title: "核心结论",
        summary: "收入增长与成本控制表现良好。",
        highlights: ["收入增长 18%", "毛利率提升 4 个点"],
      },
      {
        id: "body-1",
        type: "rich_text",
        markdown: "这里是正文分析。",
      },
      {
        id: "callout-1",
        type: "callout",
        title: "风险提示",
        content: "第二季度需重点压缩项目交付周期。",
      },
      {
        id: "check-1",
        type: "checklist",
        title: "后续动作",
        items: [
          { label: "重排项目节奏", checked: true },
          { label: "补齐交付监控", checked: false },
        ],
      },
      {
        id: "code-1",
        type: "code_block",
        language: "json",
        code: '{\n  "next_step": "optimize-delivery"\n}',
      },
    ],
    sources: [
      {
        id: "source-1",
        title: "季度经营看板",
        url: "https://lime.example.com/q1",
        note: "内部经营分析来源",
      },
    ],
    metadata: {
      currentVersionId: "artifact-document:q1-review:v2",
      currentVersionNo: 2,
      versionHistory: [
        {
          id: "artifact-document:q1-review:v1",
          artifactId: "artifact-document:q1-review",
          versionNo: 1,
          title: "董事会季度复盘",
          status: "ready",
        },
        {
          id: "artifact-document:q1-review:v2",
          artifactId: "artifact-document:q1-review",
          versionNo: 2,
          title: "董事会季度复盘",
          status: "ready",
        },
      ],
    },
  };
}

describe("artifactWorkbenchActions", () => {
  it("应为结构化文档导出稳定的 JSON 与 Markdown 文件名", () => {
    const artifact = createArtifact();
    const document = createDocument();

    expect(resolveArtifactWorkbenchJsonFilename(artifact, document)).toBe(
      "q1-review.artifact.json",
    );
    expect(resolveArtifactWorkbenchMarkdownFilename(artifact, document)).toBe(
      "q1-review.md",
    );
  });

  it("应把结构化文档降级导出为可阅读 Markdown", () => {
    const markdown = serializeArtifactDocumentToMarkdown(createDocument());

    expect(markdown).toContain("# 董事会季度复盘");
    expect(markdown).toContain("## 执行摘要");
    expect(markdown).toContain("- 收入增长 18%");
    expect(markdown).toContain("> **风险提示**");
    expect(markdown).toContain("- [x] 重排项目节奏");
    expect(markdown).toContain("```json");
    expect(markdown).toContain("## 来源");
    expect(markdown).toContain("[季度经营看板](https://lime.example.com/q1)");
  });

  it("更新归档状态时应同步当前版本摘要状态", () => {
    const nextDocument = updateArtifactDocumentStatus(
      createDocument(),
      "archived",
    );

    expect(nextDocument.status).toBe("archived");
    expect(nextDocument.metadata.versionHistory?.[1]?.status).toBe("archived");
    expect(nextDocument.metadata.versionHistory?.[0]?.status).toBe("ready");
  });
});
