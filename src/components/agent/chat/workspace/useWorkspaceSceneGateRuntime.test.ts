import { beforeEach, describe, expect, it } from "vitest";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import type { CreationReplayMetadata } from "../utils/creationReplayMetadata";
import { recordSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import type { RuntimeSceneGateRequest } from "./sceneSkillGate";
import { resolveSceneGatePrefill } from "./useWorkspaceSceneGateRuntime";

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
    readinessRequirements: {
      requiresBrowser: true,
      requiresProject: true,
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
    sceneBinding: {
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      title: "X文章转存",
      summary: "把 X 长文导出成 Markdown。",
      aliases: ["x文章转存", "x转存"],
    },
  };
}

function createXArticleSceneGateRequest(): RuntimeSceneGateRequest {
  return {
    kind: "require_inputs",
    gateKey: "x-article-export:slot:article_url|project:project_id",
    rawText: "/x文章转存",
    sceneKey: "x-article-export",
    commandPrefix: "/x文章转存",
    sceneTitle: "X文章转存",
    sceneSummary: "把 X 长文导出成 Markdown。",
    skillId: "x-article-export",
    fields: [
      {
        kind: "slot",
        key: "article_url",
        label: "X 文章链接",
        slotType: "url",
        required: true,
        placeholder: "https://x.com/<账号>/article/<文章ID>",
      },
      {
        kind: "project",
        key: "project_id",
        label: "项目工作区",
        required: true,
        description: "选择这次结果要落到哪个项目里。",
      },
    ],
  };
}

describe("resolveSceneGatePrefill", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("应优先把最近一次成功 scene 输入补进 gate 预填", () => {
    recordSlashEntryUsage({
      kind: "scene",
      entryId: "x-article-export",
      replayText: "https://x.com/a/article/99",
    });

    const prefill = resolveSceneGatePrefill({
      request: createXArticleSceneGateRequest(),
      serviceSkills: [createXArticleExportSkill()],
      projectId: "project-1",
    });

    expect(prefill).toEqual({
      slotValues: {
        article_url: "https://x.com/a/article/99",
      },
      projectId: "project-1",
      hint: "已根据你上次成功执行 /x文章转存 时的输入自动预填，可继续修改后执行。",
    });
  });

  it("当前 creation replay 命中时，应覆盖最近 scene 的历史参数", () => {
    recordSlashEntryUsage({
      kind: "scene",
      entryId: "x-article-export",
      replayText: "https://x.com/a/article/99",
    });

    const creationReplay: CreationReplayMetadata = {
      version: 1,
      kind: "memory_entry",
      source: {
        page: "memory",
        project_id: "project-2",
        entry_id: "memory-x-article",
      },
      data: {
        category: "experience",
        title: "X 长文收藏",
        summary: "https://x.com/a/article/88",
      },
    };

    const prefill = resolveSceneGatePrefill({
      request: createXArticleSceneGateRequest(),
      serviceSkills: [createXArticleExportSkill()],
      creationReplay,
    });

    expect(prefill).toEqual({
      slotValues: {
        article_url: "https://x.com/a/article/88",
      },
      projectId: "project-2",
      hint: "已根据当前灵感条目自动预填 X 文章链接，可继续修改后执行。",
    });
  });
});
