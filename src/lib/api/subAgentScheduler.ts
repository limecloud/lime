import { invoke } from "@tauri-apps/api/core";

export interface SubAgentTask {
  id: string;
  taskType: string;
  prompt: string;
  description?: string;
  priority?: number;
  dependencies?: string[];
  timeout?: number;
  model?: string;
  returnSummary?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
  maxTokens?: number;
}

export interface SubAgentResult {
  taskId: string;
  success: boolean;
  output?: string;
  summary?: string;
  error?: string;
  durationMs: number;
  retries: number;
}

export interface SchedulerProgress {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
  skipped: number;
  cancelled: boolean;
  currentTasks: string[];
  percentage: number;
}

export type SchedulerEvent =
  | { type: "started"; totalTasks: number }
  | { type: "taskStarted"; taskId: string; taskType: string }
  | { type: "taskCompleted"; taskId: string; durationMs: number }
  | { type: "taskFailed"; taskId: string; error: string }
  | { type: "taskRetry"; taskId: string; retryCount: number }
  | { type: "taskSkipped"; taskId: string; reason: string }
  | { type: "progress"; progress: SchedulerProgress }
  | { type: "completed"; success: boolean; durationMs: number }
  | { type: "cancelled" };

export interface SchedulerExecutionResult {
  success: boolean;
  results: SubAgentResult[];
  totalDurationMs: number;
  successfulCount: number;
  failedCount: number;
  skippedCount: number;
  mergedSummary?: string;
  totalTokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface SchedulerConfig {
  maxConcurrency?: number;
  defaultTimeoutMs?: number;
  retryOnFailure?: boolean;
  stopOnFirstError?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  autoSummarize?: boolean;
  summaryMaxTokens?: number;
  defaultModel?: string;
}

export async function executeSubAgentTasks(
  tasks: SubAgentTask[],
  config?: SchedulerConfig,
  sessionId?: string | null,
): Promise<SchedulerExecutionResult> {
  return invoke<SchedulerExecutionResult>("execute_subagent_tasks", {
    tasks,
    config,
    sessionId,
  });
}

export async function cancelSubAgentTasks(): Promise<void> {
  await invoke("cancel_subagent_tasks");
}
