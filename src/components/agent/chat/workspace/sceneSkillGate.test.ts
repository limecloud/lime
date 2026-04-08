import { describe, expect, it } from "vitest";
import type { Project } from "@/lib/api/project";
import type { ServiceSkillHomeItem } from "../service-skills/types";
import {
  buildRuntimeSceneGateA2UIForm,
  buildRuntimeSceneGateRequest,
  formatRuntimeSceneGateValidationMessage,
  readRuntimeSceneGateSubmission,
} from "./sceneSkillGate";

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
        helpText: "支持 x.com 和 twitter.com 的 Article 链接。",
      },
      {
        key: "target_language",
        label: "目标语言",
        type: "text",
        required: false,
        defaultValue: "中文",
        placeholder: "例如 中文、英文、日文",
        helpText: "仅翻译正文，代码块、链接和图片路径保持原样。",
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
        target_language: "target_language",
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

function createProject(id: string, name: string): Project {
  return {
    id,
    name,
    workspaceType: "general",
    rootPath: `/tmp/${name}`,
    isDefault: false,
    createdAt: 1,
    updatedAt: 1,
    isFavorite: false,
    isArchived: false,
    tags: [],
  };
}

describe("sceneSkillGate", () => {
  it("应把缺失 slot 和项目要求组合为统一 gate request", () => {
    const skill = createXArticleExportSkill();
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: "/x文章转存",
      sceneEntry: {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        linkedSkillId: "x-article-export",
      },
      skill,
      missingSlots: skill.slotSchema.filter((slot) => slot.required),
      requireProject: true,
    });

    expect(gateRequest).toMatchObject({
      sceneKey: "x-article-export",
      commandPrefix: "/x文章转存",
      skillId: "x-article-export",
      fields: [
        {
          kind: "slot",
          key: "article_url",
          label: "X 文章链接",
        },
        {
          kind: "project",
          key: "project_id",
          label: "项目工作区",
        },
      ],
    });
    expect(formatRuntimeSceneGateValidationMessage(gateRequest!)).toBe(
      "还差X 文章链接和项目工作区，补齐后再继续。",
    );
  });

  it("应把 gate request 映射为 A2UI 表单", () => {
    const skill = createXArticleExportSkill();
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: "/x文章转存",
      sceneEntry: {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        linkedSkillId: "x-article-export",
      },
      skill,
      missingSlots: skill.slotSchema.filter((slot) => slot.required),
      requireProject: true,
    });

    const form = buildRuntimeSceneGateA2UIForm({
      request: gateRequest!,
      projects: [
        createProject("project-1", "品牌项目"),
        createProject("project-2", "增长项目"),
      ],
    });

    expect(form.id).toContain("scene-gate:");
    expect(form.submitAction?.label).toBe("继续");
    expect(form.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "article_url",
          component: "TextField",
          label: "X 文章链接",
        }),
        expect.objectContaining({
          id: "project_id",
          component: "ChoicePicker",
          label: "项目工作区",
          options: expect.arrayContaining([
            expect.objectContaining({
              value: "project-1",
              label: "品牌项目",
            }),
          ]),
        }),
      ]),
    );
  });

  it("应把预填值与提示一起映射到 scene gate A2UI 表单", () => {
    const skill = createXArticleExportSkill();
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: "/x文章转存",
      sceneEntry: {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        linkedSkillId: "x-article-export",
      },
      skill,
      missingSlots: skill.slotSchema.filter((slot) => slot.required),
      requireProject: true,
    });

    const form = buildRuntimeSceneGateA2UIForm({
      request: gateRequest!,
      projects: [
        createProject("project-1", "品牌项目"),
        createProject("project-2", "增长项目"),
      ],
      prefill: {
        slotValues: {
          article_url: "https://x.com/a/article/99",
        },
        projectId: "project-2",
        hint: "已根据当前灵感条目自动预填 X 文章链接，可继续修改后执行。",
      },
    });

    expect(form.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "article_url",
          component: "TextField",
          value: "https://x.com/a/article/99",
        }),
        expect.objectContaining({
          id: "project_id",
          component: "ChoicePicker",
          value: ["project-2"],
        }),
        expect.objectContaining({
          id: `${gateRequest!.gateKey}:prefill-hint`,
          component: "Text",
          text: "已根据当前灵感条目自动预填 X 文章链接，可继续修改后执行。",
        }),
      ]),
    );
  });

  it("应从 A2UI 提交结果中恢复 slot 与项目值", () => {
    const skill = createXArticleExportSkill();
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: "/x文章转存",
      sceneEntry: {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        linkedSkillId: "x-article-export",
      },
      skill,
      missingSlots: skill.slotSchema.filter((slot) => slot.required),
      requireProject: true,
    });

    const submission = readRuntimeSceneGateSubmission({
      request: gateRequest!,
      formData: {
        article_url: "https://x.com/a/article/1",
        project_id: ["project-2"],
      },
    });

    expect(submission).toEqual({
      slotValues: {
        article_url: "https://x.com/a/article/1",
      },
      projectId: "project-2",
      missingFieldLabels: [],
    });
  });

  it("提交结果未显式带值时应回退到预填内容", () => {
    const skill = createXArticleExportSkill();
    const gateRequest = buildRuntimeSceneGateRequest({
      rawText: "/x文章转存",
      sceneEntry: {
        id: "scene:x-article-export",
        kind: "scene",
        title: "X文章转存",
        summary: "把 X 长文导出成 Markdown。",
        sceneKey: "x-article-export",
        commandPrefix: "/x文章转存",
        linkedSkillId: "x-article-export",
      },
      skill,
      missingSlots: skill.slotSchema.filter((slot) => slot.required),
      requireProject: true,
    });

    const submission = readRuntimeSceneGateSubmission({
      request: gateRequest!,
      formData: {},
      prefill: {
        slotValues: {
          article_url: "https://x.com/a/article/88",
        },
        projectId: "project-1",
      },
    });

    expect(submission).toEqual({
      slotValues: {
        article_url: "https://x.com/a/article/88",
      },
      projectId: "project-1",
      missingFieldLabels: [],
    });
  });
});
