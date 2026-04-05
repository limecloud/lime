import { describe, expect, it } from "vitest";
import type { Skill } from "@/lib/api/skills";
import {
  getActiveSkillDisplayLabel,
  getSkillSelectionSummaryLabel,
  SKILL_SELECTION_DISPLAY_COPY,
} from "./skillSelectionDisplay";

function createSkill(name: string): Skill {
  return {
    key: name,
    name,
    description: `${name} 的描述`,
    directory: name,
    installed: true,
    sourceKind: "builtin",
  };
}

describe("skillSelectionDisplay", () => {
  it("激活技能时应返回统一的挂载文案", () => {
    const skill = createSkill("写作助手");

    expect(getActiveSkillDisplayLabel(skill)).toBe("已挂载 写作助手");
    expect(
      getSkillSelectionSummaryLabel({
        activeSkill: skill,
        skillCount: 5,
      }),
    ).toBe("已挂载 写作助手");
  });

  it("未激活技能但存在能力来源时应显示统一数量文案", () => {
    expect(
      getSkillSelectionSummaryLabel({
        activeSkill: null,
        skillCount: 3,
      }),
    ).toBe("3 项技能可挂载");
  });

  it("无激活技能且无能力来源时应回退到空态文案", () => {
    expect(
      getSkillSelectionSummaryLabel({
        activeSkill: null,
        skillCount: 0,
      }),
    ).toBe(SKILL_SELECTION_DISPLAY_COPY.emptySelectionLabel);
  });
});
