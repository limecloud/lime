import type {
  SchedulerEvent,
  SchedulerExecutionResult,
  SchedulerProgress,
} from "@/lib/api/subAgentScheduler";

export type CompatSubagentEvent = SchedulerEvent;
export type CompatSubagentProgress = SchedulerProgress;

export interface CompatSubagentRuntimeState {
  isRunning: boolean;
  progress: CompatSubagentProgress | null;
  events: CompatSubagentEvent[];
  result: SchedulerExecutionResult | null;
  error: string | null;
}

export interface CompatSubagentRuntimeActivity {
  id: string;
  summary: string;
}

export interface CompatSubagentRuntimeStatus {
  isRunning: boolean;
  progress: CompatSubagentProgress | null;
}

export interface CompatSubagentRuntimeDisplaySnapshot
  extends CompatSubagentRuntimeStatus {
  error: string | null;
  result: SchedulerExecutionResult | null;
  recentActivity: CompatSubagentRuntimeActivity[];
  hasSignals: boolean;
}

export interface CompatSubagentRuntimeSnapshot
  extends CompatSubagentRuntimeState,
    CompatSubagentRuntimeDisplaySnapshot {}

export function summarizeCompatSubagentEvent(
  event: CompatSubagentEvent,
): string {
  switch (event.type) {
    case "started":
      return `开始调度 ${event.totalTasks} 个子任务`;
    case "queueRejected":
      return `队列已拒绝：请求 ${event.requested}，上限 ${event.limit}`;
    case "taskStarted":
      return `任务 ${event.taskId} 开始执行`;
    case "taskCompleted":
      return `任务 ${event.taskId} 已完成`;
    case "taskTimedOut":
      return `任务 ${event.taskId} 超时：${event.timeoutMs} ms`;
    case "taskFailed":
      return `任务 ${event.taskId} 失败：${event.error}`;
    case "taskRetry":
      return `任务 ${event.taskId} 重试第 ${event.retryCount} 次`;
    case "taskSkipped":
      return `任务 ${event.taskId} 已跳过：${event.reason}`;
    case "progress":
      return `进度 ${event.progress.completed}/${event.progress.total}`;
    case "completed":
      return `调度完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`;
    case "cancelled":
      return "调度已取消";
    default:
      return (event as { type: string }).type;
  }
}

export function buildCompatSubagentRuntimeSnapshot(
  state: CompatSubagentRuntimeState,
): CompatSubagentRuntimeSnapshot {
  const recentActivity = state.events
    .slice(-4)
    .reverse()
    .map((event, index, collection) => ({
      id: `compat:${collection.length - index}:${event.type}`,
      summary: summarizeCompatSubagentEvent(event),
    }));

  return {
    ...state,
    recentActivity,
    hasSignals:
      state.isRunning ||
      state.events.length > 0 ||
      Boolean(state.error) ||
      Boolean(state.result),
  };
}
