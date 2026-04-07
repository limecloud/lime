import { describe, expect, it } from "vitest";
import {
  buildArtifactTimelineLinkIndex,
  resolveTimelineArtifactNavigation,
} from "./artifactTimelineNavigation";
import type { AgentThreadItem } from "../types";
import type { Artifact } from "@/lib/artifact/types";

function createFileArtifactItem(
  overrides: Partial<Extract<AgentThreadItem, { type: "file_artifact" }>> = {},
): Extract<AgentThreadItem, { type: "file_artifact" }> {
  return {
    id: "item-1",
    thread_id: "thread-1",
    turn_id: "turn-1",
    sequence: 3,
    status: "completed",
    started_at: "2026-03-25T10:00:00Z",
    completed_at: "2026-03-25T10:00:01Z",
    updated_at: "2026-03-25T10:00:01Z",
    type: "file_artifact",
    path: ".lime/artifacts/thread-1/demo.artifact.json",
    source: "artifact_snapshot",
    content: JSON.stringify({
      schemaVersion: "artifact_document.v1",
      artifactId: "artifact-document:demo",
      kind: "analysis",
      title: "季度总结",
      status: "ready",
      language: "zh-CN",
      blocks: [
        { id: "hero-1", type: "hero_summary", summary: "摘要" },
        { id: "body-1", type: "rich_text", markdown: "正文" },
      ],
      sources: [],
      metadata: {
        currentVersionDiff: {
          changedBlocks: [
            {
              blockId: "body-1",
              changeType: "updated",
            },
          ],
        },
      },
    }),
    metadata: {
      artifact_id: "artifact-document:demo",
    },
    ...overrides,
  };
}

function createArtifact(): Artifact {
  const content = JSON.stringify({
    schemaVersion: "artifact_document.v1",
    artifactId: "artifact-document:demo",
    kind: "analysis",
    title: "季度总结",
    status: "ready",
    language: "zh-CN",
    blocks: [
      { id: "hero-1", type: "hero_summary", summary: "摘要" },
      { id: "body-1", type: "rich_text", markdown: "正文" },
    ],
    sources: [],
    metadata: {},
  });

  return {
    id: "artifact-1",
    type: "document",
    title: "demo.artifact.json",
    content,
    status: "complete",
    meta: {
      filePath: ".lime/artifacts/thread-1/demo.artifact.json",
      filename: "demo.artifact.json",
      language: "json",
    },
    position: { start: 0, end: content.length },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("artifactTimelineNavigation", () => {
  it("应优先从 timeline file_artifact 的 diff 中提取 block 目标", () => {
    const navigation = resolveTimelineArtifactNavigation(
      createFileArtifactItem(),
    );

    expect(navigation?.rootTarget.filePath).toBe(
      ".lime/artifacts/thread-1/demo.artifact.json",
    );
    expect(navigation?.blockTargets).toEqual([
      expect.objectContaining({
        timelineItemId: "item-1",
        blockId: "body-1",
      }),
    ]);
  });

  it("构建 workbench 侧索引时应按 blockId 回灌 timeline 关联", () => {
    const linkIndex = buildArtifactTimelineLinkIndex({
      artifact: createArtifact(),
      items: [
        createFileArtifactItem(),
        createFileArtifactItem({
          id: "item-2",
          sequence: 5,
          updated_at: "2026-03-25T10:00:03Z",
          metadata: {
            artifact_id: "artifact-document:demo",
            artifact_block_id: "hero-1",
          },
        }),
      ],
    });

    expect(linkIndex["body-1"]).toEqual([
      expect.objectContaining({
        itemId: "item-1",
        blockId: "body-1",
      }),
    ]);
    expect(linkIndex["hero-1"]).toEqual([
      expect.objectContaining({
        itemId: "item-2",
        blockId: "hero-1",
      }),
    ]);
  });
});
