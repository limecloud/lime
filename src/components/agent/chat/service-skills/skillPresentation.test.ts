import { describe, expect, it } from "vitest";
import { getServiceSkillActionLabel } from "./skillPresentation";
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
