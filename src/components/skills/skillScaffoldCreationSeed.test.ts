import { describe, expect, it } from "vitest";
import { buildSkillScaffoldCreationSeed } from "./skillScaffoldCreationSeed";

describe("buildSkillScaffoldCreationSeed", () => {
  it("应把技能草稿整理成可带回创作输入的骨架", () => {
    const result = buildSkillScaffoldCreationSeed({
      name: "研究结果复用",
      description: "沉淀自一次成功结果",
      sourceExcerpt: "围绕 AI Agent 融资信息输出研究摘要",
      whenToUse: ["当你需要继续复用研究摘要结构时使用。"],
      inputs: ["目标与主题：AI Agent 融资动态"],
      outputs: ["交付一份可直接复用的研究摘要。"],
      steps: ["先确认主题，再沿用原结果的结构骨架。"],
      fallbackStrategy: ["信息不足时先补问关键时间范围。"],
    });

    expect(result).toEqual({
      initialUserPrompt: [
        "请基于下面这份技能草稿继续开工。先整理成可编辑的输入骨架，再继续执行。",
        "技能名称：研究结果复用",
        "技能定位：沉淀自一次成功结果",
        "来源结果：围绕 AI Agent 融资信息输出研究摘要",
        "适用场景：\n1. 当你需要继续复用研究摘要结构时使用。",
        "输入约束：\n1. 目标与主题：AI Agent 融资动态",
        "期望输出：\n1. 交付一份可直接复用的研究摘要。",
        "执行步骤：\n1. 先确认主题，再沿用原结果的结构骨架。",
        "失败回退：\n1. 信息不足时先补问关键时间范围。",
      ].join("\n\n"),
      entryBannerMessage: "已从技能草稿“研究结果复用”带回创作输入，可继续改写后发送。",
    });
  });

  it("字段不足时应回退到默认技能名并省略空分区", () => {
    const result = buildSkillScaffoldCreationSeed({
      name: "   ",
      description: "",
      whenToUse: [],
      inputs: ["补充关键目标"],
    });

    expect(result.initialUserPrompt).toContain("技能名称：结果复用技能");
    expect(result.initialUserPrompt).toContain("输入约束：\n1. 补充关键目标");
    expect(result.initialUserPrompt).not.toContain("适用场景：");
    expect(result.entryBannerMessage).toBe(
      "已从技能草稿“结果复用技能”带回创作输入，可继续改写后发送。",
    );
  });
});
