import { describe, expect, it } from "vitest";
import type { ServiceSkillHomeItem } from "./types";
import { matchAutoLaunchSiteSkillFromText } from "./autoMatchSiteSkill";

function createGithubSiteSkill(): ServiceSkillHomeItem {
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
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
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
  };
}

function createGithubIssueSiteSkill(): ServiceSkillHomeItem {
  return {
    id: "github-issue-radar",
    title: "GitHub Issue 追踪",
    summary: "复用 GitHub 登录态检索仓库 issue。",
    category: "情报研究",
    outputHint: "Issue 列表 + 状态判断",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "browser_assist",
    executionLocation: "client_default",
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald",
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
    slotSchema: [
      {
        key: "target_repo",
        label: "目标仓库",
        type: "text",
        required: true,
        placeholder: "例如 rust-lang/rust",
      },
      {
        key: "issue_query",
        label: "Issue 关键词",
        type: "text",
        required: false,
        placeholder: "例如 borrow checker",
      },
      {
        key: "issue_state",
        label: "Issue 状态",
        type: "text",
        required: false,
        placeholder: "open / closed / all",
      },
    ],
    siteCapabilityBinding: {
      adapterName: "github/issues",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "current_content",
      slotArgMap: {
        target_repo: "repo",
        issue_query: "query",
        issue_state: "state",
      },
      fixedArgs: {
        limit: 10,
      },
    },
  };
}

describe("autoMatchSiteSkill", () => {
  it("应把 GitHub 自然句匹配成站点 service skill", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText: "请帮我使用 GitHub 查一下 AI Agent 项目",
      serviceSkills: [createGithubSiteSkill()],
    });

    expect(matched).toMatchObject({
      skill: expect.objectContaining({
        id: "github-repo-radar",
      }),
      slotValues: {
        repository_query: "AI Agent",
      },
      launchUserInput: undefined,
    });
  });

  it("应保留逗号后的补充要求，避免重复拼接整句", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText:
        "请帮我使用 GitHub 查一下 AI Agent 项目，优先看最近一个月有更新的仓库",
      serviceSkills: [createGithubSiteSkill()],
    });

    expect(matched).toMatchObject({
      slotValues: {
        repository_query: "AI Agent",
      },
      launchUserInput: "优先看最近一个月有更新的仓库",
    });
  });

  it("应支持更自然的 GitHub 搜索句式", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText: "在 GitHub 上找一些 AI Agent 仓库",
      serviceSkills: [createGithubSiteSkill()],
    });

    expect(matched).toMatchObject({
      slotValues: {
        repository_query: "AI Agent",
      },
    });
  });

  it("应支持动作在前的 GitHub 搜索句式", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText: "帮我查查 GitHub 上关于 AI Agent 的 repo",
      serviceSkills: [createGithubSiteSkill()],
    });

    expect(matched).toMatchObject({
      slotValues: {
        repository_query: "AI Agent",
      },
    });
  });

  it("应把 GitHub issue 自然句匹配成 issue 站点 skill", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText:
        "请帮我看一下 GitHub 上 rust-lang/rust 仓库里和 borrow checker 相关的 open issues",
      serviceSkills: [createGithubIssueSiteSkill()],
    });

    expect(matched).toMatchObject({
      skill: expect.objectContaining({
        id: "github-issue-radar",
      }),
      slotValues: {
        target_repo: "rust-lang/rust",
        issue_query: "borrow checker",
        issue_state: "open",
      },
      launchUserInput: undefined,
    });
  });

  it("GitHub issue 意图缺少仓库时应保持保守，不误命中其他站点 skill", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText: "帮我看看 GitHub 上和 borrow checker 相关的 issues",
      serviceSkills: [createGithubSiteSkill(), createGithubIssueSiteSkill()],
    });

    expect(matched).toBeNull();
  });

  it("没有明确站点线索时不应误命中 service skill", () => {
    const matched = matchAutoLaunchSiteSkillFromText({
      inputText: "请帮我找一下 AI Agent 项目",
      serviceSkills: [createGithubSiteSkill()],
    });

    expect(matched).toBeNull();
  });
});
