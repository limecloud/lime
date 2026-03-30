import { describe, expect, it } from "vitest";
import type { ServiceSkillItem } from "@/lib/api/serviceSkills";
import { buildServiceSkillNaturalLaunchMessage } from "./siteCapabilityBinding";

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
});
