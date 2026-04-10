import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import {
  buildServiceSkillClawLaunchContext,
  buildServiceSkillClawLaunchRequestMetadata,
  buildServiceSkillNaturalLaunchMessage,
  resolveServiceSkillSiteCapabilityExecution,
} from "./siteCapabilityBinding";

const mockSiteListAdapters = vi.hoisted(() => vi.fn());

vi.mock("@/lib/webview-api", () => ({
  siteListAdapters: (...args: unknown[]) => mockSiteListAdapters(...args),
}));

function createBrowserSkill(
  overrides: Partial<ServiceSkillItem> = {},
): ServiceSkillItem {
  return {
    id: "github-repo-radar",
    title: "GitHub 仓库线索检索",
    summary: "复用 GitHub 登录态检索项目。",
    category: "情报研究",
    outputHint: "仓库列表 + 关键线索",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    version: "seed-v1",
    slotSchema: [
      {
        key: "repository_query",
        label: "检索主题",
        type: "text",
        required: true,
        placeholder: "例如 AI Agent",
      },
    ],
    siteCapabilityBinding: {
      adapterName: "github/search",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "current_content",
      slotArgMap: {
        repository_query: "query",
      },
      fixedArgs: {
        limit: 10,
      },
    },
    ...overrides,
  };
}

