import { describe, expect, it } from "vitest";
import {
  buildMemoryEntryCreationReplayRequestMetadata,
  extractCreationReplayMetadata,
} from "./creationReplayMetadata";

describe("buildMemoryEntryCreationReplayRequestMetadata", () => {
  it("应生成灵感条目的结构化回放 metadata", () => {
    const result = buildMemoryEntryCreationReplayRequestMetadata({
      id: "memory-2",
      projectId: "project-9",
      category: "experience",
      title: "  爆款短视频开头  ",
      summary: "前三秒必须先给反差感。",
      content: "先抛结论，再给画面，再补一句动作召回。",
      tags: ["短视频", "开场", "转化"],
    });

    expect(result).toEqual({
      harness: {
        creation_replay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory_store",
            project_id: "project-9",
            entry_id: "memory-2",
          },
          data: {
            category: "experience",
            title: "爆款短视频开头",
            summary: "前三秒必须先给反差感。",
            content_excerpt: "先抛结论，再给画面，再补一句动作召回。",
            tags: ["短视频", "开场", "转化"],
          },
        },
      },
    });
  });
});

describe("extractCreationReplayMetadata", () => {
  it("旧技能草稿 metadata 不再恢复为聊天续用入口", () => {
    expect(
      extractCreationReplayMetadata({
        harness: {
          creation_replay: {
            version: 1,
            kind: "skill_scaffold",
            source: { page: "skills" },
            data: { name: "旧技能草稿" },
          },
        },
      }),
    ).toBeUndefined();
  });

  it("应从 requestMetadata.harness 中恢复 creation replay", () => {
    const requestMetadata = {
      harness: {
        creation_replay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory_store",
            project_id: "project-12",
            entry_id: "memory-12",
          },
          data: {
            category: "identity",
            title: "夏日口播语气",
            summary: "整体语气要轻快。",
            tags: ["小红书", "口播"],
          },
        },
      },
    };

    expect(extractCreationReplayMetadata(requestMetadata)).toEqual(
      requestMetadata.harness.creation_replay,
    );
  });
});
