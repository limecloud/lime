import { describe, expect, it } from "vitest";
import {
  buildMemoryEntryCreationReplayRequestMetadata,
  buildSkillScaffoldCreationReplayRequestMetadata,
  extractCreationReplayMetadata,
} from "./creationReplayMetadata";

describe("buildSkillScaffoldCreationReplayRequestMetadata", () => {
  it("应生成可复用的技能草稿结构化回放 metadata", () => {
    const result = buildSkillScaffoldCreationReplayRequestMetadata(
      {
        name: "结果沉淀技能",
        description: "  把一次成功结果整理成稳定可复用的工作流。  ",
        target: "project",
        directory: "content/skill-writer",
        whenToUse: ["复用相近任务", "沉淀团队做法"],
        inputs: ["任务目标", "参考结果"],
        outputs: ["结构化输入骨架"],
        steps: ["先拆目标", "再补执行步骤"],
        fallbackStrategy: ["信息不足先补问"],
        sourceMessageId: "message-1",
        sourceExcerpt: "  一段可以继续复用的高质量结果摘要。  ",
      },
      {
        projectId: "project-7",
      },
    );

    expect(result).toEqual({
      harness: {
        creation_replay: {
          version: 1,
          kind: "skill_scaffold",
          source: {
            page: "skills",
            project_id: "project-7",
            source_message_id: "message-1",
          },
          data: {
            name: "结果沉淀技能",
            description: "把一次成功结果整理成稳定可复用的工作流。",
            target: "project",
            directory: "content/skill-writer",
            source_excerpt: "一段可以继续复用的高质量结果摘要。",
            when_to_use: ["复用相近任务", "沉淀团队做法"],
            inputs: ["任务目标", "参考结果"],
            outputs: ["结构化输入骨架"],
            steps: ["先拆目标", "再补执行步骤"],
            fallback_strategy: ["信息不足先补问"],
          },
        },
      },
    });
  });
});

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
            page: "memory",
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
  it("应从 requestMetadata.harness 中恢复 creation replay", () => {
    const requestMetadata = {
      harness: {
        creation_replay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory",
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
