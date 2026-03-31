import type {
  SchedulerExecutionResult,
  SchedulerProgress,
  SubAgentTask,
} from "@/lib/api/subAgentScheduler";

function normalizeText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateSummary(value: string, maxLength = 56): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function summarizeSubAgentTask(task: SubAgentTask): string {
  return truncateSummary(
    normalizeText(task.description) ||
      normalizeText(task.prompt) ||
      normalizeText(task.taskType) ||
      task.id,
  );
}

export function summarizeSubAgentTaskBatch(tasks: SubAgentTask[]): string | null {
  if (tasks.length === 0) {
    return null;
  }

  if (tasks.length === 1) {
    return `准备执行：${summarizeSubAgentTask(tasks[0])}`;
  }

  const labels = Array.from(
    new Set(tasks.map(summarizeSubAgentTask).filter((item) => item.length > 0)),
  );
  const preview = labels.slice(0, 2).join("、");
  const suffix =
    labels.length > 2 ? ` 等 ${labels.length} 项` : ` 共 ${tasks.length} 项`;
  return `准备执行：${preview}${suffix}`;
}

export function summarizeSubAgentProgress(
  progress: SchedulerProgress,
): string | null {
  if (progress.currentTasks.length > 0) {
    return `正在执行：${progress.currentTasks.join("、")}`;
  }

  const finished = progress.completed + progress.failed + progress.skipped;
  return `进度 ${finished}/${progress.total}`;
}

export function summarizeSubAgentResult(
  result: SchedulerExecutionResult,
  tasks: SubAgentTask[],
): string | null {
  const mergedSummary = normalizeText(result.mergedSummary);
  if (mergedSummary) {
    return truncateSummary(mergedSummary, 72);
  }

  if (result.failedCount > 0 && result.successfulCount > 0) {
    return `已完成 ${result.successfulCount} 项，失败 ${result.failedCount} 项`;
  }

  if (result.failedCount > 0) {
    return `子任务失败 ${result.failedCount} 项`;
  }

  if (
    tasks.length === 1 &&
    result.failedCount === 0 &&
    result.skippedCount === 0 &&
    (result.successfulCount === 1 ||
      (result.success === true && result.successfulCount === 0))
  ) {
    return `已完成：${summarizeSubAgentTask(tasks[0])}`;
  }

  if (result.successfulCount > 0) {
    return `已完成 ${result.successfulCount} 项子任务`;
  }

  if (result.skippedCount > 0) {
    return `已跳过 ${result.skippedCount} 项子任务`;
  }

  return null;
}
