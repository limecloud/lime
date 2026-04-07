import { describe, expect, it } from "vitest";
import {
  parseArtifactDocumentValue,
  resolveArtifactDocumentCurrentVersion,
  resolveArtifactDocumentCurrentVersionDiff,
  resolveArtifactDocumentSourceLinks,
  resolveArtifactDocumentVersionHistory,
} from "./parser";

describe("artifact-document parser", () => {
  it("应解析 metadata 中的版本历史与当前版本", () => {
    const document = parseArtifactDocumentValue({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "analysis",
      title: "季度分析",
      status: "ready",
      language: "zh-CN",
      blocks: [{ id: "block-1", type: "rich_text", markdown: "正文" }],
      sources: [],
      metadata: {
        currentVersionId: "artifact-document:demo:v2",
        currentVersionNo: 2,
        versionHistory: [
          {
            id: "artifact-document:demo:v1",
            artifactId: "artifact-document:demo",
            versionNo: 1,
            title: "季度分析",
            status: "ready",
          },
          {
            id: "artifact-document:demo:v2",
            artifactId: "artifact-document:demo",
            versionNo: 2,
            title: "季度分析",
            status: "ready",
            summary: "补充了董事会摘要",
          },
        ],
      },
    });

    expect(document).not.toBeNull();
    expect(resolveArtifactDocumentVersionHistory(document!)).toHaveLength(2);
    expect(resolveArtifactDocumentCurrentVersion(document!)).toMatchObject({
      id: "artifact-document:demo:v2",
      versionNo: 2,
      summary: "补充了董事会摘要",
    });
  });

  it("应在 metadata 没有 sourceLinks 时按 block.sourceIds 自动派生", () => {
    const document = parseArtifactDocumentValue({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "report",
      title: "研究周报",
      status: "ready",
      language: "zh-CN",
      blocks: [
        {
          id: "summary-1",
          type: "hero_summary",
          summary: "重点结论",
          sourceIds: ["source-1"],
        },
      ],
      sources: [
        {
          id: "source-1",
          type: "web",
          label: "OpenAI Blog",
          locator: {
            url: "https://openai.com/index/introducing",
          },
        },
      ],
      metadata: {},
    });

    expect(document).not.toBeNull();
    expect(resolveArtifactDocumentSourceLinks(document!)).toEqual([
      expect.objectContaining({
        artifactId: "artifact-document:demo",
        blockId: "summary-1",
        sourceId: "source-1",
        sourceType: "web",
        sourceRef: "https://openai.com/index/introducing",
        label: "OpenAI Blog",
      }),
    ]);
  });

  it("应解析当前版本 diff", () => {
    const document = parseArtifactDocumentValue({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "analysis",
      title: "版本化结论",
      status: "ready",
      language: "zh-CN",
      blocks: [{ id: "body-1", type: "rich_text", markdown: "新正文" }],
      sources: [],
      metadata: {
        currentVersionDiff: {
          baseVersionId: "artifact-document:demo:v1",
          baseVersionNo: 1,
          targetVersionId: "artifact-document:demo:v2",
          targetVersionNo: 2,
          updatedCount: 1,
          changedBlocks: [
            {
              blockId: "body-1",
              changeType: "updated",
              beforeText: "旧正文",
              afterText: "新正文",
              summary: "更新 block 内容",
            },
          ],
        },
      },
    });

    expect(document).not.toBeNull();
    expect(resolveArtifactDocumentCurrentVersionDiff(document!)).toMatchObject({
      baseVersionNo: 1,
      targetVersionNo: 2,
      updatedCount: 1,
      changedBlocks: [
        expect.objectContaining({
          blockId: "body-1",
          changeType: "updated",
        }),
      ],
    });
  });
});
