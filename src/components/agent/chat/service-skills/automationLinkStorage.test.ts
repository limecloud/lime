import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationJobRecord } from "@/lib/api/automation";
import {
  buildServiceSkillAutomationStatusMap,
  listServiceSkillAutomationLinks,
  recordServiceSkillAutomationLink,
  resolveServiceSkillAutomationLinks,
  subscribeServiceSkillAutomationLinksChanged,
} from "./automationLinkStorage";

function buildJob(
  overrides: Partial<AutomationJobRecord> = {},
): AutomationJobRecord {
  return {
    id: "automation-job-1",
    name: "每日趋势摘要｜定时执行",
    description: "服务型技能创建的本地任务",
    enabled: true,
    workspace_id: "project-1",
    execution_mode: "skill",
    schedule: {
      kind: "cron",
      expr: "0 9 * * *",
      tz: "Asia/Shanghai",
    },
    payload: {
      kind: "agent_turn",
      prompt: "prompt",
      system_prompt: null,
      web_search: false,
      request_metadata: {
        service_skill: {
          id: "daily-trend-briefing",
          title: "每日趋势摘要",
          runner_type: "scheduled",
        },
      },
    },
    delivery: {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    },
    timeout_secs: null,
    max_retries: 2,
    next_run_at: "2026-03-24T09:00:00.000Z",
    last_status: "success",
    last_error: null,
    last_run_at: "2026-03-23T09:00:00.000Z",
    last_finished_at: "2026-03-23T09:00:10.000Z",
    running_started_at: null,
    consecutive_failures: 0,
    last_retry_count: 0,
    auto_disabled_until: null,
    last_delivery: null,
    created_at: "2026-03-22T09:00:00.000Z",
    updated_at: "2026-03-23T09:00:10.000Z",
    ...overrides,
  };
}

describe("automationLinkStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("记录关联后应能读回最后一次 skill -> job 绑定", () => {
    recordServiceSkillAutomationLink({
      skillId: "daily-trend-briefing",
      jobId: "automation-job-1",
      jobName: "每日趋势摘要｜定时执行",
      linkedAt: 1,
    });
    recordServiceSkillAutomationLink({
      skillId: "daily-trend-briefing",
      jobId: "automation-job-2",
      jobName: "每日趋势摘要｜持续执行",
      linkedAt: 2,
    });

    expect(listServiceSkillAutomationLinks()).toEqual([
      {
        skillId: "daily-trend-briefing",
        jobId: "automation-job-2",
        jobName: "每日趋势摘要｜持续执行",
        linkedAt: 2,
      },
    ]);
  });

  it("变更关联时应广播事件", () => {
    const callback = vi.fn();
    const unsubscribe = subscribeServiceSkillAutomationLinksChanged(callback);

    try {
      recordServiceSkillAutomationLink({
        skillId: "daily-trend-briefing",
        jobId: "automation-job-1",
        jobName: "每日趋势摘要｜定时执行",
      });

      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("应把关联 job 汇总成首页可显示的状态摘要", () => {
    recordServiceSkillAutomationLink({
      skillId: "daily-trend-briefing",
      jobId: "automation-job-1",
      jobName: "每日趋势摘要｜定时执行",
    });

    const statusMap = buildServiceSkillAutomationStatusMap([buildJob()]);

    expect(statusMap["daily-trend-briefing"]).toEqual(
      expect.objectContaining({
        jobId: "automation-job-1",
        statusLabel: "成功",
        tone: "emerald",
      }),
    );
    expect(statusMap["daily-trend-briefing"]?.detail).toContain("下次");
  });

  it("应从任务 request_metadata 恢复持久化的服务型技能关联", () => {
    const links = resolveServiceSkillAutomationLinks([buildJob()]);

    expect(links).toEqual([
      expect.objectContaining({
        skillId: "daily-trend-briefing",
        jobId: "automation-job-1",
        jobName: "每日趋势摘要｜定时执行",
      }),
    ]);
  });

  it("没有本地 link 时也应根据持久化关联构建首页状态", () => {
    const statusMap = buildServiceSkillAutomationStatusMap([buildJob()]);

    expect(statusMap["daily-trend-briefing"]).toEqual(
      expect.objectContaining({
        jobId: "automation-job-1",
        statusLabel: "成功",
        tone: "emerald",
      }),
    );
  });
});
