import { useMemo } from "react";
import type { StepStatus } from "@/lib/workspace/workbenchContract";

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

  const workflowQueueItems = useMemo(() => {
    if (!isWorkspaceVariant) {
      return [];
    }

    const visibleSteps = workflowSteps
      .filter(
        (step) => step.status !== "completed" && step.status !== "skipped",
      )
      .slice(0, 3);

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
  }, [isWorkspaceVariant, workflowGate, workflowSteps]);

  const renderWorkflowGeneratingPanel = isWorkspaceVariant
    ? workflowRunState
      ? workflowRunState === "auto_running"
      : isSending
    : false;

  return {
    workflowQuickActions,
    workflowQueueItems,
    renderWorkflowGeneratingPanel,
  };
}
