import { describe, expect, it } from "vitest";
import {
  buildCreationIntentMetadata,
  buildCreationIntentPrompt,
  createInitialCreationIntentValues,
  getCreationIntentFields,
  getCreationIntentFieldsSafe,
  getCreationIntentText,
  normalizeCreationMode,
  validateCreationIntent,
} from "./creationIntentPrompt";

describe("creationIntentPrompt", () => {
  it("应返回对应模式的字段定义", () => {
    const guidedFields = getCreationIntentFields("guided");
    const frameworkFields = getCreationIntentFields("framework");
    const fastFields = getCreationIntentFields("fast");

    expect(guidedFields.map((item) => item.key)).toEqual([
      "topic",
      "targetAudience",
      "goal",
      "constraints",
    ]);
    expect(frameworkFields.map((item) => item.key)).toContain("outline");
    expect(frameworkFields.map((item) => item.key)).toContain("mustInclude");
    expect(guidedFields.find((item) => item.key === "targetAudience")?.options)
      .toBeTruthy();
    expect(fastFields.find((item) => item.key === "contentType")?.options)
      .toBeTruthy();
  });

  it("应对非法模式做安全归一化", () => {
    expect(normalizeCreationMode("hybrid")).toBe("hybrid");
    expect(normalizeCreationMode("ai-discuss")).toBe("guided");

    const safeFields = getCreationIntentFieldsSafe("ai-discuss");
    expect(safeFields).toHaveLength(4);
    expect(safeFields[0]?.key).toBe("topic");
  });

  it("应正确校验最小意图长度", () => {
    const input = {
      creationMode: "fast" as const,
      values: {
        ...createInitialCreationIntentValues(),
        topic: "短",
      },
    };

    const result = validateCreationIntent(input, 10);
    expect(result.valid).toBe(false);
    expect(result.length).toBe(1);
  });

  it("应正确拼装意图正文文本", () => {
    const text = getCreationIntentText({
      creationMode: "hybrid",
      values: {
        ...createInitialCreationIntentValues(),
        topic: "AI 写作流程优化",
        targetAudience: "内容运营团队",
        corePoints: "先出框架，再填充细节",
        tone: "专业简洁",
        extraRequirements: "给出可执行步骤",
      },
    });

    expect(text).toContain("AI 写作流程优化");
    expect(text).toContain("先出框架，再填充细节");
    expect(text).toContain("给出可执行步骤");
  });

  it("应输出结构化首条提示词", () => {
    const prompt = buildCreationIntentPrompt({
      creationMode: "framework",
      values: {
        ...createInitialCreationIntentValues(),
        topic: "社媒选题方法论",
        targetAudience: "新媒体编辑",
        outline: "1. 选题来源\n2. 判断标准\n3. 实操案例",
        mustInclude: "案例与可复制模板",
        extraRequirements: "语气务实，避免空话",
      },
    });

    expect(prompt).toContain("[创作模式] 框架模式");
    expect(prompt).toContain("[主题方向] 社媒选题方法论");
    expect(prompt).toContain("[框架提纲]");
    expect(prompt).toContain("[补充要求] 语气务实，避免空话");
    expect(prompt).toContain("[执行要求]");
  });

  it("应生成可持久化的 metadata", () => {
    const metadata = buildCreationIntentMetadata({
      creationMode: "guided",
      values: {
        ...createInitialCreationIntentValues(),
        topic: "品牌故事写作",
        targetAudience: "潜在客户",
        goal: "提升品牌信任",
      },
    });

    expect(metadata.mode).toBe("guided");
    expect(metadata.topic).toBe("品牌故事写作");
    expect(metadata["主题方向"]).toBe("品牌故事写作");
    expect(metadata.intentText).toBeTruthy();
  });
});
