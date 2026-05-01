import { describe, expect, it } from "vitest";
import type { Character, OutlineNode, ProjectMemory } from "@/lib/api/memory";
import { generateProjectMemoryPrompt } from "./projectPrompt";

const baseCharacter = {
  id: "character-default",
  project_id: "project-1",
  aliases: [],
  relationships: [],
  is_main: true,
  order: 0,
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
} satisfies Omit<Character, "name">;

const baseOutlineNode = {
  id: "outline-default",
  project_id: "project-1",
  order: 0,
  expanded: true,
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-01T00:00:00.000Z",
} satisfies Omit<OutlineNode, "title">;

function buildMemory(memory: Partial<ProjectMemory>): ProjectMemory {
  return {
    characters: [],
    outline: [],
    ...memory,
  };
}

describe("generateProjectMemoryPrompt", () => {
  it("默认占位记忆不应注入系统提示词", () => {
    const prompt = generateProjectMemoryPrompt(
      buildMemory({
        characters: [
          {
            ...baseCharacter,
            name: "默认主角",
            description: "待补充角色设定",
          },
        ],
        world_building: {
          project_id: "project-1",
          description: "待补充世界观背景与规则",
          updated_at: "2026-05-01T00:00:00.000Z",
        },
        outline: [
          {
            ...baseOutlineNode,
            title: "第一章",
            content: "待补充章节内容",
          },
        ],
      }),
    );

    expect(prompt).toBe("");
  });

  it("只保留真实项目记忆并过滤占位字段", () => {
    const prompt = generateProjectMemoryPrompt(
      buildMemory({
        characters: [
          {
            ...baseCharacter,
            name: "默认主角",
            description: "待补充角色设定",
          },
          {
            ...baseCharacter,
            id: "character-real",
            name: "林青",
            description: "擅长把复杂需求拆成行动清单。",
            aliases: ["青柠"],
          },
        ],
        world_building: {
          project_id: "project-1",
          description: "待补充世界观背景与规则",
          rules: "所有输出必须可直接执行。",
          updated_at: "2026-05-01T00:00:00.000Z",
        },
        outline: [
          {
            ...baseOutlineNode,
            title: "第一章",
            content: "待补充章节内容",
          },
          {
            ...baseOutlineNode,
            id: "outline-real",
            title: "执行阶段",
            content: "先完成最小闭环，再逐步扩展。",
            order: 1,
          },
        ],
      }),
    );

    expect(prompt).toContain("## 项目背景");
    expect(prompt).toContain("林青");
    expect(prompt).toContain("青柠");
    expect(prompt).toContain("所有输出必须可直接执行。");
    expect(prompt).toContain("执行阶段");
    expect(prompt).not.toContain("默认主角");
    expect(prompt).not.toContain("待补充");
  });
});
