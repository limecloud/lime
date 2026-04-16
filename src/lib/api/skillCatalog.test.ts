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

function buildBaseSetupPackage() {
  return {
    id: "sceneapp-base-setup",
    version: "tenant-2026-04-15",
    title: "SceneApp Base Setup",
    summary: "通过基础设置包定义多模态场景入口",
    bundle_refs: [
      {
        id: "sceneapp-bundle",
        source: "remote",
        path_or_uri: "lime://bundles/sceneapp",
        kind: "skill_bundle",
      },
    ],
    catalog_projections: [
      {
        id: "sceneapp-service",
        target_catalog: "service_skill_catalog",
        entry_key: "sceneapp-service",
        skill_key: "story-video-suite",
        title: "短视频编排",
        summary: "把文本、线框图、配乐和短视频串起来。",
        category: "Scene Apps",
        output_hint: "结果包",
        bundle_ref_id: "sceneapp-bundle",
        slot_profile_ref: "sceneapp-slot-profile",
        binding_profile_ref: "sceneapp-binding-profile",
        artifact_profile_ref: "sceneapp-artifact-profile",
        scorecard_profile_ref: "sceneapp-scorecard-profile",
        policy_profile_ref: "sceneapp-policy-profile",
        scene_binding: {
          scene_key: "story-video-suite",
          command_prefix: "/legacy-story-video",
          title: "旧版自动场景标题",
          summary: "旧版自动场景摘要",
          aliases: ["story-video-auto"],
        },
      },
      {
        id: "sceneapp-scene",
        target_catalog: "scene_catalog",
        entry_key: "sceneapp-service",
        skill_key: "story-video-suite",
        title: "短视频编排显式场景",
        summary: "用显式 projection 覆盖 auto scene。",
        category: "Scene Apps",
        output_hint: "结果包",
        bundle_ref_id: "sceneapp-bundle",
        slot_profile_ref: "sceneapp-slot-profile",
        binding_profile_ref: "sceneapp-binding-profile",
        artifact_profile_ref: "sceneapp-artifact-profile",
        scorecard_profile_ref: "sceneapp-scorecard-profile",
        policy_profile_ref: "sceneapp-policy-profile",
        scene_binding: {
          scene_key: "story-video-suite",
          command_prefix: "/story-video-suite",
          title: "短视频编排",
          summary: "把文本生成线框图、配乐、剧本和短视频串成一条场景链。",
          aliases: ["story-video", "mv-pipeline"],
        },
      },
      {
        id: "sceneapp-command",
        target_catalog: "command_catalog",
        entry_key: "sceneapp-service",
        skill_key: "voice_runtime",
        title: "短视频配音入口",
        summary: "用显式 command projection 覆盖 seeded voice_runtime。",
        category: "Scene Apps",
        output_hint: "结果包",
        bundle_ref_id: "sceneapp-bundle",
        slot_profile_ref: "sceneapp-slot-profile",
        binding_profile_ref: "sceneapp-binding-profile",
        artifact_profile_ref: "sceneapp-artifact-profile",
        scorecard_profile_ref: "sceneapp-scorecard-profile",
        policy_profile_ref: "sceneapp-policy-profile",
        aliases: ["短视频配音", "story-voice"],
        trigger_hints: ["@配音", "/voice-runtime"],
      },
    ],
    slot_profiles: [
      {
        id: "sceneapp-slot-profile",
        slots: [
          {
            key: "topic",
            label: "主题",
            type: "text",
            required: true,
            placeholder: "输入主题",
          },
        ],
      },
    ],
    binding_profiles: [
      {
        id: "sceneapp-binding-profile",
        binding_family: "cloud_scene",
      },
    ],
    artifact_profiles: [
      {
        id: "sceneapp-artifact-profile",
        delivery_contract: "artifact_bundle",
        required_parts: ["index.md"],
        viewer_kind: "artifact_bundle",
      },
    ],
    scorecard_profiles: [
      {
        id: "sceneapp-scorecard-profile",
        metrics: ["success_rate"],
      },
    ],
    policy_profiles: [
      {
        id: "sceneapp-policy-profile",
        surface_scopes: ["mention", "workspace"],
      },
    ],
    compatibility: {
      min_app_version: "1.11.0",
      required_kernel_capabilities: ["cloud_scene"],
      seeded_fallback: true,
    },
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

  it("应支持从 Base Setup Package 编译 skill catalog 与显式 scene projection", () => {
    const catalog = saveSkillCatalog(buildBaseSetupPackage(), "bootstrap_sync");
    const sceneEntry = listSkillCatalogSceneEntries(catalog).find(
      (entry) => entry.sceneKey === "story-video-suite",
    );
    const commandEntry = listSkillCatalogCommandEntries(catalog).find(
      (entry) => entry.commandKey === "voice_runtime",
    );
    const skillEntry = catalog.items.find((item) => item.id === "sceneapp-service");

    expect(skillEntry).toEqual(
      expect.objectContaining({
        id: "sceneapp-service",
        groupKey: "scene-apps",
        execution: expect.objectContaining({
          kind: "cloud_scene",
        }),
      }),
    );
    expect(sceneEntry).toEqual(
      expect.objectContaining({
        title: "短视频编排",
        commandPrefix: "/story-video-suite",
        summary: "把文本生成线框图、配乐、剧本和短视频串成一条场景链。",
        aliases: ["story-video", "mv-pipeline"],
        linkedSkillId: "sceneapp-service",
        executionKind: "cloud_scene",
        surfaceScopes: ["mention", "workspace"],
      }),
    );
    expect(sceneEntry?.title).not.toBe("旧版自动场景标题");
    expect(sceneEntry?.commandPrefix).not.toBe("/legacy-story-video");
    expect(commandEntry).toEqual(
      expect.objectContaining({
        id: "command:voice_runtime",
        title: "短视频配音入口",
        summary: "用显式 command projection 覆盖 seeded voice_runtime。",
        aliases: ["短视频配音", "story-voice"],
        surfaceScopes: ["mention", "workspace"],
        triggers: [
          { mode: "mention", prefix: "@配音" },
          { mode: "slash", prefix: "/voice-runtime" },
        ],
        binding: {
          skillId: "sceneapp-service",
          executionKind: "cloud_scene",
        },
      }),
    );
    expect(commandEntry?.summary).not.toBe(
      "把视频或旁白需求切到云端配音技能主链，优先提交服务型技能运行。",
    );
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
