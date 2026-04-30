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

function buildLegacyCloudSceneCatalog() {
  const seeded = getSeededSkillCatalog();
  const generalSkill = seeded.items[0]!;

  return {
    version: "tenant-2026-04-21",
    tenantId: "tenant-demo",
    syncedAt: "2026-04-21T12:00:00.000Z",
    groups: [
      {
        key: "general",
        title: "通用技能",
        summary: "历史目录中的旧场景项。",
        sort: 90,
        itemCount: 1,
      },
    ],
    entries: [
      {
        id: "command:legacy-voice-runtime",
        kind: "command",
        title: "旧版配音入口",
        summary: "历史目录仍把配音命令写成 cloud_scene。",
        commandKey: "legacy_voice_runtime",
        triggers: [{ mode: "mention", prefix: "@旧配音" }],
        binding: {
          skillId: "legacy-cloud-scene-skill",
          executionKind: "cloud_scene",
        },
        renderContract: {
          resultKind: "tool_timeline",
          detailKind: "scene_detail",
          supportsStreaming: true,
          supportsTimeline: true,
        },
      },
      {
        id: "scene:legacy-cloud-scene-skill",
        kind: "scene",
        title: "旧版云场景",
        summary: "历史目录仍把 scene executionKind 写成 cloud_scene。",
        sceneKey: "legacy-cloud-scene-skill",
        commandPrefix: "/legacy-cloud-scene-skill",
        linkedSkillId: "legacy-cloud-scene-skill",
        executionKind: "cloud_scene",
        renderContract: {
          resultKind: "tool_timeline",
          detailKind: "scene_detail",
          supportsStreaming: true,
          supportsTimeline: true,
        },
      },
    ],
    items: [
      {
        ...generalSkill,
        id: "legacy-cloud-scene-skill",
        title: "旧版云场景技能",
        summary: "历史目录中的 cloud_scene 技能项。",
        defaultExecutorBinding: "cloud_scene",
        executionLocation: "cloud_required",
        groupKey: "general",
        execution: {
          kind: "cloud_scene",
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

  it("应支持从 Base Setup Package 编译 skill catalog 与显式 scene projection", () => {
    const catalog = saveSkillCatalog(buildBaseSetupPackage(), "bootstrap_sync");
    const sceneEntry = listSkillCatalogSceneEntries(catalog).find(
      (entry) => entry.sceneKey === "story-video-suite",
    );
    const commandEntry = listSkillCatalogCommandEntries(catalog).find(
      (entry) => entry.commandKey === "voice_runtime",
    );
    const skillEntry = catalog.items.find(
      (item) => item.id === "sceneapp-service",
    );

    expect(skillEntry).toEqual(
      expect.objectContaining({
        id: "sceneapp-service",
        groupKey: "scene-apps",
        execution: expect.objectContaining({
          kind: "agent_turn",
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
        executionKind: "agent_turn",
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
          executionKind: "agent_turn",
        },
      }),
    );
    expect(commandEntry?.summary).not.toBe(
      "把视频或旁白需求切到云端配音技能主链，优先提交服务型技能运行。",
    );
  });

  it("应解析服务端下发的首页展示协议并允许 home-only command 无触发词", () => {
    const seeded = getSeededSkillCatalog();
    const catalog = saveSkillCatalog(
      {
        ...seeded,
        version: "tenant-home-presentation",
        entries: [
          {
            id: "home:input-suggestion:email",
            kind: "command",
            title: "帮我写一封工作邮件",
            summary: "输入框 Tab 起手建议。",
            commandKey: "home_input_email",
            surfaceScopes: ["home"],
            homePresentation: {
              slot: "input_suggestion",
              label: "帮我写一封工作邮件",
              order: 10,
              prompt: "请帮我写一封工作邮件。",
            },
          },
        ],
      },
      "bootstrap_sync",
    );

    const entry = listSkillCatalogCommandEntries(catalog).find(
      (candidate) => candidate.commandKey === "home_input_email",
    );

    expect(entry).toEqual(
      expect.objectContaining({
        id: "home:input-suggestion:email",
        triggers: [],
        surfaceScopes: ["home"],
        homePresentation: expect.objectContaining({
          slot: "input_suggestion",
          label: "帮我写一封工作邮件",
          prompt: "请帮我写一封工作邮件。",
        }),
      }),
    );
  });

  it("读取旧版 raw skill catalog 时应把 cloud_scene 正规化为本地 agent_turn", async () => {
    saveSkillCatalog(buildLegacyCloudSceneCatalog(), "bootstrap_sync");

    const catalog = await getSkillCatalog();
    const skillItem = catalog.items.find(
      (item) => item.id === "legacy-cloud-scene-skill",
    );
    const autoSceneEntry = listSkillCatalogSceneEntries(catalog).find(
      (entry) => entry.id === "scene:legacy-cloud-scene-skill",
    );
    const commandEntry = listSkillCatalogCommandEntries(catalog).find(
      (entry) => entry.commandKey === "legacy_voice_runtime",
    );

    expect(skillItem).toEqual(
      expect.objectContaining({
        defaultExecutorBinding: "agent_turn",
        executionLocation: "client_default",
        execution: expect.objectContaining({
          kind: "agent_turn",
        }),
      }),
    );
    expect(autoSceneEntry).toEqual(
      expect.objectContaining({
        linkedSkillId: "legacy-cloud-scene-skill",
        executionKind: "agent_turn",
      }),
    );
    expect(commandEntry).toEqual(
      expect.objectContaining({
        binding: expect.objectContaining({
          skillId: "legacy-cloud-scene-skill",
          executionKind: "agent_turn",
        }),
      }),
    );

    const stored = window.localStorage.getItem("lime:skill-catalog:v1");
    expect(stored).toContain('"defaultExecutorBinding":"agent_turn"');
    expect(stored).toContain('"executionLocation":"client_default"');
    expect(stored).not.toContain('"defaultExecutorBinding":"cloud_scene"');
    expect(stored).not.toContain('"executionLocation":"cloud_required"');
    expect(stored).toContain('"executionKind":"agent_turn"');
    expect(stored).not.toContain('"executionKind":"cloud_scene"');
    expect(stored).not.toContain('"kind":"cloud_scene"');
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
    const webpageEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "webpage_generate",
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
    const writingEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "writing_runtime",
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
    const logoDecompositionEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "logo_decomposition",
    );
    const fileReadEntry = listSkillCatalogCommandEntries(seeded).find(
      (entry) => entry.commandKey === "file_read_runtime",
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
        "file_read_runtime",
        "summary",
        "translation",
        "analysis",
        "logo_decomposition",
        "transcription_generate",
        "web_scrape",
        "webpage_read",
        "url_parse",
        "typesetting",
        "form_generate",
        "browser_runtime",
        "voice_runtime",
        "growth_runtime",
        "writing_runtime",
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
    expect(browserEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@Browser Agent" }),
        expect.objectContaining({ prefix: "@Mini Tester" }),
        expect.objectContaining({ prefix: "@Web Scheduler" }),
        expect.objectContaining({ prefix: "@Web Manage" }),
      ]),
    );
    expect(webScrapeEntry?.binding).toMatchObject({
      skillId: "url_parse",
      executionKind: "task_queue",
    });
    expect(webScrapeEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@抓取" }),
        expect.objectContaining({ prefix: "@Fetch" }),
      ]),
    );
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
    expect(writingEntry?.binding).toMatchObject({
      skillId: "content_post_with_cover",
      executionKind: "native_skill",
    });
    expect(writingEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@Web Copy" }),
      ]),
    );
    expect(webpageEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@Web Composer" }),
        expect.objectContaining({ prefix: "@HTML Preview" }),
        expect.objectContaining({ prefix: "@Web Style" }),
      ]),
    );
    expect(fileReadEntry?.binding).toMatchObject({
      skillId: "summary",
      executionKind: "agent_turn",
    });
    expect(
      listSkillCatalogCommandEntries(seeded).find(
        (entry) => entry.commandKey === "research",
      )?.triggers,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@Search Agent" }),
        expect.objectContaining({ prefix: "@Instagram Research" }),
      ]),
    );
    expect(fileReadEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@读文件" }),
        expect.objectContaining({ prefix: "@Read File Content" }),
      ]),
    );
    expect(uploadEntry?.binding).toMatchObject({
      skillId: "content_post_with_cover",
      executionKind: "native_skill",
    });
    expect(complianceEntry?.binding).toMatchObject({
      skillId: "analysis",
      executionKind: "agent_turn",
    });
    expect(logoDecompositionEntry?.binding).toMatchObject({
      skillId: "analysis",
      executionKind: "agent_turn",
    });
    expect(logoDecompositionEntry?.triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ prefix: "@Logo拆解" }),
        expect.objectContaining({ prefix: "@Image Logo Decomposition" }),
      ]),
    );
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
          linkedEntryId: "skill:tenant-daily-briefing",
          placeholder: "输入新品链接或发布主题",
          templates: [
            {
              id: "default",
              title: "发布启动",
              description: "从一个主题启动发布链路",
              prompt: "请帮我规划新品发布内容。",
            },
          ],
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
    expect(
      listSkillCatalogSceneEntries(catalog).find(
        (entry) => entry.sceneKey === "campaign-launch",
      ),
    ).toMatchObject({
      linkedEntryId: "skill:tenant-daily-briefing",
      placeholder: "输入新品链接或发布主题",
      templates: [
        {
          id: "default",
          title: "发布启动",
          description: "从一个主题启动发布链路",
          prompt: "请帮我规划新品发布内容。",
        },
      ],
    });
  });
});
