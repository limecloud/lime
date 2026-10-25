import { beforeEach, describe, expect, it } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import type {
  AgentThreadItem,
  AgentToolCallState,
} from "@/lib/api/agentProtocol";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { Message } from "../types";
import type {
  GeneralWorkbenchActivityLogGroup,
  GeneralWorkbenchCreationTaskGroup,
} from "./generalWorkbenchWorkflowData";
import {
  buildGeneralWorkbenchTaskRailProjection,
  type GeneralWorkbenchTaskRailItemStatus,
} from "./generalWorkbenchTaskRailViewModel";
import { buildGeneralWorkbenchRunControlSurfaceProjection } from "./generalWorkbenchRunControlSurfaceViewModel";

type TaskRailTranslate = NonNullable<
  Parameters<typeof buildGeneralWorkbenchTaskRailProjection>[0]["t"]
>;

const t = ((key: string, values?: Record<string, unknown>) => {
  const templates: Record<string, string> = {
    "generalWorkbench.taskRail.artifactsDetail": "产物：{{paths}}",
    "generalWorkbench.taskRail.empty.noSteps":
      "发送任务后，这里会显示进度和输出。",
    "generalWorkbench.taskRail.empty.withSteps":
      "当前还没有执行记录，后续产物会出现在这里。",
    "generalWorkbench.taskRail.activityOverflow": "另有 {{count}} 项执行",
    "generalWorkbench.taskRail.approval.askTitle": "等待回答",
    "generalWorkbench.taskRail.approval.elicitationTitle": "等待补充",
    "generalWorkbench.taskRail.approval.importedReadOnlyTitle":
      "导入的权限记录",
    "generalWorkbench.taskRail.approval.toolTitle": "确认 {{tool}}",
    "generalWorkbench.taskRail.approval.status.answered": "已回答",
    "generalWorkbench.taskRail.approval.status.approved": "已允许",
    "generalWorkbench.taskRail.approval.status.rejected": "已拒绝",
    "generalWorkbench.taskRail.approval.status.resolved": "已处理",
    "generalWorkbench.taskRail.planOverflow": "另有 {{count}} 步",
    "generalWorkbench.taskRail.planRevision": "计划 {{revision}}",
    "generalWorkbench.taskRail.planRevisionTitle": "当前计划版本：{{revision}}",
    "generalWorkbench.taskRail.context.access.current": "按需确认",
    "generalWorkbench.taskRail.context.access.fullAccess": "完全访问",
    "generalWorkbench.taskRail.context.access.readOnly": "只读",
    "generalWorkbench.taskRail.context.model": "模型",
    "generalWorkbench.taskRail.context.objective": "目标",
    "generalWorkbench.taskRail.context.permission": "权限",
    "generalWorkbench.taskRail.context.reasoning": "思考",
    "generalWorkbench.taskRail.context.reasoning.high": "高",
    "generalWorkbench.taskRail.context.reasoning.low": "低",
    "generalWorkbench.taskRail.context.reasoning.medium": "中",
    "generalWorkbench.taskRail.context.sources": "来源",
    "generalWorkbench.taskRail.context.sourcesMoreTitle":
      "来源：{{sources}}，另有 {{count}} 项",
    "generalWorkbench.taskRail.context.sourcesOverflow": "另有 {{count}} 项",
    "generalWorkbench.taskRail.context.sourcesStatus.linked": "已关联",
    "generalWorkbench.taskRail.context.sourcesStatus.linkedTitle":
      "已关联 {{evidence}} 条证据",
    "generalWorkbench.taskRail.context.sourcesStatus.missingSource": "待补来源",
    "generalWorkbench.taskRail.context.sourcesStatus.missingSourceTitle":
      "缺少 {{missing}} 项上下文来源",
    "generalWorkbench.taskRail.context.sourcesStatus.needsEvidence": "待补证据",
    "generalWorkbench.taskRail.context.sourcesStatus.needsEvidenceTitle":
      "已有 {{sources}} 个来源，缺少证据引用",
    "generalWorkbench.taskRail.context.sourcesTitle": "来源：{{sources}}",
    "generalWorkbench.taskRail.context.sourcesValue": "{{count}} 项",
    "generalWorkbench.taskRail.context.changes": "变更",
    "generalWorkbench.taskRail.context.changesValue": "{{files}} 文件",
    "generalWorkbench.taskRail.context.changesTitle":
      "变更 {{files}} 文件，补丁 {{patches}} 个",
    "generalWorkbench.taskRail.context.changesFailedTitle":
      "变更 {{files}} 文件，{{failed}} 个补丁失败",
    "generalWorkbench.taskRail.context.changesRunningTitle":
      "变更 {{files}} 文件，{{running}} 个补丁进行中",
    "generalWorkbench.taskRail.context.subtasks": "子任务",
    "generalWorkbench.taskRail.context.subtasksValue":
      "{{completed}}/{{total}}",
    "generalWorkbench.taskRail.context.subtasksTitle":
      "子任务 {{completed}}/{{total}} 完成",
    "generalWorkbench.taskRail.context.subtasksActiveTitle":
      "子任务 {{active}} 个进行中，{{completed}}/{{total}} 完成",
    "generalWorkbench.taskRail.context.subtasksFailedTitle":
      "子任务 {{failed}} 个需处理，{{completed}}/{{total}} 完成",
    "generalWorkbench.taskRail.context.workspace": "工作区",
    "generalWorkbench.taskRail.surface.activityCount": "{{count}} 项",
    "generalWorkbench.taskRail.surface.activityFailed": "{{failed}} 项需处理",
    "generalWorkbench.taskRail.surface.activityRunning": "{{running}} 项进行中",
    "generalWorkbench.taskRail.surface.approvalCount": "{{count}} 条",
    "generalWorkbench.taskRail.surface.approvalPending": "{{count}} 条待确认",
    "generalWorkbench.taskRail.surface.branch": "分支",
    "generalWorkbench.taskRail.surface.environmentTitle": "环境",
    "generalWorkbench.taskRail.surface.gitStatus": "Git",
    "generalWorkbench.taskRail.surface.goalTitle": "目标",
    "generalWorkbench.taskRail.surface.mode": "模式",
    "generalWorkbench.taskRail.surface.outputCount": "{{count}} 项",
    "generalWorkbench.taskRail.surface.outputsTitle": "结果",
    "generalWorkbench.taskRail.surface.participantsTitle": "参与",
    "generalWorkbench.taskRail.surface.planTitle": "计划",
    "generalWorkbench.taskRail.surface.provenanceTitle": "来源",
    "generalWorkbench.taskRail.surface.runStatus": "状态",
    "generalWorkbench.taskRail.surface.runTitle": "运行",
    "generalWorkbench.taskRail.surface.splitLane": "分屏",
    "generalWorkbench.taskRail.surface.splitLane.available": "可打开",
    "generalWorkbench.taskRail.surface.splitLane.open": "已打开",
    "generalWorkbench.taskRail.surface.splitLane.unavailable": "未启用",
    "generalWorkbench.taskRail.surface.thread": "线程",
    "generalWorkbench.taskRail.surface.turn": "轮次",
    "generalWorkbench.taskRail.runTitle": "执行 {{source}}",
    "generalWorkbench.taskRail.runTitleFallback": "执行任务",
    "generalWorkbench.taskRail.stepMeta": "步骤 {{index}}",
    "generalWorkbench.taskRail.thinkingTitle": "整理思路",
    "generalWorkbench.workflow.completed.count": "已完成 {{count}} 项",
    "generalWorkbench.workflow.completed.hint": "继续处理剩余事项",
    "generalWorkbench.workflow.current.allCompleted": "当前流程已全部完成",
    "generalWorkbench.workflow.current.completedTitle": "当前流程已完成",
    "generalWorkbench.workflow.current.emptyTitle": "等待创建第一条任务",
    "generalWorkbench.workflow.current.remaining": "剩余 {{count}} 项待处理",
    "generalWorkbench.workflow.queue.hiddenCount":
      "已展示 {{visible}} 项，另有 {{hidden}} 项",
    "generalWorkbench.workflow.queue.item": "后续 {{index}}",
    "generalWorkbench.workflow.queue.pendingCount": "{{count}} 项待处理",
  };
  return (templates[key] ?? key).replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_, name: string) => String(values?.[name.trim()] ?? ""),
  );
}) as TaskRailTranslate;

