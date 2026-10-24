import { describe, expect, it } from "vitest";
import type { Skill } from "@/lib/api/skills";
import {
  resolveInputCapabilitySendRoute,
  resolveInputCapabilitySelectionFromRoute,
} from "./inputCapabilitySelection";

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    key: "local:personal-ip-knowledge-builder",
    name: "产品知识库",
    description: "沉淀品牌与产品资料",
    directory: "personal-ip-knowledge-builder",
    installed: true,
    sourceKind: "other",
    ...overrides,
  };
}

describe("inputCapabilitySelection", () => {
  it("拒绝已删除的技能路由，不能落入场景 fallback", () => {
    expect(() =>
      resolveInputCapabilitySelectionFromRoute({
        route: {
          kind: "installed_skill",
          skillKey: "writer",
          skillName: "Writer",
        } as never,
      }),
    ).toThrow("Unsupported input capability route");
  });
  it("已安装技能直接使用文档 atom，不创建发送路由", () => {
    const route = resolveInputCapabilitySendRoute({
      kind: "installed_skill",
      skill: createSkill(),
    });

    expect(route).toBeUndefined();
  });

  it("不从缺失目录或 local key 生成技能命令", () => {
    const route = resolveInputCapabilitySendRoute({
      kind: "installed_skill",
      skill: createSkill({
        key: "local:writer",
        name: "写作助手",
        directory: "",
      }),
    });

    expect(route).toBeUndefined();
  });
});
