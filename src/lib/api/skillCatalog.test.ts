import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSkillCatalogCache,
  getSeededSkillCatalog,
  getSkillCatalog,
  listSkillCatalogCommandEntries,
  listSkillCatalogSceneEntries,
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
    entries: [],
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
    expect(catalog.groups.find((group) => group.key === "general")).toEqual(
      expect.objectContaining({
        title: "通用技能",
        summary:
          "保留现有写作、调研、趋势选题与增长跟踪能力，作为站点组之外的创作技能入口。",
      }),
    );
    expect(
      catalog.items.find((item) => item.id === "account-performance-tracking"),
    ).toEqual(
      expect.objectContaining({
        title: "账号增长跟踪",
      }),
    );
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

  it("应从统一目录中暴露 command 与 scene 扩展入口", async () => {
    const seeded = await getSkillCatalog();
    const formEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "form_generate",
    );
    const posterEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "poster_generate",
    );
    const browserEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "browser_runtime",
    );
    const webScrapeEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "web_scrape",
    );
    const webpageReadEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "webpage_read",
    );
    const competitorEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "competitor_research",
    );
    const codeEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "code_runtime",
    );
    const voiceEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "voice_runtime",
    );
    const channelPreviewEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "channel_preview_runtime",
    );
    const uploadEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "upload_runtime",
    );
    const complianceEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "publish_compliance",
    );
    const publishEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "publish_runtime",
    );

    expect(
      listSkillCatalogCommandEntries(seeded).map((entry) => entry.commandKey),
    ).toEqual(
      expect.arrayContaining([
        "image_generate",
        "cover_generate",
        "poster_generate",
        "video_generate",
        "broadcast_generate",
        "modal_resource_search",
        "research",
        "deep_search",
        "research_report",
        "competitor_research",
        "site_search",
        "read_pdf",
        "summary",
        "translation",
        "analysis",
        "transcription_generate",
        "web_scrape",
        "webpage_read",
        "url_parse",
        "typesetting",
        "form_generate",
        "browser_runtime",
        "voice_runtime",
        "channel_preview_runtime",
        "upload_runtime",
        "code_runtime",
        "publish_runtime",
        "publish_compliance",
      ]),
    );
    expect(formEntry?.renderContract).toMatchObject({
      resultKind: "form",
      detailKind: "json",
      supportsStreaming: true,
      supportsTimeline: true,
    });
    expect(posterEntry?.binding).toMatchObject({
      skillId: "image_generate",
      executionKind: "task_queue",
    });
    expect(browserEntry?.renderContract).toMatchObject({
      resultKind: "tool_timeline",
      detailKind: "json",
      supportsStreaming: true,
      supportsTimeline: true,
    });
    expect(webScrapeEntry?.binding).toMatchObject({
      skillId: "url_parse",
      executionKind: "task_queue",
    });
    expect(webpageReadEntry?.binding).toMatchObject({
      skillId: "url_parse",
      executionKind: "task_queue",
    });
    expect(competitorEntry?.binding).toMatchObject({
      skillId: "report_generate",
      executionKind: "agent_turn",
    });
    expect(codeEntry?.renderContract).toMatchObject({
      resultKind: "tool_timeline",
      detailKind: "json",
      supportsStreaming: true,
      supportsTimeline: true,
    });
    expect(voiceEntry?.renderContract).toMatchObject({
      resultKind: "tool_timeline",
      detailKind: "scene_detail",
      supportsStreaming: true,
      supportsTimeline: true,
    });
    expect(channelPreviewEntry?.binding).toMatchObject({
      skillId: "content_post_with_cover",
      executionKind: "native_skill",
    });
    expect(uploadEntry?.binding).toMatchObject({
      skillId: "content_post_with_cover",
      executionKind: "native_skill",
    });
    expect(complianceEntry?.binding).toMatchObject({
      skillId: "analysis",
      executionKind: "agent_turn",
    });
    expect(publishEntry?.renderContract).toMatchObject({
      resultKind: "artifact",
      detailKind: "artifact_detail",
      supportsStreaming: true,
      supportsTimeline: true,
    });

    const remoteCatalog: SkillCatalog = {
      ...buildLegacyCatalogWithSiteEntries(),
      entries: [
        {
          id: "scene:campaign-launch",
          kind: "scene",
          title: "新品发布场景",
          summary: "把链接解析、配图与封面串成一个可复用场景。",
          sceneKey: "campaign-launch",
          commandPrefix: "/campaign-launch",
          aliases: ["launch", "campaign"],
          executionKind: "scene",
          renderContract: {
            resultKind: "tool_timeline",
            detailKind: "scene_detail",
            supportsStreaming: true,
            supportsTimeline: true,
          },
        },
        {
          id: "scene:legacy-site-export",
          kind: "scene",
          title: "旧版站点导出",
          summary: "把站点技能包装成 slash scene。",
          sceneKey: "legacy-site-export",
          commandPrefix: "/legacy-site-export",
          linkedSkillId: "legacy-site-skill",
          executionKind: "site_adapter",
          renderContract: {
            resultKind: "tool_timeline",
            detailKind: "scene_detail",
            supportsStreaming: true,
            supportsTimeline: true,
          },
        },
      ],
    };

    saveSkillCatalog(remoteCatalog, "bootstrap_sync");
    const catalog = await getSkillCatalog();

    expect(
      listSkillCatalogSceneEntries(catalog).map((entry) => entry.sceneKey),
    ).toEqual(
      expect.arrayContaining([
        "campaign-launch",
        "legacy-site-export",
        "x-article-export",
      ]),
    );
  });
});
