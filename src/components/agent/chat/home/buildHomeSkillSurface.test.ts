import { describe, expect, it } from "vitest";
import type { Skill } from "@/lib/api/skills";
import type {
  SkillCatalogEntry,
  SkillCatalogSceneEntry,
} from "@/lib/api/skillCatalog";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { CuratedTaskTemplateItem } from "../utils/curatedTaskTemplates";
import {
  buildHomeGalleryItems,
  buildHomeGuideCards,
  buildHomeInputSuggestions,
  buildHomeSkillItems,
  buildHomeSkillSections,
  buildHomeStarterChips,
} from "./buildHomeSkillSurface";

function createCuratedTask(
  id: string,
  title: string,
  recentUsedAt: number | null = null,
): CuratedTaskTemplateItem {
  return {
    id,
    title,
    summary: `${title} 摘要`,
    outputHint: "输出",
    resultDestination: "当前内容",
    categoryLabel: "社交媒体",
    prompt: "prompt",
    requiredInputs: [],
    requiredInputFields: [],
    optionalReferences: [],
    outputContract: [],
    followUpActions: [],
    badge: recentUsedAt ? "最近使用" : "推荐",
    actionLabel: "进入生成",
    statusLabel: "可直接开始",
    statusTone: "emerald",
    recentUsedAt,
    isRecent: typeof recentUsedAt === "number",
  };
}

function createServiceSkill(): ServiceSkillHomeItem {
  return {
    id: "project-insight-flow",
    title: "项目线索整理",
    summary: "围绕当前项目整理线索。",
    category: "研究与方案",
    outputHint: "线索清单",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "立即开始",
    runnerTone: "emerald",
    runnerDescription: "围绕当前项目继续整理线索。",
    actionLabel: "继续整理",
    automationStatus: null,
    slotSchema: [],
    sceneBinding: {
      sceneKey: "project-insight-flow",
      commandPrefix: "/project-insight-flow",
      title: "项目线索整理",
      summary: "围绕当前项目整理线索。",
    },
  };
}

