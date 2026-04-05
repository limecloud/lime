import { describe, expect, it } from "vitest";
import type { Skill } from "@/lib/api/skills";
import {
  matchesMentionableSkillQuery,
  partitionMentionableSkills,
} from "./skillQuery";

function createSkill(name: string, key: string, installed: boolean): Skill {
  return {
    key,
    name,
    description: `${name} 的描述`,
    directory: `${key}-dir`,
    installed,
    sourceKind: "builtin",
  };
}

describe("skillQuery", () => {
  it("应按同一搜索规则匹配技能名称、key 与描述", () => {
    const skill = createSkill("结构化写作", "structured-writing", true);

    expect(matchesMentionableSkillQuery(skill, "结构化")).toBe(true);
    expect(matchesMentionableSkillQuery(skill, "structured")).toBe(true);
    expect(matchesMentionableSkillQuery(skill, "描述")).toBe(true);
    expect(matchesMentionableSkillQuery(skill, "不存在")).toBe(false);
  });

  it("应按安装状态拆分可提及技能", () => {
    const installedSkill = createSkill("写作助手", "writer", true);
    const availableSkill = createSkill("仓库检索", "repo-radar", false);

    const result = partitionMentionableSkills(
      [installedSkill, availableSkill],
      "写作",
    );

    expect(result.installedSkills).toEqual([installedSkill]);
    expect(result.availableSkills).toEqual([]);
  });
});
