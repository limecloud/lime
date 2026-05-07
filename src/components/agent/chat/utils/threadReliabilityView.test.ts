import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildThreadReliabilityView } from "./threadReliabilityView";
import type { AgentRuntimeThreadReadModel } from "@/lib/api/agentRuntime";

describe("buildThreadReliabilityView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T10:00:00Z"));
  });

  it("应按 incident 严重级别排序，并优先使用最高优先级事故生成摘要", () => {
    const threadRead: AgentRuntimeThreadReadModel = {
      thread_id: "thread-1",
      status: "failed",
      active_turn_id: "turn-1",
      pending_requests: [],
      incidents: [
        {
          id: "incident-low",
          thread_id: "thread-1",
          turn_id: "turn-1",
          incident_type: "minor_warning",
          severity: "low",
          status: "active",
          title: "低优先级提醒",
          details: "仅需关注",
        },
        {
          id: "incident-high",
          thread_id: "thread-1",
          turn_id: "turn-1",
          incident_type: "provider_failure",
          severity: "high",
          status: "active",
          title: "高优先级故障",
          details: "Provider 已连续失败",
        },
        {
          id: "incident-medium",
          thread_id: "thread-1",
          turn_id: "turn-1",
          incident_type: "waiting_user_input",
          severity: "warning",
          status: "active",
          title: "中优先级等待",
          details: "等待人工确认",
        },
      ],
    };

    const view = buildThreadReliabilityView({
      threadRead,
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续执行发布流程",
          status: "failed",
          error_message: "Provider 429",
          started_at: "2026-03-23T09:00:00Z",
          created_at: "2026-03-23T09:00:00Z",
          updated_at: "2026-03-23T09:00:10Z",
          completed_at: "2026-03-23T09:00:12Z",
        },
      ],
      currentTurnId: "turn-1",
    });

    expect(view.incidents.map((incident) => incident.title)).toEqual([
      "高优先级故障",
      "中优先级等待",
      "低优先级提醒",
    ]);
    expect(view.summary).toContain("高优先级故障");
    expect(view.summary).toContain("Provider 已连续失败");
  });

  it("应基于 timeout / stuck incident 生成主动治理建议", () => {
    const threadRead: AgentRuntimeThreadReadModel = {
      thread_id: "thread-1",
      status: "running",
      active_turn_id: "turn-2",
      pending_requests: [],
      incidents: [
        {
          id: "incident-stuck",
          thread_id: "thread-1",
          turn_id: "turn-2",
          incident_type: "turn_stuck",
          severity: "high",
          status: "active",
          title: "当前回合长时间无进展",
          details: "最近 3 分钟内没有新的线程更新",
        },
      ],
      last_outcome: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        outcome_type: "failed_provider",
        summary: "最近一次 provider 请求失败",
        primary_cause: "429",
        retryable: true,
        ended_at: "2026-03-23T09:58:00Z",
      },
    };

    const view = buildThreadReliabilityView({
      threadRead,
      turns: [
        {
          id: "turn-2",
          thread_id: "thread-1",
          prompt_text: "继续执行部署验证",
          status: "running",
          created_at: "2026-03-23T09:55:00Z",
          started_at: "2026-03-23T09:55:00Z",
          updated_at: "2026-03-23T09:56:00Z",
        },
      ],
      currentTurnId: "turn-2",
    });

    expect(view.summary).toContain("当前回合长时间无进展");
    expect(view.recommendations).toContain(
      "当前回合长时间无进展，建议停止后恢复执行",
    );
    expect(view.recommendations).toContain(
      "Provider 故障通常可重试，建议稍后恢复或重发回合",
    );
    expect(view.recommendations).toContain(
      "最近结果支持重试，可恢复或重新发起新回合",
    );
  });

  it("应识别审批超时并给出优先处理建议", () => {
    const threadRead: AgentRuntimeThreadReadModel = {
      thread_id: "thread-1",
      status: "waiting_request",
      active_turn_id: "turn-3",
      pending_requests: [
        {
          id: "req-approval",
          thread_id: "thread-1",
          turn_id: "turn-3",
          request_type: "tool_confirmation",
          status: "pending",
          title: "请确认是否执行 apply_patch",
          created_at: "2026-03-23T09:50:00Z",
        },
      ],
      incidents: [
        {
          id: "incident-approval",
          thread_id: "thread-1",
          turn_id: "turn-3",
          incident_type: "approval_timeout",
          severity: "high",
          status: "active",
          title: "审批等待超过阈值",
          details: "工具确认已等待 10 分钟：请确认是否执行 apply_patch",
        },
      ],
    };

    const view = buildThreadReliabilityView({
      threadRead,
      turns: [
        {
          id: "turn-3",
          thread_id: "thread-1",
          prompt_text: "继续修复发布脚本",
          status: "running",
          created_at: "2026-03-23T09:49:00Z",
          started_at: "2026-03-23T09:49:00Z",
          updated_at: "2026-03-23T09:50:00Z",
        },
      ],
      currentTurnId: "turn-3",
    });

    expect(view.pendingRequests[0]?.waitingLabel).toBe("已等待 10 分钟");
    expect(view.recommendations).toContain("优先响应当前待处理请求");
    expect(view.recommendations).toContain(
      "审批等待过久，建议尽快处理或停止当前执行",
    );
  });

  it("应把 runtime 中断请求展示为中断中而非普通运行中", () => {
    const threadRead: AgentRuntimeThreadReadModel = {
      thread_id: "thread-1",
      status: "interrupting",
      active_turn_id: "turn-4",
      pending_requests: [],
      incidents: [],
      interrupt_state: "interrupting",
      updated_at: "2026-03-23T09:59:58Z",
    };

    const view = buildThreadReliabilityView({
      threadRead,
      turns: [
        {
          id: "turn-4",
          thread_id: "thread-1",
          prompt_text: "继续停止当前执行",
          status: "running",
          created_at: "2026-03-23T09:59:00Z",
          started_at: "2026-03-23T09:59:00Z",
          updated_at: "2026-03-23T09:59:58Z",
        },
      ],
      currentTurnId: "turn-4",
    });

    expect(view.statusLabel).toBe("中断中");
    expect(view.interruptStateLabel).toBe("运行时正在处理中断");
    expect(view.summary).toContain("请等待运行时回填最终状态");
    expect(view.recommendations).toContain(
      "正在停止当前执行，请等待运行时回填最终状态",
    );
  });

  it("应忽略 Artifact 自动恢复 warning，不把它升级为活跃 incident", () => {
    const view = buildThreadReliabilityView({
      threadRead: {
        thread_id: "thread-1",
        status: "completed",
        active_turn_id: "turn-5",
        pending_requests: [],
        incidents: [],
      },
      turns: [
        {
          id: "turn-5",
          thread_id: "thread-1",
          prompt_text: "整理结构化文稿",
          status: "completed",
          created_at: "2026-03-23T09:58:00Z",
          started_at: "2026-03-23T09:58:00Z",
          updated_at: "2026-03-23T09:59:00Z",
          completed_at: "2026-03-23T09:59:00Z",
        },
      ],
      currentTurnId: "turn-5",
      threadItems: [
        {
          id: "warning-artifact-repaired",
          thread_id: "thread-1",
          turn_id: "turn-5",
          sequence: 3,
          status: "completed",
          started_at: "2026-03-23T09:58:30Z",
          completed_at: "2026-03-23T09:58:30Z",
          updated_at: "2026-03-23T09:58:30Z",
          type: "warning",
          code: "artifact_document_repaired",
          message:
            "ArtifactDocument 已落盘: 已根据正文整理出一份可继续编辑的草稿。",
        },
      ],
    });

    expect(view.activeIncidentCount).toBe(0);
    expect(view.incidents).toEqual([]);
    expect(view.summary).not.toContain("警告");
  });

  it("运行时权限确认等待不应投影为处理工作台异常或泄露内部字段", () => {
    const internalMessage =
      '运行时权限声明需要真实确认：已创建真实权限确认请求 {"confirmationStatus":"not_requested","askProfileKeys":["write"]}';
    const view = buildThreadReliabilityView({
      threadRead: {
        thread_id: "thread-permission",
        status: "running",
        active_turn_id: "turn-permission",
        pending_requests: [],
        incidents: [
          {
            id: "incident-permission",
            thread_id: "thread-permission",
            turn_id: "turn-permission",
            incident_type: "runtime_permission_wait",
            severity: "high",
            status: "active",
            title: "运行时权限等待",
            details: {
              message: internalMessage,
            },
          },
        ],
      },
      turns: [
        {
          id: "turn-permission",
          thread_id: "thread-permission",
          prompt_text: "写入文件",
          status: "running",
          created_at: "2026-03-23T09:59:00Z",
          started_at: "2026-03-23T09:59:00Z",
          updated_at: "2026-03-23T09:59:58Z",
        },
      ],
      currentTurnId: "turn-permission",
      threadItems: [
        {
          id: "item-permission-error",
          thread_id: "thread-permission",
          turn_id: "turn-permission",
          sequence: 3,
          status: "failed",
          started_at: "2026-03-23T09:59:30Z",
          completed_at: "2026-03-23T09:59:30Z",
          updated_at: "2026-03-23T09:59:30Z",
          type: "error",
          message: internalMessage,
        },
      ],
    });

    expect(view.incidents).toEqual([]);
    expect(view.activeIncidentCount).toBe(0);
    expect(view.summary).not.toContain("时间线记录到异常项");
    expect(view.summary).not.toContain("confirmationStatus");
    expect(view.summary).not.toContain("askProfileKeys");
  });

  it("运行时权限确认等待的失败 turn 应展示为等待处理 outcome", () => {
    const internalMessage =
      "运行时权限声明需要真实确认，当前 turn 已在模型执行前等待用户确认：confirmationStatus=not_requested，askProfileKeys=web_search。已创建真实权限确认请求；请确认后重试或恢复本轮执行。";
    const view = buildThreadReliabilityView({
      turns: [
        {
          id: "turn-permission-failed",
          thread_id: "thread-permission",
          prompt_text: "@搜索 OpenAI 最新模型公告",
          status: "failed",
          error_message: internalMessage,
          created_at: "2026-03-23T09:59:00Z",
          started_at: "2026-03-23T09:59:00Z",
          updated_at: "2026-03-23T09:59:30Z",
          completed_at: "2026-03-23T09:59:30Z",
        },
      ],
      currentTurnId: "turn-permission-failed",
    });

    expect(view.statusLabel).toBe("等待处理");
    expect(view.outcome).toMatchObject({
      label: "等待处理",
      summary: "当前回合正在等待运行时权限确认",
      tone: "waiting",
    });
    expect(view.summary).toBe("当前回合正在等待运行时权限确认");
    expect(view.summary).not.toContain("confirmationStatus");
    expect(view.summary).not.toContain("askProfileKeys");
  });
});