describe("buildHomeSkillSurface", () => {
  it("服务端未下发首页展示时使用 Ribbi 式本地兜底入口", () => {
    const labels = buildHomeStarterChips().map((chip) => chip.label);

    expect(labels).toEqual([
      "引导帮助",
      "写作",
      "添加资料",
      "PPT",
      "调研报告",
      "需求分析",
      "视频",
      "设计",
      "Excel",
      "编程",
      "更多做法",
      "⚙",
    ]);
  });

  it("优先使用服务端下发的首页展示入口、Tab 建议与帮助卡", () => {
    const entries: SkillCatalogEntry[] = [
      {
        id: "home:starter:poster",
        kind: "command",
        title: "做海报",
        summary: "把主题变成海报方向。",
        commandKey: "home_poster",
        surfaceScopes: ["home"],
        triggers: [],
        homePresentation: {
          slot: "starter_chip",
          label: "做海报",
          order: 20,
          prompt: "请帮我做一张海报。",
        },
      },
      {
        id: "home:input-suggestion:email",
        kind: "command",
        title: "帮我写一封工作邮件",
        summary: "Tab 起手建议。",
        commandKey: "home_input_email",
        surfaceScopes: ["home"],
        triggers: [],
        homePresentation: {
          slot: "input_suggestion",
          label: "帮我写一封工作邮件",
          order: 10,
          prompt: "请帮我写一封工作邮件。",
        },
      },
      {
        id: "home:guide:voice",
        kind: "command",
        title: "语音输入怎么设置？",
        summary: "了解语音输入。",
        commandKey: "home_guide_voice",
        surfaceScopes: ["home"],
        triggers: [],
        homePresentation: {
          slot: "guide_card",
          title: "语音输入怎么设置？",
          summary: "把灵感直接说进生成容器。",
          order: 10,
          groupKey: "guide_help",
          prompt: "请告诉我语音输入怎么设置。",
        },
      },
    ];

    expect(buildHomeStarterChips(entries).map((chip) => chip.label)).toEqual([
      "做海报",
      "更多做法",
      "⚙",
    ]);
    expect(buildHomeStarterChips(entries)[0]).toMatchObject({
      launchKind: "prefill_prompt",
      prompt: "请帮我做一张海报。",
    });
    expect(buildHomeInputSuggestions(entries)).toEqual([
      expect.objectContaining({
        label: "帮我写一封工作邮件",
        prompt: "请帮我写一封工作邮件。",
      }),
    ]);
    expect(buildHomeGuideCards(entries)).toEqual([
      expect.objectContaining({
        title: "语音输入怎么设置？",
        prompt: "请告诉我语音输入怎么设置。",
      }),
    ]);
  });

  it("把多来源条目归一成首页模型，并按最近使用优先排序", () => {
    const installedSkill: Skill = {
      key: "content-playbook",
      name: "内容主稿方法",
      description: "本地补充技能",
      directory: "content-playbook",
      installed: true,
      sourceKind: "other",
    };
    const catalogScene: SkillCatalogSceneEntry = {
      id: "custom_scene:daily-review",
      kind: "scene",
      title: "每日复盘",
      summary: "把趋势技能变成复盘入口。",
      sceneKey: "daily-review",
      commandPrefix: "/daily-review",
      linkedSkillId: "project-insight-flow",
      surfaceScopes: ["home"],
      placeholder: "今天想复盘哪个账号？",
      templates: [
        {
          id: "default",
          title: "开始复盘",
          prompt: "请帮我复盘今天的小红书账号表现。",
        },
      ],
    };

    const items = buildHomeSkillItems({
      curatedTasks: [
        createCuratedTask("daily-trend-briefing", "每日趋势摘要"),
        createCuratedTask("social-post-starter", "内容主稿生成", 10),
      ],
      serviceSkills: [createServiceSkill()],
      installedSkills: [installedSkill],
      catalogSceneEntries: [catalogScene],
      slashEntryUsage: [
        {
          kind: "skill",
          entryId: "content-playbook",
          usedAt: 30,
          replayText: "继续优化内容主稿",
        },
        {
          kind: "scene",
          entryId: "project-insight-flow",
          usedAt: 20,
          replayText: "继续整理项目线索",
        },
        {
          kind: "scene",
          entryId: "custom_scene:daily-review",
          usedAt: 40,
          replayText: "继续复盘账号",
        },
      ],
    });

    expect(items.slice(0, 4).map((item) => item.id)).toEqual([
      "custom_scene:daily-review",
      "content-playbook",
      "project-insight-flow",
      "social-post-starter",
    ]);
    expect(items[0]).toMatchObject({
      launchKind: "skill_catalog_scene",
      linkedSkillId: "project-insight-flow",
      launchPrompt: "请帮我复盘今天的小红书账号表现。",
    });
    expect(items[1]).toMatchObject({
      launchKind: "installed_skill",
      summary: "继续优化内容主稿",
    });
    expect(items[2]).toMatchObject({
      launchKind: "service_skill",
      summary: "继续整理项目线索",
    });
  });

  it("按分类生成 drawer 分组，并为 gallery 截取最多 12 个任务", () => {
    const items = buildHomeSkillItems({
      curatedTasks: [
        createCuratedTask("daily-trend-briefing", "每日趋势摘要", 10),
        createCuratedTask("script-to-voiceover", "脚本转口播"),
      ],
    });

    const sections = buildHomeSkillSections(items);
    const gallery = buildHomeGalleryItems(items);

    expect(sections[0]).toMatchObject({
      id: "recent",
      title: "最近使用",
    });
    expect(sections.some((section) => section.id === "video")).toBe(true);
    expect(gallery).toHaveLength(2);
  });
});
