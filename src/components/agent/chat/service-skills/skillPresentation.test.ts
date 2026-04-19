import { describe, expect, it } from "vitest";
import {
  buildServiceSkillCapabilityDescription,
  getServiceSkillActionLabel,
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
  it("本地即时技能的动作文案应指向对话内补参，而不是旧弹窗心智", () => {
    expect(getServiceSkillActionLabel(createServiceSkill())).toBe("对话内补参");
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

  it("带必填槽位的站点技能应指向对话内补参", () => {
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
    ).toBe("对话内补参");
  });

  it("无必填槽位的站点技能仍应保留开始执行语义", () => {
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
    ).toBe("开始执行");
  });
});
