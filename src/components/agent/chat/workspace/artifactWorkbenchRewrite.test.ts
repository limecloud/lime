import { describe, expect, it } from "vitest";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { Artifact } from "@/lib/artifact/types";
import {
  buildArtifactBlockRewriteRequest,
  resolveArtifactBlockRewriteCompletion,
} from "./artifactWorkbenchRewrite";
import { DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION } from "./artifactWorkbenchRewriteConfig";

function createArtifact(): Artifact {
  return {
    id: "artifact-1",
    type: "document",
    title: "board-review.artifact.json",
    content: "",
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/board-review.artifact.json",
      filename: "board-review.artifact.json",
      artifactRequestId: "artifact:analysis:board-review",
    },
    position: { start: 0, end: 0 },
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDocument(): ArtifactDocumentV1 {
  return {
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:artifact:analysis:board-review",
    kind: "analysis",
    title: "董事会季度复盘",
    status: "ready",
    language: "zh-CN",
    summary: "聚焦收入、交付和风险收口。",
    blocks: [
      {
        id: "hero-1",
        type: "hero_summary",
        title: "季度经营摘要",
        summary: "收入增长稳定，但交付时延仍需关注。",
        sourceIds: ["source-1"],
      },
      {
        id: "body-1",
        type: "rich_text",
        contentFormat: "markdown",
        content: "当前正文内容",
        markdown: "当前正文内容",
        sourceIds: ["source-1"],
      },
      {
        id: "callout-1",
        type: "callout",
        tone: "warning",
        title: "风险提示",
        body: "需要压缩交付周期。",
      },
    ],
    sources: [
      {
        id: "source-1",
        type: "web",
        label: "季度经营看板",
        locator: {
          url: "https://example.com/board-review",
        },
        snippet: "交付周期环比改善 8%，但仍高于季度目标。",
      },
    ],
    metadata: {},
  };
}

describe("buildArtifactBlockRewriteRequest", () => {
  it("应生成 rewrite prompt 与 artifact request metadata", () => {
    const result = buildArtifactBlockRewriteRequest({
      artifact: createArtifact(),
      document: createDocument(),
      entry: {
        blockId: "body-1",
        label: "正文块 1",
        detail: "执行摘要",
        editorKind: "rich_text",
        draft: {
          editorKind: "rich_text",
          markdown: "更新前的正文草稿",
        },
      },
      draft: {
        editorKind: "rich_text",
        markdown: "更新前的正文草稿",
      },
      timelineLink: {
        itemId: "thread-item-body",
        blockId: "body-1",
        label: "步骤 04",
        filePath: ".lime/artifacts/thread-1/board-review.artifact.json",
        sequence: 4,
      },
      instruction: "请改得更适合董事会直接阅读。",
    });

    expect(result.requestMetadata).toEqual({
      artifact: {
        artifact_mode: "rewrite",
        artifact_stage: "rewrite",
        artifact_kind: "analysis",
        artifact_request_id: "artifact:analysis:board-review",
        artifact_target_block_id: "body-1",
        artifact_rewrite_instruction: "请改得更适合董事会直接阅读。",
        source_policy: "required",
        workbench_surface: "right_panel",
      },
    });
    expect(result.prompt).toContain("Lime Artifact Workbench 的局部改写任务");
    expect(result.prompt).toContain('"id": "body-1"');
    expect(result.prompt).toContain(
      "当前编辑稿（这是最新输入，即使它还没保存）",
    );
    expect(result.prompt).toContain("季度经营看板");
    expect(result.prompt).toContain("步骤 04");
    expect(result.prompt).toContain("请改得更适合董事会直接阅读。");
  });

  it("来源为空时应把 source_policy 降为 preferred", () => {
    const document = createDocument();
    document.sources = [];
    document.blocks[1] = {
      ...document.blocks[1],
      sourceIds: [],
    };

    const result = buildArtifactBlockRewriteRequest({
      artifact: createArtifact(),
      document,
      entry: {
        blockId: "body-1",
        label: "正文块 1",
        editorKind: "rich_text",
        draft: {
          editorKind: "rich_text",
          markdown: "没有来源的正文",
        },
      },
      draft: {
        editorKind: "rich_text",
        markdown: "没有来源的正文",
      },
    });

    expect(result.requestMetadata.artifact.source_policy).toBe("preferred");
  });

  it("自定义指令为空时应回退到默认改写说明", () => {
    const result = buildArtifactBlockRewriteRequest({
      artifact: createArtifact(),
      document: createDocument(),
      entry: {
        blockId: "body-1",
        label: "正文块 1",
        editorKind: "rich_text",
        draft: {
          editorKind: "rich_text",
          markdown: "当前正文",
        },
      },
      draft: {
        editorKind: "rich_text",
        markdown: "当前正文",
      },
      instruction: "   ",
    });

    expect(result.requestMetadata.artifact.artifact_rewrite_instruction).toBe(
      DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION,
    );
    expect(result.prompt).toContain(DEFAULT_ARTIFACT_BLOCK_REWRITE_INSTRUCTION);
  });

  it("应把 rewrite patch 解析成可直接回填的 draft 建议", () => {
    const payload = {
      artifact: createArtifact(),
      document: createDocument(),
      entry: {
        blockId: "body-1",
        label: "正文块 1",
        detail: "执行摘要",
        editorKind: "rich_text" as const,
        draft: {
          editorKind: "rich_text" as const,
          markdown: "更新前正文",
        },
      },
      draft: {
        editorKind: "rich_text" as const,
        markdown: "更新前正文",
      },
    };

    const completion = resolveArtifactBlockRewriteCompletion(
      payload,
      `{
        "type": "artifact_rewrite_patch",
        "artifactId": "artifact-document:artifact:analysis:board-review",
        "targetBlockId": "body-1",
        "summary": "压缩冗余表达，保留事实信息",
        "block": {
          "id": "body-1",
          "type": "rich_text",
          "contentFormat": "markdown",
          "content": "AI 改写后的正文",
          "markdown": "AI 改写后的正文"
        }
      }`,
    );

    expect(completion.warning).toBeUndefined();
    expect(completion.suggestion).toEqual({
      block: expect.objectContaining({
        id: "body-1",
        type: "rich_text",
      }),
      summary: "压缩冗余表达，保留事实信息",
      draft: {
        editorKind: "rich_text",
        markdown: "AI 改写后的正文",
      },
    });
  });

  it("应支持把 key points rewrite patch 解析成结构化草稿", () => {
    const document = createDocument();
    document.blocks.push({
      id: "points-1",
      type: "key_points",
      title: "关键结论",
      items: ["原结论 1", "原结论 2"],
    });

    const payload = {
      artifact: createArtifact(),
      document,
      entry: {
        blockId: "points-1",
        label: "关键结论",
        detail: "执行摘要",
        editorKind: "key_points" as const,
        draft: {
          editorKind: "key_points" as const,
          title: "关键结论",
          items: "原结论 1\n原结论 2",
        },
      },
      draft: {
        editorKind: "key_points" as const,
        title: "关键结论",
        items: "原结论 1\n原结论 2",
      },
    };

    const completion = resolveArtifactBlockRewriteCompletion(
      payload,
      `{
        "type": "artifact_rewrite_patch",
        "artifactId": "artifact-document:artifact:analysis:board-review",
        "targetBlockId": "points-1",
        "summary": "将结论收敛为更可扫描的两点",
        "block": {
          "id": "points-1",
          "type": "key_points",
          "title": "关键结论",
          "items": ["现金流保持健康", "交付效率仍需治理"]
        }
      }`,
    );

    expect(completion.warning).toBeUndefined();
    expect(completion.suggestion).toEqual({
      block: expect.objectContaining({
        id: "points-1",
        type: "key_points",
      }),
      summary: "将结论收敛为更可扫描的两点",
      draft: {
        editorKind: "key_points",
        title: "关键结论",
        items: "现金流保持健康\n交付效率仍需治理",
      },
    });
  });
});