function toolCall(
  overrides: Partial<AgentToolCallState> = {},
): AgentToolCallState {
  return {
    id: "tool-read",
    name: "rg",
    arguments: JSON.stringify({ query: "TaskCenterUtilityToolbar" }),
    status: "completed",
    result: {
      success: true,
      output: "找到顶部工具栏",
    },
    startTime: new Date("2026-06-16T10:00:01.000Z"),
    ...overrides,
  };
}

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "artifact-plan",
    type: "document",
    title: "agent-workspace-task-rail.md",
    content: "task rail",
    status: "complete",
    meta: {
      filePath: "internal/roadmap/agent-workspace/task-rail.md",
    },
    position: { start: 0, end: 9 },
    createdAt: new Date("2026-06-16T10:00:02.000Z").getTime(),
    updatedAt: new Date("2026-06-16T10:00:02.000Z").getTime(),
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "assistant-task",
    role: "assistant",
    content: "",
    timestamp: new Date("2026-06-16T10:00:00.000Z"),
    toolCalls: [toolCall()],
    artifacts: [artifact()],
    ...overrides,
  };
}

function statuses(
  items: Array<{ status: GeneralWorkbenchTaskRailItemStatus }>,
) {
  return items.map((item) => item.status);
}

describe("buildGeneralWorkbenchTaskRailProjection", () => {
  beforeEach(async () => {
    await changeLimeLocale("zh-CN");
  });

  it("应把步骤、工具和产物合并到同一任务轨道，并优先展示运行中步骤", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [
        { id: "read", title: "读取任务区结构", status: "completed" },
        { id: "build", title: "接入顶部任务轨道", status: "active" },
        { id: "verify", title: "验证顶部浮层", status: "pending" },
      ],
      completedSteps: 1,
      progressPercent: 33,
      messages: [assistantMessage()],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.completedCount).toBe(1);
    expect(projection.totalCount).toBe(3);
    expect(projection.activeTitle).toBe("接入顶部任务轨道");
    expect(projection.activeStatus).toBe("running");
    expect(projection.progressPercent).toBe(33);
    expect(projection.items.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["step", "tool", "artifact"]),
    );
    expect(projection.items[0]).toMatchObject({
      kind: "step",
      status: "running",
      title: "接入顶部任务轨道",
      meta: "步骤 2",
    });
    expect(projection.planItems).toEqual([
      {
        id: "read",
        title: "读取任务区结构",
        status: "completed",
        meta: "步骤 1",
      },
      {
        id: "build",
        title: "接入顶部任务轨道",
        status: "running",
        meta: "步骤 2",
      },
      {
        id: "verify",
        title: "验证顶部浮层",
        status: "pending",
        meta: "步骤 3",
      },
    ]);
    expect(projection.planOverflowCount).toBe(0);
    expect(projection.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tool",
          title: "rg",
          detail: "找到顶部工具栏",
        }),
        expect.objectContaining({
          kind: "artifact",
          title: "agent-workspace-task-rail.md",
          detail: "internal/roadmap/agent-workspace/task-rail.md",
        }),
      ]),
    );
    expect(projection.activityItems).toEqual([
      {
        id: "tool:assistant-task:tool-read:0",
        title: "rg",
        status: "completed",
        kind: "tool",
        meta: "rg",
      },
    ]);
    expect(projection.activityOverflowCount).toBe(0);
  });

  it("应将任务轨道事实收敛为运行控制面分区", () => {
    const threadRead = {
      thread_id: "thread-1",
      active_turn_id: "turn-1",
      profile_status: "running",
      context_summary: {
        sources: ["https://docs.example.com/agent-workspace"],
      },
      evidence_summary: {
        evidence_refs: ["evidence/run-control.json"],
      },
    } as any;
    const taskRailProjection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [
        { id: "discover", title: "识别运行事实", status: "completed" },
        { id: "surface", title: "整理控制面", status: "active" },
        { id: "verify", title: "验证同屏布局", status: "pending" },
      ],
      completedSteps: 1,
      progressPercent: 33,
      messages: [assistantMessage()],
      groupedActivityLogs: [
        {
          key: "run-1",
          runId: "run-1",
          status: "running",
          source: "write_file",
          gateKey: "publish_confirm",
          timeLabel: "10:30",
          artifactPaths: ["drafts/result.md"],
          logs: [
            {
              id: "log-1",
              name: "write_file",
              status: "running",
              timeLabel: "10:30",
              artifactPaths: ["drafts/result.md"],
            },
          ],
        },
      ],
      groupedCreationTaskEvents: [],
      context: {
        providerType: "cloud",
        model: "reasoner-pro",
        accessMode: "current",
        reasoningEffort: "medium",
        workspacePath: "/tmp/project-1",
        changedFileCount: 2,
        patchCount: 3,
        appliedPatchCount: 1,
        runningPatchCount: 1,
      },
      threadGoal: {
        createdAt: 1,
        objective: "把任务轨道收成同一运行控制面",
        status: "active",
        threadId: "thread-1",
        timeUsedSeconds: 0,
        tokensUsed: 0,
        updatedAt: 1,
      },
      threadRead,
      canonicalChildren: [
        {
          name: "实现",
          parentThreadId: "thread-parent",
          sessionId: "child-running",
          status: "running",
          threadId: "thread-child-running",
          updatedAtMs: 2,
        },
      ],
      t,
    });

    const projection = buildGeneralWorkbenchRunControlSurfaceProjection({
      contextItems: taskRailProjection.contextItems,
      planItems: taskRailProjection.planItems,
      planOverflowCount: taskRailProjection.planOverflowCount,
      activityItems: taskRailProjection.activityItems,
      activityOverflowCount: taskRailProjection.activityOverflowCount,
      approvalItems: taskRailProjection.approvalItems,
      approvalOverflowCount: taskRailProjection.approvalOverflowCount,
      outputItems: taskRailProjection.outputItems,
      outputOverflowCount: taskRailProjection.outputOverflowCount,
      threadRead,
      environment: {
        modeLabel: "本地",
        branchLabel: "feature/run-control",
        gitStatusLabel: "3 个文件",
      },
      splitLane: {
        state: "available",
      },
      t,
    });

    expect(projection.hasContent).toBe(true);
    expect(projection.environmentItems.map((item) => item.id)).toEqual([
      "environment-mode",
      "workspace",
      "environment-branch",
      "environment-git-status",
      "changes",
    ]);
    expect(projection.runItems.map((item) => item.id)).toEqual([
      "run-status",
      "run-thread",
      "run-turn",
    ]);
    expect(projection.controlItems.map((item) => item.id)).toEqual([
      "model",
      "permission",
      "reasoning",
    ]);
    expect(projection.goalItem?.id).toBe("objective");
    expect(projection.sourceItem?.id).toBe("sources");
    expect(projection.participantItem?.id).toBe("subtasks");
    expect(projection.splitLaneItem?.value).toBe("可打开");
    expect(projection.activitySummary?.value).toBe("1 项进行中");
    expect(projection.approvalSummary).toBeNull();
    expect(projection.outputSummary?.value).toBe("2 项");
    expect(projection.planOverflowCount).toBe(0);
  });

  it("应按运行中、失败、待处理、已完成排序", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [
        { id: "done", title: "已完成步骤", status: "completed" },
        { id: "failed", title: "失败步骤", status: "error" },
        { id: "pending", title: "待处理步骤", status: "pending" },
        { id: "running", title: "运行中步骤", status: "active" },
      ],
      completedSteps: 1,
      progressPercent: 25,
      messages: [
        assistantMessage({
          toolCalls: [toolCall({ id: "tool-failed", status: "failed" })],
          artifacts: [artifact({ id: "artifact-done" })],
        }),
      ],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(statuses(projection.items).slice(0, 4)).toEqual([
      "running",
      "failed",
      "failed",
      "pending",
    ]);
    expect(projection.items[0]?.title).toBe("运行中步骤");
  });

  it("计划列表应限制为 3 条并记录隐藏步骤数量", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [
        { id: "one", title: "第一步", status: "completed" },
        { id: "two", title: "第二步", status: "active" },
        { id: "three", title: "第三步", status: "pending" },
        { id: "four", title: "第四步", status: "pending" },
      ],
      completedSteps: 1,
      progressPercent: 25,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.planItems.map((item) => item.title)).toEqual([
      "第一步",
      "第二步",
      "第三步",
    ]);
    expect(projection.planOverflowCount).toBe(1);
  });

  it("无 revision 的历史 plan thread item 不应再驱动计划轨", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems: [
        {
          id: "plan-read",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          text: "读取当前任务区域实现",
          started_at: "2026-06-16T10:00:00.000Z",
          completed_at: "2026-06-16T10:00:01.000Z",
          updated_at: "2026-06-16T10:00:01.000Z",
        },
        {
          id: "plan-restore",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 2,
          status: "in_progress",
          text: "恢复历史计划清单",
          started_at: "2026-06-16T10:00:02.000Z",
          updated_at: "2026-06-16T10:00:03.000Z",
        },
        {
          id: "plan-verify",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 3,
          status: "failed",
          text: "补充回归验证",
          started_at: "2026-06-16T10:00:04.000Z",
          updated_at: "2026-06-16T10:00:05.000Z",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([]);
    expect(projection.planRevision).toBeNull();
    expect(projection.totalCount).toBe(0);
  });

  it("标准 PlanState 带 revision 时应优先解析 plan 文本步骤", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems: [
        {
          id: "legacy-plan-step",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          text: "旧单步计划",
          started_at: "2026-06-16T10:00:00.000Z",
          completed_at: "2026-06-16T10:00:01.000Z",
          updated_at: "2026-06-16T10:00:01.000Z",
        },
        {
          id: "standard-plan",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-2",
          sequence: 2,
          status: "completed",
          text: "- [ ] 接入标准 PlanState",
          metadata: {
            revisionId: "proposed_plan:2",
          },
          started_at: "2026-06-16T10:00:02.000Z",
          completed_at: "2026-06-16T10:00:03.000Z",
          updated_at: "2026-06-16T10:00:03.000Z",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([
      {
        id: "standard-plan:0:接入标准 PlanState",
        title: "接入标准 PlanState",
        status: "running",
        meta: "步骤 1",
      },
    ]);
    expect(projection.planRevision).toEqual({
      revisionId: "proposed_plan:2",
      label: "计划 proposed_plan:2",
      title: "当前计划版本：proposed_plan:2",
      source: "thread_item",
      turnId: "turn-2",
    });
  });

  it("workflowSteps 和 plan thread item 为空时应从 todo items 恢复计划清单", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      todoItems: [
        {
          content: "补齐 read model 恢复",
          status: "completed",
        },
        {
          content: "接入运行控制区域",
          status: "in_progress",
          active_form: "正在接入运行控制区域",
        },
        {
          content: "跑 GUI 冒烟",
          status: "pending",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([
      {
        id: "todo:0:补齐 read model 恢复",
        title: "补齐 read model 恢复",
        status: "completed",
        meta: "步骤 1",
      },
      {
        id: "todo:1:接入运行控制区域",
        title: "接入运行控制区域",
        status: "running",
        meta: "步骤 2",
      },
      {
        id: "todo:2:跑 GUI 冒烟",
        title: "跑 GUI 冒烟",
        status: "pending",
        meta: "步骤 3",
      },
    ]);
  });

  it("无 revision 的历史 plan metadata 不应再驱动计划轨", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems: [
        {
          id: "plan-update",
          type: "plan",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          text: "- [x] 读取导入事件\n- [ ] 展示计划块",
          metadata: {
            plan: [
              { step: "读取导入事件", status: "completed" },
              { step: "展示计划块", status: "in_progress" },
              { step: "补充验证", status: "pending" },
            ],
          },
          started_at: "2026-06-16T10:00:00.000Z",
          completed_at: "2026-06-16T10:00:01.000Z",
          updated_at: "2026-06-16T10:00:01.000Z",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([]);
    expect(projection.planRevision).toBeNull();
  });

  it("workflowSteps 存在时应优先使用当前步骤而不是历史 todo", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [
        { id: "current", title: "当前运行计划", status: "active" },
      ],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      todoItems: [
        {
          content: "历史待办",
          status: "pending",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([
      {
        id: "current",
        title: "当前运行计划",
        status: "running",
        meta: "步骤 1",
      },
    ]);
  });

  it("应把执行记录中的运行产物纳入同轨列表", () => {
    const activityGroup: GeneralWorkbenchActivityLogGroup = {
      key: "run-1",
      runId: "run-1",
      status: "running",
      source: "write_file",
      gateKey: "publish_confirm",
      timeLabel: "10:30",
      artifactPaths: ["drafts/result.md"],
      logs: [
        {
          id: "log-1",
          name: "write_file",
          status: "running",
          timeLabel: "10:30",
          artifactPaths: ["drafts/result.md"],
        },
      ],
    };

    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [activityGroup],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.activeTitle).toBe("执行 write_file");
    expect(projection.items[0]).toMatchObject({
      kind: "run",
      status: "running",
      detail: "产物：drafts/result.md",
      artifactPath: "drafts/result.md",
    });
    expect(projection.activityItems).toEqual([
      {
        id: "run:run-1",
        title: "执行 write_file",
        status: "running",
        kind: "run",
        meta: "publish_confirm",
      },
    ]);
    expect(projection.outputOverflowCount).toBe(0);
  });

  it("执行活动应限制为 3 条并统计隐藏数量", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [
        assistantMessage({
          toolCalls: [
            toolCall({ id: "tool-one", name: "read_file" }),
            toolCall({ id: "tool-two", name: "write_file" }),
            toolCall({ id: "tool-three", name: "shell" }),
            toolCall({ id: "tool-four", name: "rg" }),
          ],
          artifacts: [],
        }),
      ],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.activityItems).toEqual([
      expect.objectContaining({
        title: "查看文件",
        meta: "read_file",
      }),
      expect.objectContaining({
        title: "保存文件",
        meta: "write_file",
      }),
      expect.objectContaining({
        title: "运行命令",
        meta: "shell",
      }),
    ]);
    expect(projection.activityOverflowCount).toBe(1);
  });

  it("应纳入任务文件输出并统计未展开的输出数量", () => {
    const creationGroup: GeneralWorkbenchCreationTaskGroup = {
      key: "image_generate",
      taskType: "image_generate",
      label: "配图生成",
      latestTimeLabel: "11:05",
      tasks: [
        {
          taskId: "task-1",
          taskType: "image_generate",
          path: "images/one.png",
          createdAt: Date.parse("2026-06-16T11:01:00.000Z"),
          timeLabel: "11:01",
        },
        {
          taskId: "task-2",
          taskType: "image_generate",
          path: "images/two.png",
          createdAt: Date.parse("2026-06-16T11:02:00.000Z"),
          timeLabel: "11:02",
        },
      ],
    };

    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [
        assistantMessage({
          artifacts: [
            artifact({
              id: "artifact-one",
              title: "one.md",
              meta: { filePath: "docs/one.md" },
            }),
            artifact({
              id: "artifact-two",
              title: "two.md",
              meta: { filePath: "docs/two.md" },
            }),
            artifact({
              id: "artifact-three",
              title: "three.md",
              meta: { filePath: "docs/three.md" },
            }),
          ],
        }),
      ],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [creationGroup],
      t,
    });

    const outputItems = projection.items.filter(
      (item) => item.kind === "artifact" || item.artifactPath,
    );
    expect(outputItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "配图生成",
          artifactPath: "images/one.png",
        }),
        expect.objectContaining({
          title: "配图生成",
          artifactPath: "images/two.png",
        }),
        expect.objectContaining({
          title: "one.md",
          artifactPath: "docs/one.md",
        }),
      ]),
    );
    expect(projection.outputOverflowCount).toBe(1);
  });

  it("应对同一路径输出去重后再统计展示数量", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [
        assistantMessage({
          artifacts: [
            artifact({
              id: "artifact-one",
              title: "one.md",
              meta: { filePath: "docs/one.md" },
            }),
          ],
          taskPreview: {
            taskId: "task-one",
            kind: "typesetting",
            taskType: "typesetting",
            prompt: "整理 one.md",
            title: "one.md",
            status: "complete",
            artifactPath: "docs/one.md",
          },
        }),
      ],
      groupedActivityLogs: [
        {
          key: "run-1",
          runId: "run-1",
          status: "completed",
          source: "write_file",
          timeLabel: "11:10",
          artifactPaths: ["docs/one.md"],
          logs: [
            {
              id: "log-1",
              name: "write_file",
              status: "completed",
              timeLabel: "11:10",
              artifactPaths: ["docs/one.md"],
            },
          ],
        },
      ],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.outputItems).toHaveLength(1);
    expect(projection.outputItems[0]).toMatchObject({
      artifactPath: "docs/one.md",
    });
    expect(projection.outputOverflowCount).toBe(0);
  });

  it("应从恢复后的 timeline read model 投影工具、命令、搜索和文件产物", () => {
    const threadItems: AgentThreadItem[] = [
      {
        id: "tool-read",
        type: "tool_call",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        tool_name: "read_file",
        arguments: { path: "src/App.tsx" },
        output: "export function App() {}",
        success: true,
        started_at: "2026-06-16T10:00:00.000Z",
        completed_at: "2026-06-16T10:00:01.000Z",
        updated_at: "2026-06-16T10:00:01.000Z",
      },
      {
        id: "command-test",
        type: "command_execution",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 2,
        status: "completed",
        command: "npm test",
        cwd: "/tmp/project",
        aggregated_output: "1 failed",
        exit_code: 1,
        started_at: "2026-06-16T10:00:02.000Z",
        completed_at: "2026-06-16T10:00:04.000Z",
        updated_at: "2026-06-16T10:00:04.000Z",
      },
      {
        id: "web-search-news",
        type: "web_search",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        query: "agent workspace evaluation",
        output: "找到 3 个来源",
        started_at: "2026-06-16T10:00:05.000Z",
        completed_at: "2026-06-16T10:00:06.000Z",
        updated_at: "2026-06-16T10:00:06.000Z",
      },
      {
        id: "file-result",
        type: "file_artifact",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 4,
        status: "completed",
        path: "docs/result.md",
        source: "write_file",
        started_at: "2026-06-16T10:00:07.000Z",
        completed_at: "2026-06-16T10:00:08.000Z",
        updated_at: "2026-06-16T10:00:08.000Z",
      },
    ];

    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems,
      t,
    });

    expect(projection.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "thread-tool:tool-read",
          kind: "tool",
          status: "completed",
          title: "查看文件",
          detail: "export function App() {}",
          meta: "read_file",
        }),
        expect.objectContaining({
          id: "thread-command:command-test",
          kind: "run",
          status: "failed",
          title: "执行 npm test",
          detail: "1 failed",
          meta: "exit 1",
        }),
        expect.objectContaining({
          id: "thread-web-search:web-search-news",
          kind: "run",
          status: "completed",
          title: "执行 agent workspace evaluation",
          detail: "找到 3 个来源",
          meta: "web_search",
        }),
        expect.objectContaining({
          id: "thread-file-artifact:file-result",
          kind: "artifact",
          status: "completed",
          title: "result.md",
          detail: "docs/result.md",
          artifactPath: "docs/result.md",
        }),
      ]),
    );
    expect(projection.activeTitle).toBe("执行 npm test");
    expect(projection.activeStatus).toBe("failed");
    expect(projection.activityItems).toEqual([
      expect.objectContaining({
        id: "thread-command:command-test",
        status: "failed",
        title: "执行 npm test",
      }),
      expect.objectContaining({
        id: "thread-web-search:web-search-news",
        status: "completed",
        title: "执行 agent workspace evaluation",
      }),
      expect.objectContaining({
        id: "thread-tool:tool-read",
        status: "completed",
        title: "查看文件",
      }),
    ]);
    expect(projection.outputItems).toEqual([
      expect.objectContaining({
        id: "thread-file-artifact:file-result",
        artifactPath: "docs/result.md",
      }),
    ]);
  });

  it("message toolCall update_plan 结果不应直接驱动计划轨", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [
        assistantMessage({
          toolCalls: [
            toolCall({
              id: "tool-plan",
              name: "update_plan",
              result: {
                success: true,
                output: "Plan updated",
                metadata: {
                  plan: [
                    { step: "读取计划工具", status: "completed" },
                    { step: "接入 Lime 工具面", status: "in_progress" },
                    { step: "验证前端计划显示", status: "pending" },
                  ],
                },
              },
            }),
          ],
          artifacts: [],
        }),
      ],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.planItems).toEqual([]);
    expect(projection.planRevision).toBeNull();
    expect(projection.activityItems).toEqual([]);
  });

  it("workflowSteps 为空时应从最新 proposed_plan 恢复结构化计划", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [
        assistantMessage({
          id: "assistant-plan",
          content:
            "先说明\n<proposed_plan>\n- 确认计划模式请求进入 App Server\n- 输出结构化 proposed_plan\n- 验证右侧计划轨显示\n</proposed_plan>\n计划已生成。",
          toolCalls: [],
          artifacts: [],
        }),
      ],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.planItems).toEqual([
      {
        id: "message-proposed-plan:assistant-plan:0:确认计划模式请求进入 App Server",
        title: "确认计划模式请求进入 App Server",
        status: "running",
        meta: "步骤 1",
      },
      {
        id: "message-proposed-plan:assistant-plan:1:输出结构化 proposed_plan",
        title: "输出结构化 proposed_plan",
        status: "pending",
        meta: "步骤 2",
      },
      {
        id: "message-proposed-plan:assistant-plan:2:验证右侧计划轨显示",
        title: "验证右侧计划轨显示",
        status: "pending",
        meta: "步骤 3",
      },
    ]);
  });

  it("历史 update_plan tool_call 只作为去重过滤且不驱动计划轨", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems: [
        {
          id: "thread-update-plan",
          type: "tool_call",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          tool_name: "UpdatePlanTool",
          output: "Plan updated",
          success: true,
          metadata: {
            plan: [
              { step: "恢复历史计划", status: "completed" },
              { step: "展示环境浮层", status: "inProgress" },
            ],
          },
          started_at: "2026-06-16T10:00:00.000Z",
          completed_at: "2026-06-16T10:00:01.000Z",
          updated_at: "2026-06-16T10:00:01.000Z",
        },
      ],
      t,
    });

    expect(projection.planItems).toEqual([]);
    expect(projection.planRevision).toBeNull();
    expect(projection.items).toEqual([]);
  });

  it("没有步骤时应展示发送任务后的空态提示", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      t,
    });

    expect(projection.items).toEqual([]);
    expect(projection.emptyText).toBe("发送任务后，这里会显示进度和输出。");
  });

  it("应把运行摘要投影为短标签并只在工作区显示目录名", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      context: {
        providerType: "cloud",
        model: "reasoner-pro",
        accessMode: "current",
        reasoningEffort: "medium",
        workspacePath: "/tmp/project",
        objectiveText: "完成顶部任务轨道运行事实摘要",
        changedFileCount: 2,
        changedFiles: ["src/App.tsx", "src/index.ts"],
        patchCount: 3,
        failedPatchCount: 1,
        sourceCount: 4,
        sourceEvidenceCount: 0,
        sourceLabels: [
          "AG-UI spec",
          "https://example.com/report",
          "docs/context.md",
        ],
        subtaskTotalCount: 3,
        subtaskActiveCount: 1,
        subtaskCompletedCount: 1,
        subtaskFailedCount: 1,
      },
      t,
    });

    expect(projection.contextItems).toEqual([
      {
        id: "model",
        label: "模型",
        value: "cloud / reasoner-pro",
      },
      {
        id: "permission",
        label: "权限",
        value: "按需确认",
      },
      {
        id: "reasoning",
        label: "思考",
        value: "中",
      },
      {
        id: "workspace",
        label: "工作区",
        value: "project",
        title: "/tmp/project",
      },
      {
        id: "objective",
        label: "目标",
        value: "完成顶部任务轨道运行事实摘要",
        title: "完成顶部任务轨道运行事实摘要",
      },
      {
        id: "changes",
        label: "变更",
        value: "2 文件",
        title: "变更 2 文件，1 个补丁失败 · src/App.tsx / src/index.ts",
      },
      {
        id: "sources",
        label: "来源",
        value: "4 项",
        title: "来源：AG-UI spec / example.com / context.md，另有 1 项",
        detailLabels: ["AG-UI spec", "example.com", "context.md"],
        detailOverflowLabel: "另有 1 项",
        detailStatus: {
          label: "待补证据",
          tone: "warning",
          title: "已有 4 个来源，缺少证据引用",
        },
      },
      {
        id: "subtasks",
        label: "子任务",
        value: "1/3",
        title: "子任务 1 个需处理，1/3 完成",
      },
    ]);
  });

  it("应从 threadRead 和子任务会话补齐任务轨道运行事实", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadGoal: {
        createdAt: 1,
        objective: "完成任务区域事实摘要",
        status: "active",
        threadId: "thread-1",
        timeUsedSeconds: 0,
        tokensUsed: 0,
        updatedAt: 1,
      },
      threadRead: {
        thread_id: "thread-1",
        context_summary: {
          source: "workspace",
          sources: ["https://docs.example.com/agent-workspace"],
          retrieval_refs: [
            {
              source_id: "retrieval-1",
              kind: "file",
              title: "run-observability.md",
              path: "internal/roadmap/agent-workspace/run-observability.md",
            },
          ],
          team_memory_refs: [
            {
              key: "agent-workspace-principles",
            },
          ],
        },
        evidence_summary: {
          evidence_refs: ["evidence/run-control.json"],
        },
        artifacts: [
          {
            path: "internal/roadmap/agent-workspace/sources.md",
          },
        ],
        change_summary: {
          changed_file_count: 1,
          changed_files: ["src/App.tsx"],
          patch_count: 1,
          running_patch_count: 1,
        },
      } as any,
      canonicalChildren: [
        {
          name: "实现",
          parentThreadId: "thread-parent",
          sessionId: "child-running",
          status: "running",
          threadId: "thread-child-running",
          updatedAtMs: 2,
        },
        {
          name: "验证",
          parentThreadId: "thread-parent",
          sessionId: "child-done",
          status: "completed",
          threadId: "thread-child-done",
          updatedAtMs: 2,
        },
      ],
      t,
    });

    expect(projection.contextItems).toEqual(
      expect.arrayContaining([
        {
          id: "objective",
          label: "目标",
          value: "完成任务区域事实摘要",
          title: "完成任务区域事实摘要",
        },
        {
          id: "changes",
          label: "变更",
          value: "1 文件",
          title: "变更 1 文件，1 个补丁进行中 · src/App.tsx",
        },
        {
          id: "sources",
          label: "来源",
          value: "6 项",
          title:
            "来源：workspace / docs.example.com / run-observability.md，另有 3 项",
          detailLabels: [
            "workspace",
            "docs.example.com",
            "run-observability.md",
          ],
          detailOverflowLabel: "另有 3 项",
          detailStatus: {
            label: "已关联",
            tone: "success",
            title: "已关联 1 条证据",
          },
        },
        {
          id: "subtasks",
          label: "子任务",
          value: "1/2",
          title: "子任务 1 个进行中，1/2 完成",
        },
      ]),
    );
  });

  it("应从搜索和文件 thread item 补齐来源摘要", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems: [
        {
          id: "web-search",
          type: "web_search",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          query: "agent workspace evaluation",
          started_at: "2026-06-16T10:00:00.000Z",
          completed_at: "2026-06-16T10:00:01.000Z",
          updated_at: "2026-06-16T10:00:01.000Z",
        },
        {
          id: "file-source",
          type: "file_artifact",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 2,
          status: "completed",
          path: "docs/sources.md",
          source: "write_file",
          started_at: "2026-06-16T10:00:02.000Z",
          completed_at: "2026-06-16T10:00:03.000Z",
          updated_at: "2026-06-16T10:00:03.000Z",
        },
      ],
      t,
    });

    expect(projection.contextItems).toEqual(
      expect.arrayContaining([
        {
          id: "sources",
          label: "来源",
          value: "2 项",
          title: "来源：agent workspace evaluation / sources.md",
          detailLabels: ["agent workspace evaluation", "sources.md"],
          detailOverflowLabel: null,
          detailStatus: {
            label: "待补证据",
            tone: "warning",
            title: "已有 2 个来源，缺少证据引用",
          },
        },
      ]),
    );
  });

  it("本地历史导入 metadata 不应进入主线任务 rail，只保留来源证据", () => {
    const sourceProvenance = {
      sourceClient: "codex",
      sourceThreadId: "thread-codex-20260617abcdef",
      sourcePath:
        "/Users/coso/.lime/sessions/2026/06/17/rollout-thread-codex-20260617abcdef.jsonl",
      sourceEventType: "response_item",
      payloadType: "function_call",
      callId: "call-shell",
    };
    const codexImportFidelity = {
      messages: 6,
      reasoning: 2,
      tools: 4,
      commands: 1,
      patches: 1,
      approvals: 1,
      webSearch: 1,
      unsupported: 0,
      budgetDropped: 0,
    };
    const threadItems: AgentThreadItem[] = [
      {
        id: "codex-command",
        type: "command_execution",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        command: "npm test",
        cwd: "/workspace/imported-codex",
        aggregated_output: "ok",
        exit_code: 0,
        metadata: {
          source_client: "codex",
          source_provenance: sourceProvenance,
          codexImportFidelity,
        },
        started_at: "2026-06-17T10:00:00.000Z",
        completed_at: "2026-06-17T10:00:01.000Z",
        updated_at: "2026-06-17T10:00:01.000Z",
      },
      {
        id: "codex-patch",
        type: "patch",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 2,
        status: "completed",
        text: "Patch changed src/App.tsx",
        paths: ["src/App.tsx"],
        success: true,
        metadata: {
          source_client: "codex",
          source_provenance: {
            ...sourceProvenance,
            payloadType: "patch_apply_end",
            callId: "call-patch",
          },
        },
        started_at: "2026-06-17T10:00:02.000Z",
        completed_at: "2026-06-17T10:00:03.000Z",
        updated_at: "2026-06-17T10:00:03.000Z",
      },
      {
        id: "codex-search",
        type: "web_search",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        query: "Imported thread model",
        output: "found sources",
        metadata: {
          source_client: "codex",
          source_provenance: {
            ...sourceProvenance,
            payloadType: "web_search",
            callId: "call-search",
          },
        },
        started_at: "2026-06-17T10:00:04.000Z",
        completed_at: "2026-06-17T10:00:05.000Z",
        updated_at: "2026-06-17T10:00:05.000Z",
      },
      {
        id: "codex-approval",
        type: "approval_request",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 4,
        status: "completed",
        request_id: "approval-shell",
        action_type: "tool_confirmation",
        prompt: "Allow npm test?",
        tool_name: "shell",
        response: { decision: "approved", imported_read_only: true },
        metadata: {
          source_client: "codex",
          source_provenance: {
            ...sourceProvenance,
            payloadType: "exec_approval_request",
            callId: "approval-shell",
          },
        },
        started_at: "2026-06-17T10:00:06.000Z",
        completed_at: "2026-06-17T10:00:07.000Z",
        updated_at: "2026-06-17T10:00:07.000Z",
      },
    ];

    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadItems,
      t,
    });

    expect(projection.contextItems).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "imported-source",
        }),
      ]),
    );
    expect(projection.contextItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "sources",
          label: "来源",
          value: "1 项",
          title: "来源：Imported thread model",
          detailLabels: ["Imported thread model"],
        }),
      ]),
    );
    const sourcesItem = projection.contextItems.find(
      (item) => item.id === "sources",
    );
    expect(sourcesItem?.title).not.toContain("codex");
    expect(sourcesItem?.title).not.toContain(".lime");
    expect(sourcesItem?.title).not.toContain("rollout-thread");

    const runControlProjection =
      buildGeneralWorkbenchRunControlSurfaceProjection({
        contextItems: projection.contextItems,
        planItems: projection.planItems,
        planOverflowCount: projection.planOverflowCount,
        activityItems: projection.activityItems,
        activityOverflowCount: projection.activityOverflowCount,
        approvalItems: projection.approvalItems,
        approvalOverflowCount: projection.approvalOverflowCount,
        outputItems: projection.outputItems,
        outputOverflowCount: projection.outputOverflowCount,
        threadRead: { thread_id: "thread-1" },
        t,
      });

    expect(runControlProjection.sourceItem).toEqual(
      expect.objectContaining({
        id: "sources",
        value: "1 项",
      }),
    );
    expect(runControlProjection).not.toHaveProperty("importedItem");
    expect(projection.approvalItems).toEqual([
      expect.objectContaining({
        id: "approval-resolved:approval-shell",
        title: "Allow npm test?",
        status: "resolved",
        canRespond: false,
      }),
    ]);
    expect(projection.approvalItems[0]?.title).not.toContain("导入");
  });

  it("缺少上下文来源时应展示待补来源状态", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      threadRead: {
        thread_id: "thread-1",
        context_summary: {
          missing_context: [
            {
              kind: "source",
              label: "需要引用原始报告",
              status: "missing",
            },
          ],
        },
      },
      t,
    });

    expect(projection.contextItems).toEqual([
      {
        id: "sources",
        label: "来源",
        value: "0 项",
        title: null,
        detailLabels: [],
        detailOverflowLabel: null,
        detailStatus: {
          label: "待补来源",
          tone: "warning",
          title: "缺少 1 项上下文来源",
        },
      },
    ]);
  });

  it("应从待确认请求和提交中请求派生轻量审批摘要", () => {
    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      pendingActions: [
        {
          requestId: "approval-write",
          actionType: "tool_confirmation",
          toolName: "write_file",
          prompt: "允许保存 result.md？",
        },
        {
          requestId: "question-topic",
          actionType: "ask_user",
          questions: [{ question: "继续写哪一节？" }],
        },
        {
          requestId: "approval-shell",
          actionType: "tool_confirmation",
          toolName: "shell",
          prompt: "允许运行 npm test？",
          status: "queued",
        },
      ],
      submittedActionsInFlight: [
        {
          requestId: "approval-write",
          actionType: "tool_confirmation",
          toolName: "write_file",
          status: "submitted",
        },
      ],
      t,
    });

    expect(projection.approvalItems).toEqual([
      {
        id: "approval:approval-write",
        requestId: "approval-write",
        actionType: "tool_confirmation",
        title: "允许保存 result.md？",
        detail: null,
        status: "submitted",
        canRespond: false,
      },
      {
        id: "approval:question-topic",
        requestId: "question-topic",
        actionType: "ask_user",
        title: "等待回答",
        detail: "继续写哪一节？",
        status: "pending",
        canRespond: false,
      },
    ]);
    expect(projection.approvalOverflowCount).toBe(1);
  });

  it("应从已完成 timeline 派生已处理确认，并让待确认请求优先展示", () => {
    const threadItems: AgentThreadItem[] = [
      {
        id: "approval-write-item",
        type: "approval_request",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        request_id: "approval-write",
        action_type: "tool_confirmation",
        prompt: "允许保存 result.md？",
        tool_name: "write_file",
        response: "approved",
        started_at: "2026-06-16T10:00:00.000Z",
        completed_at: "2026-06-16T10:00:03.000Z",
        updated_at: "2026-06-16T10:00:03.000Z",
      },
      {
        id: "question-topic-item",
        type: "request_user_input",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 2,
        status: "completed",
        request_id: "question-topic",
        action_type: "ask_user",
        questions: [{ question: "继续写哪一节？" }],
        response: { answer: "先写评测标准" },
        started_at: "2026-06-16T10:00:01.000Z",
        completed_at: "2026-06-16T10:00:04.000Z",
        updated_at: "2026-06-16T10:00:04.000Z",
      },
      {
        id: "approval-shell-item",
        type: "approval_request",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "completed",
        request_id: "approval-shell",
        action_type: "tool_confirmation",
        prompt: "允许运行 npm test？",
        tool_name: "shell",
        response: "rejected",
        started_at: "2026-06-16T10:00:02.000Z",
        completed_at: "2026-06-16T10:00:05.000Z",
        updated_at: "2026-06-16T10:00:05.000Z",
      },
    ];

    const projection = buildGeneralWorkbenchTaskRailProjection({
      workflowSteps: [],
      completedSteps: 0,
      progressPercent: 0,
      messages: [],
      groupedActivityLogs: [],
      groupedCreationTaskEvents: [],
      pendingActions: [
        {
          requestId: "approval-write",
          actionType: "tool_confirmation",
          toolName: "write_file",
          prompt: "允许重新保存 result.md？",
        },
      ],
      threadItems,
      t,
    });

    expect(projection.approvalItems).toEqual([
      {
        id: "approval:approval-write",
        requestId: "approval-write",
        actionType: "tool_confirmation",
        title: "允许重新保存 result.md？",
        detail: null,
        status: "pending",
        canRespond: true,
      },
      {
        id: "approval-resolved:approval-shell",
        requestId: "approval-shell",
        actionType: "tool_confirmation",
        title: "允许运行 npm test？",
        detail: null,
        status: "rejected",
        canRespond: false,
      },
    ]);
    expect(projection.approvalOverflowCount).toBe(1);
  });
});