describe("site capability binding natural launch message", () => {
  beforeEach(() => {
    mockSiteListAdapters.mockReset();
  });

  it("应把 GitHub 搜索技能渲染成可直接驱动站点适配器的一句话", () => {
    const message = buildServiceSkillNaturalLaunchMessage({
      skill: createBrowserSkill(),
      slotValues: {
        repository_query: "AI Agent",
      },
    });

    expect(message).toBe("你帮我在 GitHub 找一下和“AI Agent”相关的项目。");
    expect(message).not.toContain("[站点技能启动上下文]");
    expect(message).not.toContain("adapter_name");
  });

  it("应忽略无意义的继续类补充输入", () => {
    const message = buildServiceSkillNaturalLaunchMessage({
      skill: createBrowserSkill(),
      slotValues: {
        repository_query: "AI Agent",
      },
      userInput: "请结合当前上下文继续",
    });

    expect(message).toBe("你帮我在 GitHub 找一下和“AI Agent”相关的项目。");
  });

  it("应把真实补充要求追加成自然句", () => {
    const message = buildServiceSkillNaturalLaunchMessage({
      skill: createBrowserSkill(),
      slotValues: {
        repository_query: "AI Agent",
      },
      userInput: "只看最近一个月内更新过的项目",
    });

    expect(message).toBe(
      "你帮我在 GitHub 找一下和“AI Agent”相关的项目。只看最近一个月内更新过的项目。",
    );
  });

  it("X 文章转存在指定目标语言时应明确要求翻译正文并保留代码块与图片结构", () => {
    const message = buildServiceSkillNaturalLaunchMessage({
      skill: createBrowserSkill({
        id: "x-article-export",
        title: "X 文章转存",
        summary: "导出 X 长文并按目标语言翻译正文。",
        slotSchema: [
          {
            key: "article_url",
            label: "X 文章链接",
            type: "url",
            required: true,
            placeholder: "https://x.com/<账号>/article/<文章ID>",
          },
          {
            key: "target_language",
            label: "目标语言",
            type: "text",
            required: false,
            defaultValue: "中文",
            placeholder: "例如 中文、英文、日文",
          },
        ],
        siteCapabilityBinding: {
          autoRun: true,
          requireAttachedSession: true,
          saveMode: "project_resource",
          siteLabel: "X",
          adapterMatch: {
            urlArgName: "url",
            requiredCapabilities: ["article_export", "markdown_bundle"],
            hostAliases: ["twitter.com", "www.twitter.com"],
          },
          slotArgMap: {
            article_url: "url",
            target_language: "target_language",
          },
        },
      }),
      slotValues: {
        article_url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
        target_language: "中文",
      },
    });

    expect(message).toBe(
      "你帮我把这篇X文章导出为 Markdown，并将正文翻译成“中文”，保留代码块原文、图片链接和 Markdown 结构。",
    );
  });

  it("导出型站点技能带目标语言时应同时注入 translation_skill_launch metadata", () => {
    const skill = createBrowserSkill({
      id: "x-article-export",
      title: "X 文章转存",
      summary: "导出 X 长文并按目标语言翻译正文。",
      slotSchema: [
        {
          key: "article_url",
          label: "X 文章链接",
          type: "url",
          required: true,
          placeholder: "https://x.com/<账号>/article/<文章ID>",
        },
        {
          key: "target_language",
          label: "目标语言",
          type: "text",
          required: false,
          defaultValue: "中文",
          placeholder: "例如 中文、英文、日文",
        },
      ],
      siteCapabilityBinding: {
        autoRun: true,
        requireAttachedSession: true,
        saveMode: "project_resource",
        siteLabel: "X",
        adapterMatch: {
          urlArgName: "url",
          requiredCapabilities: ["article_export", "markdown_bundle"],
          hostAliases: ["twitter.com", "www.twitter.com"],
        },
        slotArgMap: {
          article_url: "url",
          target_language: "target_language",
        },
      },
    });
    const context = buildServiceSkillClawLaunchContext(
      skill,
      {
        article_url: "https://x.com/GoogleCloudTech/article/2033953579824758855",
        target_language: "中文",
      },
      {
        adapterName: "x/article-export",
        projectId: "project-1",
        contentId: "content-1",
      },
    );

    expect(buildServiceSkillClawLaunchRequestMetadata(context)).toMatchObject({
      harness: {
        allow_model_skills: true,
        translation_skill_launch: {
          skill_name: "translation",
          kind: "translation_request",
          translation_request: {
            target_language: "中文",
            project_id: "project-1",
            content_id: "content-1",
            entry_source: "service_skill_site_export_followup",
          },
        },
        service_skill_launch: {
          adapter_name: "x/article-export",
        },
      },
    });
  });

  it("应按 URL 域名、能力标签和 host alias 解析动态站点适配器", async () => {
    mockSiteListAdapters.mockResolvedValueOnce([
      {
        name: "x/article-export",
        domain: "x.com",
        description: "导出 X 长文",
        read_only: true,
        capabilities: ["article_export", "markdown_bundle"],
        input_schema: {},
        example_args: {},
        example: "",
      },
      {
        name: "x/timeline",
        domain: "x.com",
        description: "读取 X 时间线",
        read_only: true,
        capabilities: ["timeline"],
        input_schema: {},
        example_args: {},
        example: "",
      },
    ]);

    const resolved = await resolveServiceSkillSiteCapabilityExecution(
      createBrowserSkill({
        id: "x-article-export",
        title: "X 文章转存",
        slotSchema: [
          {
            key: "article_url",
            label: "X 文章链接",
            type: "url",
            required: true,
            placeholder: "https://x.com/<账号>/article/<文章ID>",
          },
        ],
        siteCapabilityBinding: {
          autoRun: true,
          requireAttachedSession: true,
          saveMode: "project_resource",
          siteLabel: "X",
          adapterMatch: {
            urlArgName: "url",
            requiredCapabilities: ["article_export", "markdown_bundle"],
            hostAliases: ["twitter.com", "www.twitter.com"],
          },
          slotArgMap: {
            article_url: "url",
          },
        },
      }),
      {
        article_url: "https://twitter.com/GoogleCloudTech/article/2033953579824758855",
      },
    );

    expect(resolved).toEqual({
      adapterName: "x/article-export",
      args: {
        url: "https://twitter.com/GoogleCloudTech/article/2033953579824758855",
      },
    });
  });
});
