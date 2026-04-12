import { useMemo } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";
import {
  buildWorkflowStepSnapshot,
  buildWorkflowSummaryText,
  formatWorkflowProgressLabel,
} from "./workflowStepPresentation";

export interface WorkflowGateState {
  key: string;
  title: string;
  status: "running" | "waiting" | "idle";
  description: string;
}

export interface WorkflowStep {
  id: string;
  title: string;
  status: StepStatus;
}

export interface WorkflowQuickAction {
  id: string;
  label: string;
  prompt: string;
}

interface UseWorkflowInputStateParams {
  isWorkspaceVariant: boolean;
  workflowGate?: WorkflowGateState | null;
  workflowSteps?: WorkflowStep[];
  workflowRunState?: "idle" | "auto_running" | "await_user_decision";
  isSending: boolean;
}

function resolveWorkflowQuickActions(gateKey?: string): WorkflowQuickAction[] {
  switch (gateKey) {
    case "topic_select":
      return [
        {
          id: "topic-options",
          label: "生成 3 个选题",
          prompt: "请给我 3 个可执行选题方向，并说明目标读者与传播价值。",
        },
        {
          id: "topic-choose-b",
          label: "采纳 B 方向",
          prompt: "我采纳 B 方向，请继续推进主稿与配图编排。",
        },
      ];
    case "write_mode":
      return [
        {
          id: "write-fast",
          label: "快速模式出稿",
          prompt: "请按快速模式生成可发布主稿，并标注可优化段落。",
        },
        {
          id: "write-coach",
          label: "教练模式引导",
          prompt: "请按教练模式逐步提问我，帮助补充真实案例后再成稿。",
        },
      ];
    case "publish_confirm":
      return [
        {
          id: "publish-checklist",
          label: "发布前检查",
          prompt: "请给我发布前检查清单，包含标题、封面、平台合规与风险项。",
        },
        {
          id: "publish-now",
          label: "进入发布整理",
          prompt: "请整理最终发布稿，并输出配套标题、摘要和封面文案。",
        },
      ];
    default:
      return [
        {
          id: "next-step",
          label: "继续编排",
          prompt: "请继续按照当前编排推进，并在关键闸门前向我确认。",
        },
      ];
  }
}

export function useWorkflowInputState({
  isWorkspaceVariant,
  workflowGate,
  workflowSteps = [],
  workflowRunState,
  isSending,
}: UseWorkflowInputStateParams) {
  const workflowQuickActions = useMemo(
    () =>
      isWorkspaceVariant ? resolveWorkflowQuickActions(workflowGate?.key) : [],
    [isWorkspaceVariant, workflowGate?.key],
  );

  const workflowStepSnapshot = useMemo(
    () =>
      isWorkspaceVariant ? buildWorkflowStepSnapshot(workflowSteps, 3) : null,
    [isWorkspaceVariant, workflowSteps],
  );

  const workflowActiveItem = workflowStepSnapshot?.leadingStep ?? null;

  const workflowQueueTotalCount = useMemo(() => {
    if (!isWorkspaceVariant) {
      return 0;
    }
    if (workflowStepSnapshot && workflowStepSnapshot.remainingCount > 0) {
      return workflowStepSnapshot.remainingCount;
    }
    return workflowGate ? 1 : 0;
  }, [isWorkspaceVariant, workflowGate, workflowStepSnapshot]);

  const workflowSummaryLabel = useMemo(
    () => {
      if (workflowActiveItem) {
        return buildWorkflowSummaryText({
          leadingStep: workflowActiveItem,
          remainingCount: workflowQueueTotalCount,
        });
      }
      if (workflowGate?.status === "waiting") {
        return "等待你的决策后继续";
      }
      if (workflowGate?.status === "running") {
        return "正在编排下一步";
      }
      return "正在整理任务节奏";
    },
    [workflowGate, workflowActiveItem, workflowQueueTotalCount],
  );

  const workflowCompletedCount = workflowStepSnapshot?.completedCount ?? 0;
  const workflowTotalCount = workflowStepSnapshot?.totalCount ?? workflowSteps.length;
  const workflowProgressLabel = useMemo(
    () =>
      formatWorkflowProgressLabel({
        completedCount: workflowCompletedCount,
        totalCount: workflowTotalCount,
      }),
    [workflowCompletedCount, workflowTotalCount],
  );

  const workflowQueueItems = useMemo(() => {
    if (!isWorkspaceVariant) {
      return [];
    }

    const visibleSteps = workflowStepSnapshot?.visibleQueueItems ?? [];

    if (visibleSteps.length > 0) {
      return visibleSteps;
    }

    if (workflowGate) {
      return [
        {
          id: `gate-${workflowGate.key}`,
          title: workflowGate.title,
          status:
            workflowGate.status === "waiting"
              ? ("pending" as StepStatus)
              : ("active" as StepStatus),
        },
      ];
    }

    return [];
  }, [isWorkspaceVariant, workflowGate, workflowStepSnapshot]);

  const renderWorkflowGeneratingPanel = isWorkspaceVariant
    ? workflowRunState
      ? workflowRunState === "auto_running"
      : isSending
    : false;

  return {
    workflowQuickActions,
    workflowQueueItems,
    workflowActiveItem,
    workflowQueueTotalCount,
    workflowCompletedCount,
    workflowTotalCount,
    workflowProgressLabel,
    workflowSummaryLabel,
    renderWorkflowGeneratingPanel,
  };
}
