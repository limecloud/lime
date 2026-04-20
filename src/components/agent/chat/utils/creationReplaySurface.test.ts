import { describe, expect, it } from "vitest";
import { buildCreationReplaySurfaceModel } from "./creationReplaySurface";

describe("buildCreationReplaySurfaceModel", () => {
  it("风格类 memory entry 应显影为 taste 导向的前台对象", () => {
    const result = buildCreationReplaySurfaceModel({
      version: 1,
      kind: "memory_entry",
      source: {
        page: "memory",
        project_id: "project-1",
        entry_id: "memory-identity-1",
      },
      data: {
        category: "identity",
        title: "品牌风格样本",
        tags: ["科技蓝", "留白", "高级感"],
      },
    });

    expect(result).toEqual({
      kind: "memory_entry",
      eyebrow: "当前带入风格参考",
      badgeLabel: "风格",
      title: "品牌风格样本",
      summary: "风格标签：科技蓝、留白、高级感",
      hint: "后续结果模板会默认沿用这条风格参考。",
      defaultReferenceMemoryIds: ["memory-identity-1"],
      defaultReferenceEntries: [
        expect.objectContaining({
          id: "memory-identity-1",
          title: "品牌风格样本",
          category: "identity",
          categoryLabel: "风格",
        }),
      ],
    });
  });

  it("偏好类 memory entry 在缺少摘要和 entry id 时应使用偏好基线兜底文案", () => {
    const result = buildCreationReplaySurfaceModel({
      version: 1,
      kind: "memory_entry",
      source: {
        page: "memory",
        project_id: "project-2",
      },
      data: {
        category: "preference",
        tags: [],
      },
    });

    expect(result).toEqual({
      kind: "memory_entry",
      eyebrow: "当前带入偏好基线",
      badgeLabel: "偏好",
      title: "未命名偏好",
      summary: "这条偏好基线会继续影响当前生成的取向。",
      hint: "当前生成会继续沿用这条偏好基线。",
      defaultReferenceMemoryIds: [],
      defaultReferenceEntries: [],
    });
  });

  it("技能草稿回放应继续保持原有前台文案", () => {
    const result = buildCreationReplaySurfaceModel({
      version: 1,
      kind: "skill_scaffold",
      source: {
        page: "skills",
        project_id: "project-3",
      },
      data: {
        name: "账号复盘方法",
        description: "把结果复盘成下一轮增长方案。",
      },
    });

    expect(result).toEqual({
      kind: "skill_scaffold",
      eyebrow: "当前带入技能草稿",
      badgeLabel: "技能草稿",
      title: "账号复盘方法",
      summary: "把结果复盘成下一轮增长方案。",
      hint: "当前生成会继续沿用这份技能草稿的上下文。",
      defaultReferenceMemoryIds: [],
      defaultReferenceEntries: [],
    });
  });
});
