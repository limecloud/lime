import type { StepStatus } from "@/lib/workspace/workbenchContract";

type WorkflowStepLike = {
  status: StepStatus;
};

export interface WorkflowStepSnapshot<TStep> {
  sortedSteps: TStep[];
  openSteps: TStep[];
  visibleQueueItems: TStep[];
  leadingStep: TStep | null;
  remainingCount: number;
  completedCount: number;
  totalCount: number;
}

export interface WorkflowSummaryOptions<TStep> {
  leadingStep: TStep | null;
  remainingCount: number;
  emptyLabel?: string;
}

const WORKFLOW_STEP_STATUS_PRIORITY: Record<StepStatus, number> = {
  active: 0,
  error: 1,
  pending: 2,
  completed: 3,
  skipped: 4,
};

export function isWorkflowOpenStatus(status: StepStatus): boolean {
  return status !== "completed" && status !== "skipped";
}

export function sortWorkflowStepsForDisplay<TStep extends WorkflowStepLike>(
  steps: readonly TStep[],
): TStep[] {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const priorityDelta =
        WORKFLOW_STEP_STATUS_PRIORITY[left.step.status] -
        WORKFLOW_STEP_STATUS_PRIORITY[right.step.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.index - right.index;
    })
    .map(({ step }) => step);
}

export function buildWorkflowStepSnapshot<TStep extends WorkflowStepLike>(
  steps: readonly TStep[],
  visibleQueueLimit = 3,
): WorkflowStepSnapshot<TStep> {
  const sortedSteps = sortWorkflowStepsForDisplay(steps);
  const openSteps = sortedSteps.filter((step) =>
    isWorkflowOpenStatus(step.status),
  );
  const completedCount = steps.filter(
    (step) => step.status === "completed",
  ).length;

  return {
    sortedSteps,
    openSteps,
    visibleQueueItems: openSteps.slice(0, Math.max(0, visibleQueueLimit)),
    leadingStep: openSteps[0] ?? null,
    remainingCount: openSteps.length,
    completedCount,
    totalCount: steps.length,
  };
}

export function buildWorkflowSummaryText<TStep extends WorkflowStepLike>({
  leadingStep,
  remainingCount,
  emptyLabel = "当前流程已完成",
}: WorkflowSummaryOptions<TStep>): string {
  if (!leadingStep) {
    return emptyLabel;
  }

  const trailingCount = Math.max(remainingCount - 1, 0);
  if (leadingStep.status === "error") {
    return trailingCount > 0
      ? `当前步骤异常，另有 ${trailingCount} 项待处理`
      : "当前步骤异常，请先处理";
  }
  if (leadingStep.status === "pending") {
    return trailingCount > 0
      ? `等待启动，后续还有 ${trailingCount} 项待处理`
      : "等待启动";
  }
  return trailingCount > 0
    ? `正在推进，后续还有 ${trailingCount} 项待处理`
    : "正在推进最后一步";
}

export function formatWorkflowProgressLabel(params: {
  completedCount: number;
  totalCount: number;
}): string {
  const { completedCount, totalCount } = params;
  if (totalCount <= 0) {
    return "等待开始";
  }
  return `已完成 ${completedCount}/${totalCount}`;
}

export function getWorkflowStatusLabel(status: StepStatus): string {
  if (status === "active") {
    return "进行中";
  }
  if (status === "error") {
    return "异常";
  }
  if (status === "pending") {
    return "待处理";
  }
  if (status === "completed") {
    return "已完成";
  }
  return "已跳过";
}
