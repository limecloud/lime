import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  getSkillCatalog,
  saveSkillCatalog,
  type SkillCatalog,
} from "./skillCatalog";

function buildLegacyCatalogWithSiteEntries(): SkillCatalog {
  const seeded = getSeededSkillCatalog();
  const generalSkill = seeded.items[0]!;

  return {
    version: "tenant-2026-03-30",
    tenantId: "tenant-demo",
    syncedAt: "2026-03-30T12:00:00.000Z",
    groups: [
      {
        key: "github",
        title: "GitHub",
        summary: "围绕仓库与 Issue 的只读研究技能。",
        sort: 10,
        itemCount: 1,
      },
      {
        key: "general",
        title: "通用技能",
        summary: "不依赖站点登录态的业务技能。",
        sort: 90,
        itemCount: 1,
      },
    ],
    items: [
      {
        ...generalSkill,
        id: "legacy-site-skill",
        title: "旧版 GitHub 站点技能",
        skillType: "site",
        defaultExecutorBinding: "browser_assist",
        siteCapabilityBinding: {
          adapterName: "github/search",
          autoRun: true,
          requireAttachedSession: true,
          saveMode: "current_content",
          slotArgMap: {
            reference_topic: "query",
          },
        },
        groupKey: "github",
        execution: {
          kind: "site_adapter",
          siteAdapterBinding: {
            adapterName: "github/search",
            autoRun: true,
            requireAttachedSession: true,
            saveMode: "current_content",
            slotArgMap: {
              reference_topic: "query",
            },
          },
        },
      },
      {
        ...generalSkill,
        id: "tenant-daily-briefing",
        title: "租户日报摘要",
        summary: "远端同步后的目录项",
        groupKey: "general",
        execution: {
          kind: "agent_turn",
        },
      },
    ],
  };
}

describe("skillCatalog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    clearSkillCatalogCache();
  });

  it("seeded 目录不应再暴露站点 adapter 或 browser assist 首页入口", async () => {
    const catalog = await getSkillCatalog();

    expect(catalog.groups.map((group) => group.key)).toEqual(["general"]);
    expect(
      catalog.items.some((item) => item.execution.kind === "site_adapter"),
    ).toBe(false);
    expect(
      catalog.items.some(
        (item) =>
          item.defaultExecutorBinding === "browser_assist" ||
          Boolean(item.siteCapabilityBinding),
      ),
    ).toBe(false);
  });

  it("读取旧版远端目录时应过滤 site_adapter 和 browser assist 项", async () => {
    saveSkillCatalog(buildLegacyCatalogWithSiteEntries(), "bootstrap_sync");

    const catalog = await getSkillCatalog();

    expect(catalog.items.map((item) => item.id)).toEqual([
      "tenant-daily-briefing",
    ]);
    expect(catalog.groups.map((group) => group.key)).toEqual(["general"]);

    const stored = window.localStorage.getItem("lime:skill-catalog:v1");
    expect(stored).not.toContain("legacy-site-skill");
  });
});
