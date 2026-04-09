import { beforeEach, describe, expect, it } from "vitest";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import type { CreationReplayMetadata } from "../utils/creationReplayMetadata";
import { resolveServiceSkillLaunchPrefill } from "./serviceSkillLaunchPrefill";
import { recordServiceSkillUsage } from "./storage";
import type { ServiceSkillHomeItem } from "./types";

function createResearchSkill(): ServiceSkillHomeItem {
  return {
    id: "service-skill-1",
    skillKey: "service-skill-1",
    title: "深度研究",
    summary: "综合多来源信息并给出归纳后的结论。",
    category: "调研",
    outputHint: "研究摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    slotSchema: [
      {
        key: "article_source",
        label: "文章链接/正文",
        type: "textarea",
        required: false,
        placeholder: "输入文章链接、正文，或文章摘要",
      },
      {
        key: "target_duration",
        label: "目标时长",
        type: "text",
        required: false,
        defaultValue: "60-90 秒",
        placeholder: "例如 60-90 秒",
      },
    ],
    version: "2026-03-29",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "立即开始",
    runnerTone: "emerald",
    runnerDescription: "会直接在当前工作区生成首版结果。",
    actionLabel: "对话内补参",
    automationStatus: null,
    cloudStatus: null,
    groupKey: "general",
  };
}

function createXArticleExportSkill(): ServiceSkillHomeItem {
  return {
    id: "x-article-export",
    skillKey: "x-article-export",
    title: "X 文章转存",
    summary: "复用 X 登录态把长文导出成 Markdown 和图片目录。",
    category: "站点采集",
    outputHint: "Markdown 正文 + 图片目录",
    source: "local_custom",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "本地技能",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
    slotSchema: [
      {
        key: "article_url",
        label: "X 文章链接",
        type: "url",
        required: true,
        placeholder: "https://x.com/<账号>/article/<文章ID>",
      },
    ],
    sceneBinding: {
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      title: "X文章转存",
      summary: "把 X 长文导出成 Markdown。",
      aliases: ["x文章转存", "x转存"],
    },
    siteCapabilityBinding: {
      adapterName: "x/article-export",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "project_resource",
      slotArgMap: {
        article_url: "url",
      },
    },
  };
}

describe("resolveServiceSkillLaunchPrefill", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("应优先复用最近一次成功执行该技能时的参数", () => {
    recordServiceSkillUsage({
      skillId: "service-skill-1",
      runnerType: "instant",
      slotValues: {
        article_source: "  上次沉淀的文章摘要  ",
        target_duration: "120 秒",
        ignored_empty: "   ",
      },
    });

    expect(
      resolveServiceSkillLaunchPrefill({
        skill: createResearchSkill(),
      }),
    ).toEqual({
      slotValues: {
        article_source: "上次沉淀的文章摘要",
        target_duration: "120 秒",
      },
      hint: "已根据你上次成功执行 深度研究 时的参数自动预填，可继续修改后执行。",
    });
  });

  it("creation replay 命中时应覆盖最近成功参数", () => {
    recordServiceSkillUsage({
      skillId: "service-skill-1",
      runnerType: "instant",
      slotValues: {
        article_source: "旧摘要",
        target_duration: "180 秒",
      },
    });
    const creationReplay: CreationReplayMetadata = {
      version: 1,
      kind: "skill_scaffold",
      source: {
        page: "skills",
        project_id: "project-1",
      },
      data: {
        name: "AI Agent 行业拆解",
        description: "参考原文做一版 90 秒总结，结论更聚焦团队协作。",
        source_excerpt: "参考 https://example.com/report 并保留关键结论。",
      },
    };

    expect(
      resolveServiceSkillLaunchPrefill({
        skill: createResearchSkill(),
        creationReplay,
      }),
    ).toEqual({
      slotValues: {
        article_source:
          "参考线索：参考 https://example.com/report 并保留关键结论。\n改写目标：参考原文做一版 90 秒总结，结论更聚焦团队协作。\n来源标题：AI Agent 行业拆解",
        target_duration: "90 秒",
      },
      hint: "已根据当前技能草稿自动预填 文章链接/正文、目标时长，可继续修改后执行。",
    });
  });

  it("没有最近技能参数时，应回退到最近一次成功 scene 输入", () => {
    recordSlashEntryUsage({
      kind: "scene",
      entryId: "x-article-export",
      replayText: "https://x.com/a/article/99",
    });

    expect(
      resolveServiceSkillLaunchPrefill({
        skill: createXArticleExportSkill(),
      }),
    ).toEqual({
      slotValues: {
        article_url: "https://x.com/a/article/99",
      },
      hint: "已根据你上次成功执行 /x文章转存 时的输入自动预填，可继续修改后执行。",
    });
  });
});
