import { describe, expect, it } from "vitest";
import {
  buildServiceSkillRecommendationBuckets,
  listPrimaryRecommendedServiceSkills,
} from "./recommendedServiceSkills";
import type { ServiceSkillHomeItem } from "./types";

function createServiceSkill(
  overrides: Partial<ServiceSkillHomeItem> = {},
): ServiceSkillHomeItem {
  return {
    id: "daily-trend-briefing",
    title: "每日趋势摘要",
    summary: "围绕指定平台与关键词输出趋势摘要。",
    entryHint: "把平台和关键词给我，我先整理一份趋势报告。",
    aliases: ["趋势报告"],
    category: "内容运营",
    outputHint: "趋势摘要 + 调度建议",
    source: "cloud_catalog",
    runnerType: "scheduled",
    defaultExecutorBinding: "automation_job",
    executionLocation: "client_default",
    slotSchema: [],
    surfaceScopes: ["home", "mention", "workspace"],
    promptTemplateKey: "trend_briefing",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "本地计划任务",
    runnerTone: "sky",
    runnerDescription:
      "当前先进入工作区生成首版任务方案，后续再接本地自动化。",
    actionLabel: "先做方案",
    automationStatus: null,
    groupKey: "general",
    ...overrides,
  };
}

describe("recommendedServiceSkills", () => {
  it("应把最近使用、推荐技能和剩余技能拆成互不重复的同一事实源", () => {
    const recentOlder = createServiceSkill({
      id: "recent-older",
      title: "最近较早使用",
      recentUsedAt: 1_712_345_678_000,
      isRecent: true,
    });
    const regularA = createServiceSkill({
      id: "regular-a",
      title: "常规技能 A",
    });
    const recentNewer = createServiceSkill({
      id: "recent-newer",
      title: "最近刚使用",
      recentUsedAt: 1_812_345_678_000,
      isRecent: true,
    });
    const regularB = createServiceSkill({
      id: "regular-b",
      title: "常规技能 B",
    });

    const buckets = buildServiceSkillRecommendationBuckets(
      [recentOlder, regularA, recentNewer, regularB],
      {
        featuredLimit: 1,
        surface: "mention",
      },
    );

    expect(buckets.recentSkills.map((skill) => skill.id)).toEqual([
      "recent-newer",
      "recent-older",
    ]);
    expect(buckets.featuredSkills.map((skill) => skill.id)).toEqual([
      "regular-a",
    ]);
    expect(buckets.remainingSkills.map((skill) => skill.id)).toEqual([
      "regular-b",
    ]);
  });

  it("首页主推荐应复用同一排序，并按 surface 过滤不可见技能", () => {
    const hiddenHomeSkill = createServiceSkill({
      id: "mention-only",
      title: "仅提及技能",
      surfaceScopes: ["mention", "workspace"],
    });
    const recentSkill = createServiceSkill({
      id: "recent-home",
      title: "最近首页技能",
      recentUsedAt: 1_812_345_678_000,
      isRecent: true,
    });
    const regularSkill = createServiceSkill({
      id: "regular-home",
      title: "常规首页技能",
    });

    const recommendedSkills = listPrimaryRecommendedServiceSkills(
      [hiddenHomeSkill, regularSkill, recentSkill],
      {
        limit: 2,
        surface: "home",
      },
    );

    expect(recommendedSkills.map((skill) => skill.id)).toEqual([
      "recent-home",
      "regular-home",
    ]);
  });
});
