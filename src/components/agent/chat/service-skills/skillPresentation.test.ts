import { describe, expect, it } from "vitest";
import {
  buildServiceSkillCapabilityDescription,
  getServiceSkillActionLabel,
  getServiceSkillRunnerDescription,
  getServiceSkillRunnerLabel,
  listServiceSkillDependencies,
  summarizeServiceSkillRequiredInputs,
} from "./skillPresentation";
import type { ServiceSkillItem } from "./types";

function createServiceSkill(
  overrides: Partial<ServiceSkillItem> = {},
): ServiceSkillItem {
  return {
    id: "deep-research",
    title: "深度研究",
    summary: "综合多来源信息并给出归纳后的结论。",
    category: "调研",
    outputHint: "研究摘要",
    source: "cloud_catalog",
    runnerType: "instant",
    defaultExecutorBinding: "agent_turn",
    executionLocation: "client_default",
    slotSchema: [],
    version: "2026-04-09",
    ...overrides,
  };
}

describe("skillPresentation", () => {
  it("本地即时技能的动作文案应指向开始这一步，而不是旧工作区心智", () => {
    expect(getServiceSkillActionLabel(createServiceSkill())).toBe("开始这一步");
  });

  it("service skill 的必填输入摘要应优先使用槽位标签，并在无必填项时给出稳定兜底", () => {
    expect(summarizeServiceSkillRequiredInputs(createServiceSkill())).toBe(
      "当前无必填信息",
    );

    expect(
      summarizeServiceSkillRequiredInputs(
        createServiceSkill({
          slotSchema: [
            {
              key: "query",
              label: "检索词",
              type: "text",
              required: true,
              placeholder: "例如 AI Agent",
            },
            {
              key: "platform",
              label: "目标平台",
              type: "text",
              required: true,
              placeholder: "例如 GitHub",
            },
          ],
        }),
      ),
    ).toBe("检索词、目标平台");
  });

  it("service skill 的能力描述应收口成 promise + 需要 + 交付 的统一合同", () => {
    expect(
      buildServiceSkillCapabilityDescription(
        createServiceSkill({
          entryHint: "补一个主题，我先整理一版研究结论。",
          slotSchema: [
            {
              key: "query",
              label: "检索词",
              type: "text",
              required: true,
              placeholder: "例如 AI Agent",
            },
          ],
        }),
      ),
    ).toBe("补一个主题，我先整理一版研究结论。 · 需要：检索词 · 交付：研究摘要");

    expect(
      buildServiceSkillCapabilityDescription(createServiceSkill(), {
        includeSummary: false,
      }),
    ).toBe("需要：当前无必填信息 · 交付：研究摘要");
  });

  it("带必填槽位的站点技能应提示先补齐这一步", () => {
    expect(
      getServiceSkillActionLabel(
        createServiceSkill({
          defaultExecutorBinding: "browser_assist",
          slotSchema: [
            {
              key: "query",
              label: "检索词",
              type: "text",
              required: true,
              placeholder: "例如 AI Agent",
            },
          ],
          siteCapabilityBinding: {
            adapterName: "github/search",
            autoRun: true,
            slotArgMap: {},
          },
        }),
      ),
    ).toBe("补齐这一步");
  });

  it("无必填槽位的站点技能应直接提示接着继续", () => {
    expect(
      getServiceSkillActionLabel(
        createServiceSkill({
          defaultExecutorBinding: "browser_assist",
          slotSchema: [],
          siteCapabilityBinding: {
            adapterName: "github/search",
            autoRun: true,
            slotArgMap: {},
          },
        }),
      ),
    ).toBe("接着继续");
  });

  it("站点做法的运行语义应改成接着浏览器继续，而不是暴露采集与登录态术语", () => {
    const siteSkill = createServiceSkill({
      defaultExecutorBinding: "browser_assist",
      siteCapabilityBinding: {
        adapterName: "github/search",
        autoRun: true,
        slotArgMap: {},
      },
      readinessRequirements: {
        requiresBrowser: true,
      },
    });

    expect(getServiceSkillRunnerLabel(siteSkill)).toBe("接着浏览器继续");
    expect(getServiceSkillRunnerDescription(siteSkill)).toBe(
      "会接着当前浏览器里已经打开的页面把这一步做完，并把结果带回生成。",
    );
    expect(listServiceSkillDependencies(siteSkill)).toContain(
      "需要当前浏览器里已经打开并登录对应站点。",
    );
  });
});
