import { describe, expect, it } from "vitest";
import type { ServiceSkillPresentationCopy } from "@/components/agent/chat/service-skills/skillPresentation";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";
import type { Skill } from "@/lib/api/skills";
import type { SkillMarketplaceItem } from "@/lib/api/officialSkillMarketplace";
import {
  buildInstalledLocalSkills,
  buildSkillStoreItems,
  getVisibleBuiltinLocalSkills,
  getVisibleInstalledLocalSkills,
  getVisibleSkillStoreItems,
  getVisibleUserInstalledSkills,
  isMarketplaceSkillInstalledAsLocalSkill,
  matchesSkillsText,
  normalizeSkillsKeyword,
} from "./SkillsWorkspacePageViewModel";
import type { InstalledSkillPresentationCopy } from "./installedSkillPresentation";

const installedSkillCopy: InstalledSkillPresentationCopy = {
  defaultPromise: "默认能力说明",
  fallbackRequiredInputs: "无必填输入",
  fallbackOutputHint: "默认输出",
  requiredPrefix: "输入：",
  outputPrefix: "输出：",
};

const serviceSkillCopy: ServiceSkillPresentationCopy = {
  fallbackRequiredInputs: "无必填输入",
  requiredPrefix: "输入：",
  outputPrefix: "输出：",
  formatFactItems: (visibleItems, totalCount) =>
    visibleItems.length >= totalCount
      ? visibleItems.join("、")
      : `${visibleItems.join("、")} 等 ${totalCount} 项`,
};

function createSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    key: "local:writer",
    name: "写作助手",
    description: "复用本地写作流程",
    directory: "writer",
    installed: true,
    sourceKind: "other",
    catalogSource: "user",
    ...overrides,
  };
}

function createServiceSkill(
  overrides: Partial<ServiceSkillHomeItem> = {},
): ServiceSkillHomeItem {
  return {
    id: "service-research",
    title: "深度研究",
    summary: "综合多来源信息",
    category: "调研",
    outputHint: "研究摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    slotSchema: [],
    version: "2026-03-29",
    badge: "官方",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "立即开始",
    runnerTone: "sky",
    runnerDescription: "整理输入后执行",
    actionLabel: "开始",
    automationStatus: null,
    ...overrides,
  };
}

function createMarketplaceSkill(
  overrides: Partial<SkillMarketplaceItem> = {},
): SkillMarketplaceItem {
  return {
    id: "official-research",
    name: "official-research",
    aliases: ["research"],
    title: "官方研究",
    summary: "从官方市场安装的研究 Skill",
    category: "调研",
    outputHint: "研究报告",
    version: "1.0.0",
    sort: 10,
    ...overrides,
  };
}

