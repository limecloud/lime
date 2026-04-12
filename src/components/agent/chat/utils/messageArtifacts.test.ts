import { describe, expect, it } from "vitest";

import type { Artifact } from "@/lib/artifact/types";
import { ARTIFACT_DOCUMENT_SCHEMA_VERSION } from "@/lib/artifact-document";
import {
  buildArtifactFromWrite,
  findMessageArtifact,
  mergeArtifacts,
  resolveDefaultArtifactViewMode,
} from "./messageArtifacts";

function createArtifact(overrides: Partial<Artifact> = {}): Artifact {
  const content = overrides.content ?? "";
  return {
    id: overrides.id ?? "artifact-1",
    type: overrides.type ?? "document",
    title: overrides.title ?? "report.artifact.json",
    content,
    status: overrides.status ?? "streaming",
    meta: {
      filePath:
        overrides.meta?.filePath ??
        ".lime/artifacts/thread-1/report.artifact.json",
      filename: overrides.meta?.filename ?? "report.artifact.json",
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

describe("messageArtifacts.buildArtifactFromWrite", () => {
  it("应从 artifactDocument metadata 直接构建结构化文档 artifact", () => {
    const artifactDocument = {
      schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
      artifactId: "artifact-doc-1",
      kind: "analysis",
      title: "自动落盘报告",
      status: "ready",
      language: "zh-CN",
      summary: "这是结构化摘要。",
      blocks: [
        {
          id: "hero-1",
          type: "hero_summary",
          summary: "这是结构化摘要。",
        },
      ],
      sources: [],
      metadata: {
        theme: "general",
      },
    };

    const artifact = buildArtifactFromWrite({
      filePath: ".lime/artifacts/thread-1/report.artifact.json",
      content: "",
      context: {
        artifactId: "artifact-snapshot-1",
        source: "artifact_snapshot",
        sourceMessageId: "assistant-1",
        status: "streaming",
        metadata: {
          complete: true,
          artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
          artifactDocument,
        },
      },
    });

    expect(artifact.type).toBe("document");
    expect(artifact.meta.language).toBe("json");
    expect(artifact.meta.previewText).toBe("这是结构化摘要。");
    expect(artifact.meta.artifactTitle).toBe("自动落盘报告");
    expect(artifact.meta.artifactKind).toBe("analysis");
    expect(artifact.meta.artifactDocument).toMatchObject({
      artifactId: "artifact-doc-1",
      kind: "analysis",
      title: "自动落盘报告",
      summary: "这是结构化摘要。",
    });
  });

  it("metadata 仅保留 schema 时应复用已有 artifactDocument", () => {
    const previousArtifact = createArtifact({
      meta: {
        filePath: ".lime/artifacts/thread-1/report.artifact.json",
        filename: "report.artifact.json",
        artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
        artifactDocument: {
          schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
          artifactId: "artifact-doc-2",
          kind: "report",
          title: "已有结构化文档",
          status: "ready",
          language: "zh-CN",
          summary: "沿用已有结构摘要",
          blocks: [
            {
              id: "hero-1",
              type: "hero_summary",
              summary: "沿用已有结构摘要",
            },
          ],
          sources: [],
          metadata: {},
        },
      },
    });

    const artifact = buildArtifactFromWrite({
      filePath: ".lime/artifacts/thread-1/report.artifact.json",
      content: "",
      context: {
        artifact: previousArtifact,
        source: "artifact_snapshot",
        sourceMessageId: "assistant-2",
        status: "complete",
        metadata: {
          artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
          complete: true,
        },
      },
    });

    expect(artifact.meta.artifactTitle).toBe("已有结构化文档");
    expect(artifact.meta.previewText).toBe("沿用已有结构摘要");
    expect(artifact.meta.artifactDocument).toMatchObject({
      artifactId: "artifact-doc-2",
      kind: "report",
      title: "已有结构化文档",
      summary: "沿用已有结构摘要",
    });
  });

  it("content 命中文档协议时应把 metadata 中补充的 sources 合并回内容", () => {
    const artifact = buildArtifactFromWrite({
      filePath: ".lime/artifacts/thread-1/report.artifact.json",
      content: JSON.stringify({
        schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
        artifactId: "artifact-doc-3",
        kind: "analysis",
        title: "来源合并演示",
        status: "ready",
        language: "zh-CN",
        summary: "正文仍以 content 为准。",
        blocks: [
          {
            id: "body-1",
            type: "rich_text",
            contentFormat: "markdown",
            content: "正文内容",
            markdown: "正文内容",
          },
        ],
        sources: [],
        metadata: {},
      }),
      context: {
        source: "artifact_snapshot",
        sourceMessageId: "assistant-3",
        status: "complete",
        metadata: {
          artifactSchema: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
          artifactDocument: {
            schemaVersion: ARTIFACT_DOCUMENT_SCHEMA_VERSION,
            artifactId: "artifact-doc-3",
            kind: "analysis",
            title: "来源合并演示",
            status: "ready",
            language: "zh-CN",
            summary: "正文仍以 content 为准。",
            blocks: [
              {
                id: "body-1",
                type: "rich_text",
                contentFormat: "markdown",
                content: "正文内容",
                markdown: "正文内容",
              },
            ],
            sources: [
              {
                id: "source-1",
                type: "web",
                label: "官方来源",
                locator: {
                  url: "https://example.com/source",
                },
              },
            ],
            metadata: {},
          },
        },
      },
    });

    expect(artifact.meta.artifactDocument).toMatchObject({
      artifactId: "artifact-doc-3",
      sources: [
        expect.objectContaining({
          id: "source-1",
          locator: expect.objectContaining({
            url: "https://example.com/source",
          }),
        }),
      ],
    });
    expect(artifact.content).toContain("https://example.com/source");
  });
});

describe("messageArtifacts.resolveDefaultArtifactViewMode", () => {
  it("可预览的编程产物在流式阶段应优先展示源码", () => {
    const artifact = createArtifact({
      type: "html",
      status: "streaming",
      meta: {
        filePath: "spring.html",
        filename: "spring.html",
        writePhase: "streaming",
      },
    });

    expect(
      resolveDefaultArtifactViewMode(artifact, {
        preferSourceWhenStreaming: true,
      }),
    ).toBe("source");
  });

  it("可预览的编程产物完成后应自动切回预览", () => {
    const artifact = createArtifact({
      type: "html",
      status: "complete",
      meta: {
        filePath: "spring.html",
        filename: "spring.html",
        writePhase: "completed",
      },
    });

    expect(
      resolveDefaultArtifactViewMode(artifact, {
        preferSourceWhenStreaming: true,
      }),
    ).toBe("preview");
  });
});

describe("messageArtifacts 路径归一", () => {
  it("应把文件名、相对路径与绝对路径视作同一个 artifact", () => {
    const message = {
      artifacts: [
        createArtifact({
          id: "artifact-output-image",
          title: "output_image.jpg",
          meta: {
            filePath:
              "/Users/coso/Documents/dev/ai/aiclientproxy/lime/.lime/tasks/image/output_image.jpg",
            filename: "output_image.jpg",
          },
        }),
      ],
    };

    expect(
      findMessageArtifact(message, {
        filePath: "output_image.jpg",
      })?.id,
    ).toBe("artifact-output-image");
    expect(
      findMessageArtifact(message, {
        filePath: ".lime/tasks/image/output_image.jpg",
      })?.id,
    ).toBe("artifact-output-image");
  });

  it("应在 mergeArtifacts 时收敛同一路径的重复 artifact 并保留更完整路径", () => {
    const merged = mergeArtifacts([
      createArtifact({
        id: "artifact-image-short",
        title: "output_image.jpg",
        meta: {
          filePath: "output_image.jpg",
          filename: "output_image.jpg",
        },
      }),
      createArtifact({
        id: "artifact-image-absolute",
        title: "output_image.jpg",
        updatedAt: 3,
        meta: {
          filePath:
            "/Users/coso/Documents/dev/ai/aiclientproxy/lime/.lime/tasks/image/output_image.jpg",
          filename: "output_image.jpg",
        },
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.meta.filePath).toBe(
      "/Users/coso/Documents/dev/ai/aiclientproxy/lime/.lime/tasks/image/output_image.jpg",
    );
  });

  it("显式结果路径查找时不应命中同名裸 artifact", () => {
    const message = {
      artifacts: [
        createArtifact({
          id: "artifact-process-index",
          title: "index.md",
          meta: {
            filePath: "index.md",
            filename: "index.md",
          },
        }),
        createArtifact({
          id: "artifact-export-index",
          title: "index.md",
          meta: {
            filePath: "exports/x-article-export/latest/index.md",
            filename: "index.md",
          },
        }),
      ],
    };

    expect(
      findMessageArtifact(message, {
        filePath: "exports/x-article-export/latest/index.md",
      })?.id,
    ).toBe("artifact-export-index");
  });
});
