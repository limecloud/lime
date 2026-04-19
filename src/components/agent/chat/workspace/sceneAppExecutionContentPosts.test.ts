import { describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import type { SessionFile } from "@/lib/api/session-files";
import type { TaskFile } from "../components/TaskFiles";
import { buildSceneAppExecutionContentPostEntries } from "./sceneAppExecutionContentPosts";

function createTaskFile(
  overrides: Partial<TaskFile> & { name: string },
): TaskFile {
  return {
    id: overrides.id ?? overrides.name,
    name: overrides.name,
    type: overrides.type ?? "document",
    content: overrides.content ?? "# 内容",
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    thumbnail: overrides.thumbnail,
    metadata: overrides.metadata,
  };
}

function createSessionFile(
  overrides: Partial<SessionFile> & { name: string },
): SessionFile {
  return {
    name: overrides.name,
    fileType: overrides.fileType ?? "document",
    metadata: overrides.metadata,
    size: overrides.size ?? 1,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

function createArtifact(
  overrides: Partial<Artifact> & { filePath: string },
): Artifact {
  const content = overrides.content ?? "# 结果";

  return {
    id: overrides.id ?? `artifact:${overrides.filePath}`,
    type: overrides.type ?? "document",
    title: overrides.title ?? "结果文件",
    content,
    status: overrides.status ?? "complete",
    meta: {
      filePath: overrides.filePath,
      ...overrides.meta,
    },
    position: overrides.position ?? { start: 0, end: content.length },
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    error: overrides.error,
  };
}

describe("buildSceneAppExecutionContentPostEntries", () => {
  it("应按 intent 聚合最近发布产物，并优先保留可直接打开的 task file", () => {
    const entries = buildSceneAppExecutionContentPostEntries({
      taskFiles: [
        createTaskFile({
          name: "content-posts/final-publish.md",
          updatedAt: 300,
          metadata: {
            contentPostIntent: "publish",
            contentPostLabel: "发布稿",
          },
        }),
        createTaskFile({
          name: "content-posts/channel-preview.md",
          updatedAt: 260,
          metadata: {
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
            contentPostPlatformLabel: "小红书",
          },
        }),
        createTaskFile({
          name: "content-posts/final-publish.cover.json",
          type: "other",
          updatedAt: 301,
        }),
      ],
      sessionFiles: [
        createSessionFile({
          name: "content-posts/final-publish.md",
          updatedAt: 300,
          metadata: {
            contentPostIntent: "publish",
            contentPostLabel: "发布稿",
          },
        }),
        createSessionFile({
          name: "content-posts/final-publish.publish-pack.json",
          fileType: "other",
          updatedAt: 302,
        }),
        createSessionFile({
          name: "content-posts/upload.md",
          updatedAt: 280,
          metadata: {
            contentPostIntent: "upload",
            contentPostLabel: "上传稿",
            contentPostPlatformLabel: "Instagram",
          },
        }),
      ],
      artifacts: [
        createArtifact({
          filePath: "content-posts/channel-preview.md",
          updatedAt: 250,
          meta: {
            contentPostIntent: "preview",
            contentPostLabel: "渠道预览稿",
          },
        }),
      ],
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.key)).toEqual([
      "publish",
      "preview",
      "upload",
    ]);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        label: "发布稿",
        readinessLabel: "可继续发布",
        readinessTone: "success",
        companionEntries: expect.arrayContaining([
          expect.objectContaining({
            key: "cover_meta",
            label: "封面信息",
          }),
          expect.objectContaining({
            key: "publish_pack",
            label: "发布包",
          }),
        ]),
        source: expect.objectContaining({
          kind: "task_file",
        }),
      }),
    );
    expect(entries[1]).toEqual(
      expect.objectContaining({
        label: "渠道预览稿",
        platformLabel: "小红书",
        readinessLabel: "优先渠道预览",
      }),
    );
    expect(entries[2]).toEqual(
      expect.objectContaining({
        label: "上传稿",
        platformLabel: "Instagram",
        readinessLabel: "优先上传整理",
        source: expect.objectContaining({
          kind: "session_file",
        }),
      }),
    );
  });

  it("发布稿缺少伴随材料时应明确标记待补项", () => {
    const [entry] = buildSceneAppExecutionContentPostEntries({
      taskFiles: [
        createTaskFile({
          name: "content-posts/publish-only.md",
          metadata: {
            contentPostIntent: "publish",
            contentPostLabel: "发布稿",
          },
        }),
      ],
      sessionFiles: [],
      artifacts: [],
    });

    expect(entry).toEqual(
      expect.objectContaining({
        key: "publish",
        readinessLabel: "待补封面信息、发布包",
        readinessTone: "watch",
        companionEntries: [],
      }),
    );
  });

  it("没有 publish metadata 的 content-posts 文档不应被误判为发布产物", () => {
    const entries = buildSceneAppExecutionContentPostEntries({
      taskFiles: [
        createTaskFile({
          name: "content-posts/plain-article.md",
        }),
      ],
      sessionFiles: [],
      artifacts: [
        createArtifact({
          filePath: "content-posts/raw-output.md",
        }),
      ],
    });

    expect(entries).toEqual([]);
  });
});