describe("SkillsWorkspacePageViewModel", () => {
  it("归一化并按大小写无关方式匹配搜索文本", () => {
    expect(normalizeSkillsKeyword("  ReSearch  ")).toBe("research");
    expect(matchesSkillsText(" SKILL ", "local skill catalog")).toBe(true);
    expect(matchesSkillsText("skill", undefined, "unrelated")).toBe(false);
    expect(matchesSkillsText("   ", undefined)).toBe(true);
  });

  it("只保留已安装本地 Skill，并用乐观安装项替换同目录旧项", () => {
    const writer = createSkill({ directory: "writer", name: "旧写作助手" });
    const draft = createSkill({
      directory: "draft",
      installed: false,
      name: "未安装草稿",
    });
    const optimistic = createSkill({
      directory: "writer",
      name: "新写作助手",
      installed: true,
    });

    expect(buildInstalledLocalSkills([writer, draft], optimistic)).toEqual([
      optimistic,
    ]);
  });

  it("搜索已安装 Skill 的元数据能力说明，并把高亮目录排到最前", () => {
    const highlighted = createSkill({
      directory: "writer",
      name: "写作助手",
      metadata: {
        lime_when_to_use: "处理公众号长文",
        lime_argument_hint: "主题和受众",
      },
    });
    const alpha = createSkill({
      directory: "alpha",
      name: "Alpha",
      metadata: {
        lime_when_to_use: "处理公众号短文",
      },
    });
    const unrelated = createSkill({
      directory: "browser",
      name: "浏览器助手",
      metadata: {
        lime_when_to_use: "网页自动化",
      },
    });

    const visibleSkills = getVisibleInstalledLocalSkills({
      installedLocalSkills: [alpha, unrelated, highlighted],
      searchQuery: "公众号",
      highlightedInstalledSkillDirectory: "writer",
      copy: installedSkillCopy,
    });

    expect(visibleSkills.map((skill) => skill.directory)).toEqual([
      "writer",
      "alpha",
    ]);
  });

  it("官方市场数据优先；没有官方数据时从服务 Skill 生成本地 fallback 并限制数量", () => {
    const official = createMarketplaceSkill({ id: "official-one" });
    const serviceSkills = Array.from({ length: 3 }, (_, index) =>
      createServiceSkill({
        id: `service-${index}`,
        title: `服务 Skill ${index}`,
      }),
    );

    expect(
      buildSkillStoreItems({
        officialMarketplaceSkills: [official],
        workspaceServiceSkills: serviceSkills,
      }),
    ).toEqual([{ source: "official", skill: official }]);

    const fallbackItems = buildSkillStoreItems({
      officialMarketplaceSkills: [],
      workspaceServiceSkills: serviceSkills,
      fallbackLimit: 2,
    });

    expect(fallbackItems).toHaveLength(2);
    expect(fallbackItems.map((item) => item.source)).toEqual([
      "local_fallback",
      "local_fallback",
    ]);
    expect(fallbackItems[0]?.skill.id).toBe("local-fallback:service-0");
  });

  it("官方市场技能应识别后端为避让内置目录而生成的安装目录", () => {
    const marketplaceSkill = createMarketplaceSkill({
      name: "analysis",
      aliases: ["data-analysis"],
    });

    expect(
      isMarketplaceSkillInstalledAsLocalSkill({
        marketplaceSkill,
        localSkill: createSkill({
          directory: "analysis-official",
          name: "数据分析",
        }),
      }),
    ).toBe(true);
    expect(
      isMarketplaceSkillInstalledAsLocalSkill({
        marketplaceSkill,
        localSkill: createSkill({
          directory: "data-analysis-official",
          name: "数据分析",
        }),
      }),
    ).toBe(true);
    expect(
      isMarketplaceSkillInstalledAsLocalSkill({
        marketplaceSkill,
        localSkill: createSkill({
          directory: "unrelated",
          name: "其他技能",
        }),
      }),
    ).toBe(false);
  });

  it("按市场标题、别名、分类、输出提示和服务能力说明过滤商店项", () => {
    const official = createMarketplaceSkill({
      aliases: ["insight"],
      title: "洞察生成器",
      category: "分析",
      outputHint: "趋势报告",
    });
    const serviceSkill = createServiceSkill({
      id: "service-content-plan",
      title: "内容排期",
      summary: "规划内容发布时间",
      outputHint: "排期表",
      slotSchema: [
        {
          key: "account",
          label: "账号",
          type: "text",
          required: true,
          placeholder: "输入账号",
        },
      ],
    });
    const fallback = buildSkillStoreItems({
      officialMarketplaceSkills: [],
      workspaceServiceSkills: [serviceSkill],
    })[0];

    const visibleByAlias = getVisibleSkillStoreItems({
      skillStoreItems: [{ source: "official", skill: official }],
      searchQuery: "insight",
      serviceSkillPresentationCopy: serviceSkillCopy,
    });
    const visibleByCapability = getVisibleSkillStoreItems({
      skillStoreItems: fallback ? [fallback] : [],
      searchQuery: "账号",
      serviceSkillPresentationCopy: serviceSkillCopy,
    });

    expect(visibleByAlias).toHaveLength(1);
    expect(visibleByCapability).toHaveLength(1);
  });

  it("按来源区分内置与用户可管理已安装 Skill", () => {
    const builtin = createSkill({
      directory: "builtin",
      sourceKind: "builtin",
      name: "内置研究",
    });
    const userInstalled = createSkill({
      directory: "user",
      sourceKind: "other",
      name: "用户写作",
    });
    const projectInstalled = createSkill({
      directory: "project",
      sourceKind: "other",
      catalogSource: "project",
      name: "项目写作",
    });
    const remoteInstalled = createSkill({
      directory: "remote",
      sourceKind: "other",
      catalogSource: "remote",
      name: "远端候选",
    });
    const legacyRemoteInstalled = createSkill({
      directory: "legacy-remote",
      sourceKind: "other",
      catalogSource: undefined,
      repoOwner: "anthropics",
      repoName: "skills",
      name: "旧远端候选",
    });

    expect(
      getVisibleBuiltinLocalSkills({
        localSkills: [builtin, userInstalled],
        searchQuery: "研究",
      }).map((skill) => skill.directory),
    ).toEqual(["builtin"]);
    expect(
      getVisibleUserInstalledSkills([
        builtin,
        userInstalled,
        projectInstalled,
        remoteInstalled,
        legacyRemoteInstalled,
      ]).map((skill) => skill.directory),
    ).toEqual(["user"]);
  });
});
