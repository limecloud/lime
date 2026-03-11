/**
 * @file SkillCard.test.ts
 * @description Skill 来源分类逻辑的属性测试
 * @module components/skills/SkillCard.test
 *
 * **Feature: skills-platform-mvp, Property 4: Source Classification Logic**
 * **Validates: Requirements 5.1, 5.2**
 */

import { describe, expect, it } from "vitest";
import { test } from "@fast-check/vitest";
import * as fc from "fast-check";
import {
  canManageSkillInstallation,
  canViewLocalSkillContent,
  getSkillSource,
  type SkillSource,
} from "./SkillCard";
import type { Skill } from "@/lib/api/skills";

/**
 * 创建一个基础 Skill 对象的辅助函数
 */
function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    key: "test-skill",
    name: "Test Skill",
    description: "A test skill",
    directory: "test-skill",
    installed: false,
    sourceKind: "other",
    ...overrides,
  };
}

describe("getSkillSource", () => {
  /**
   * Property 4: Source Classification Logic
   *
   * *For any* Skill object, the source classification SHALL return:
   * - "builtin" if sourceKind="builtin"
   * - "official" if repoOwner="proxycast" AND repoName="skills"
   * - "community" if repoOwner and repoName are present but not proxycast/skills
   * - "local" if repoOwner or repoName is missing
   *
   * **Validates: Requirements 5.1, 5.2**
   */
  describe("Property 4: Source Classification Logic", () => {
    // 生成有效的仓库所有者名（非 proxycast）
    const nonProxycastOwnerArb = fc
      .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/)
      .filter((s) => s !== "proxycast");

    // 生成有效的仓库名（非 skills）
    const nonSkillsNameArb = fc
      .stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/)
      .filter((s) => s !== "skills");

    // 生成任意有效的仓库名
    const repoNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/);

    test.prop([fc.constant("proxycast"), fc.constant("skills")], {
      numRuns: 100,
    })(
      "官方仓库 (proxycast/skills) 应返回 'official'",
      (repoOwner, repoName) => {
        const skill = createSkill({ repoOwner, repoName });
        const source = getSkillSource(skill);
        expect(source).toBe("official" as SkillSource);
      },
    );

    test.prop([nonProxycastOwnerArb, repoNameArb], { numRuns: 100 })(
      "非 proxycast 所有者的仓库应返回 'community'",
      (repoOwner, repoName) => {
        const skill = createSkill({ repoOwner, repoName });
        const source = getSkillSource(skill);
        expect(source).toBe("community" as SkillSource);
      },
    );

    test.prop([fc.constant("proxycast"), nonSkillsNameArb], { numRuns: 100 })(
      "proxycast 所有者但非 skills 仓库应返回 'community'",
      (repoOwner, repoName) => {
        const skill = createSkill({ repoOwner, repoName });
        const source = getSkillSource(skill);
        expect(source).toBe("community" as SkillSource);
      },
    );

    test.prop([fc.constant(undefined), fc.option(repoNameArb)], {
      numRuns: 100,
    })("缺少 repoOwner 应返回 'local'", (repoOwner, repoName) => {
      const skill = createSkill({
        repoOwner,
        repoName: repoName ?? undefined,
      });
      const source = getSkillSource(skill);
      expect(source).toBe("local" as SkillSource);
    });

    test.prop([fc.option(repoNameArb), fc.constant(undefined)], {
      numRuns: 100,
    })("缺少 repoName 应返回 'local'", (repoOwner, repoName) => {
      const skill = createSkill({
        repoOwner: repoOwner ?? undefined,
        repoName,
      });
      const source = getSkillSource(skill);
      expect(source).toBe("local" as SkillSource);
    });

    test.prop([fc.constant(undefined), fc.constant(undefined)], {
      numRuns: 100,
    })(
      "同时缺少 repoOwner 和 repoName 应返回 'local'",
      (repoOwner, repoName) => {
        const skill = createSkill({ repoOwner, repoName });
        const source = getSkillSource(skill);
        expect(source).toBe("local" as SkillSource);
      },
    );

    // 综合属性测试：验证分类的完备性和互斥性
    test.prop([fc.option(repoNameArb), fc.option(repoNameArb)], {
      numRuns: 100,
    })(
      "分类结果必须是 official、community 或 local 之一",
      (repoOwner, repoName) => {
        const skill = createSkill({
          repoOwner: repoOwner ?? undefined,
          repoName: repoName ?? undefined,
        });
        const source = getSkillSource(skill);
        expect(["builtin", "official", "community", "local"]).toContain(source);
      },
    );
  });
});

describe("canViewLocalSkillContent", () => {
  it("内置且已安装 skill 应可查看内容", () => {
    const skill = createSkill({
      installed: true,
      sourceKind: "builtin",
      repoOwner: undefined,
      repoName: undefined,
    });
    expect(canViewLocalSkillContent(skill)).toBe(true);
  });

  it("本地且已安装 skill 应可查看内容", () => {
    const skill = createSkill({
      installed: true,
      sourceKind: "other",
      repoOwner: undefined,
      repoName: undefined,
    });
    expect(canViewLocalSkillContent(skill)).toBe(true);
  });

  it("本地但未安装 skill 不可查看内容", () => {
    const skill = createSkill({
      installed: false,
      sourceKind: "other",
      repoOwner: undefined,
      repoName: undefined,
    });
    expect(canViewLocalSkillContent(skill)).toBe(false);
  });

  it("非本地已安装 skill 不可查看内容", () => {
    const skill = createSkill({
      installed: true,
      sourceKind: "other",
      repoOwner: "proxycast",
      repoName: "skills",
    });
    expect(canViewLocalSkillContent(skill)).toBe(false);
  });
});

describe("canManageSkillInstallation", () => {
  it("内置 skill 不应显示安装或卸载入口", () => {
    const skill = createSkill({ sourceKind: "builtin" });
    expect(canManageSkillInstallation(skill)).toBe(false);
  });

  it("其他 skill 应保留安装或卸载入口", () => {
    const skill = createSkill({ sourceKind: "other" });
    expect(canManageSkillInstallation(skill)).toBe(true);
  });
});
it("内置技能应优先返回 'builtin'", () => {
  const skill = createSkill({
    sourceKind: "builtin",
    repoOwner: "proxycast",
    repoName: "skills",
  });
  expect(getSkillSource(skill)).toBe("builtin" as SkillSource);
});
