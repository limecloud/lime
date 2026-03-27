import { describe, expect, it } from "vitest";
import {
  buildServiceSkillAutomationAgentTurnPayloadContext,
  buildServiceSkillAutomationInitialValues,
  supportsServiceSkillLocalAutomation,
} from "./automationDraft";
import type { ServiceSkillItem } from "./types";

const SCHEDULED_SKILL: ServiceSkillItem = {
  id: "daily-trend-briefing",
  title: "每日趋势摘要",
  summary: "围绕指定平台与关键词输出趋势摘要。",
  category: "社媒运营",
  outputHint: "趋势摘要 + 调度建议",
  source: "cloud_catalog",
  runnerType: "scheduled",
  defaultExecutorBinding: "automation_job",
  executionLocation: "client_default",
  defaultArtifactKind: "analysis",
  themeTarget: "social-media",
  version: "seed-v1",
  slotSchema: [
    {
      key: "platform",
      label: "监测平台",
      type: "platform",
      required: true,
      placeholder: "选择平台",
      defaultValue: "x",
      options: [{ value: "x", label: "X / Twitter" }],
    },
    {
      key: "industry_keywords",
      label: "行业关键词",
      type: "textarea",
      required: true,
      placeholder: "输入关键词",
    },
    {
      key: "schedule_time",
      label: "推送时间",
      type: "schedule_time",
      required: false,
      defaultValue: "每天 09:00",
      placeholder: "例如 每天 09:00",
    },
  ],
};

describe("service skill automation draft", () => {
  it("应识别可转本地自动化的服务型技能", () => {
    expect(supportsServiceSkillLocalAutomation(SCHEDULED_SKILL)).toBe(true);
    expect(
      supportsServiceSkillLocalAutomation({
        ...SCHEDULED_SKILL,
        runnerType: "instant",
      }),
    ).toBe(false);
  });

  it("应把 schedule_time 预填为 automation 创建表单", () => {
    const initialValues = buildServiceSkillAutomationInitialValues({
      skill: SCHEDULED_SKILL,
      slotValues: {
        platform: "x",
        industry_keywords: "AI Agent，创作者工具",
        schedule_time: "每天 09:00",
      },
      userInput: "重点关注新增热点与异常波动。",
      workspaceId: "project-1",
    });

    expect(initialValues.name).toContain("每日趋势摘要");
    expect(initialValues.workspace_id).toBe("project-1");
    expect(initialValues.execution_mode).toBe("skill");
    expect(initialValues.payload_kind).toBe("agent_turn");
    expect(initialValues.schedule_kind).toBe("cron");
    expect(initialValues.cron_expr).toBe("00 09 * * *");
    expect(initialValues.prompt).toContain("[服务型技能] 每日趋势摘要");
    expect(initialValues.prompt).toContain("[自动化执行要求]");
    expect(initialValues.agent_request_metadata).toEqual(
      expect.objectContaining({
        artifact: expect.objectContaining({
          artifact_mode: "draft",
          artifact_kind: "analysis",
        }),
        service_skill: expect.objectContaining({
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          runner_type: "scheduled",
          slot_values: [
            {
              key: "platform",
              label: "监测平台",
              value: "X / Twitter",
            },
            {
              key: "industry_keywords",
              label: "行业关键词",
              value: "AI Agent，创作者工具",
            },
            {
              key: "schedule_time",
              label: "推送时间",
              value: "每天 09:00",
            },
          ],
          slot_summary: [
            "监测平台: X / Twitter",
            "行业关键词: AI Agent，创作者工具",
            "推送时间: 每天 09:00",
          ],
          user_input: "重点关注新增热点与异常波动。",
        }),
        harness: expect.objectContaining({
          theme: "social-media",
          session_mode: "theme_workbench",
          run_title: "每日趋势摘要",
        }),
      }),
    );
  });

  it("应为自动化 agent_turn 生成可复用的 artifact/content payload 上下文", () => {
    const payloadContext = buildServiceSkillAutomationAgentTurnPayloadContext({
      skill: SCHEDULED_SKILL,
      contentId: "content-1",
    });

    expect(payloadContext).toEqual(
      expect.objectContaining({
        content_id: "content-1",
        request_metadata: expect.objectContaining({
          artifact: expect.objectContaining({
            artifact_mode: "draft",
            artifact_kind: "analysis",
          }),
          service_skill: expect.objectContaining({
            id: "daily-trend-briefing",
            title: "每日趋势摘要",
            runner_type: "scheduled",
            slot_values: [],
            slot_summary: [],
            user_input: null,
          }),
          harness: expect.objectContaining({
            theme: "social-media",
            session_mode: "theme_workbench",
            content_id: "content-1",
          }),
        }),
      }),
    );
  });
});
