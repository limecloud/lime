/**
 * SubAgent 调度器 Hook
 *
 * 提供 SubAgent 调度功能的 React 集成
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeListen } from "@/lib/dev-bridge";
import {
  cancelSubAgentTasks,
  executeSubAgentTasks,
  type SchedulerConfig,
  type SchedulerEvent,
  type SchedulerExecutionResult,
  type SchedulerProgress,
  type SubAgentTask,
} from "@/lib/api/subAgentScheduler";
import {
  summarizeSubAgentProgress,
  summarizeSubAgentResult,
  summarizeSubAgentTaskBatch,
} from "./subAgentSummary";

export type {
  SchedulerConfig,
  SchedulerEvent,
  SchedulerExecutionResult,
  SchedulerProgress,
  SubAgentResult,
  SubAgentTask,
} from "@/lib/api/subAgentScheduler";

type SchedulerEventEnvelope = SchedulerEvent & {
  sessionId?: string;
  session_id?: string;
};

/**
 * Hook 状态
 */
interface UseSubAgentSchedulerState {
  isRunning: boolean;
  progress: SchedulerProgress | null;
  events: SchedulerEvent[];
  result: SchedulerExecutionResult | null;
  error: string | null;
  summary: string | null;
}

/**
 * Hook 返回值
 */
interface UseSubAgentSchedulerReturn extends UseSubAgentSchedulerState {
  execute: (
    tasks: SubAgentTask[],
    config?: SchedulerConfig,
  ) => Promise<SchedulerExecutionResult>;
  cancel: () => Promise<void>;
  clearEvents: () => void;
}

const INITIAL_STATE: UseSubAgentSchedulerState = {
  isRunning: false,
  progress: null,
  events: [],
  result: null,
  error: null,
  summary: null,
};

export function resolveSchedulerEventSessionId(
  event: Partial<Pick<SchedulerEventEnvelope, "sessionId" | "session_id">>,
): string | null {
  const sessionId = event.sessionId || event.session_id;
  if (typeof sessionId !== "string") {
    return null;
  }

  const normalized = sessionId.trim();
  return normalized || null;
}

export function shouldConsumeSchedulerEvent(
  event: Partial<Pick<SchedulerEventEnvelope, "sessionId" | "session_id">>,
  sessionId?: string | null,
): boolean {
  const targetSessionId = sessionId?.trim();
  if (!targetSessionId) {
    return true;
  }

  const eventSessionId = resolveSchedulerEventSessionId(event);
  return !eventSessionId || eventSessionId === targetSessionId;
}

/**
 * SubAgent 调度器 Hook
 */
export function useSubAgentScheduler(
  sessionId?: string | null,
): UseSubAgentSchedulerReturn {
  const [state, setState] = useState<UseSubAgentSchedulerState>(INITIAL_STATE);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  const lastSubmittedTasksRef = useRef<SubAgentTask[]>([]);

  useEffect(() => {
    sessionIdRef.current = sessionId ?? null;
    setState({ ...INITIAL_STATE });
  }, [sessionId]);

  // 监听调度事件
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await safeListen<SchedulerEventEnvelope>(
        "subagent-scheduler-event",
        (event) => {
          const schedulerEvent = event.payload;
          if (
            !shouldConsumeSchedulerEvent(schedulerEvent, sessionIdRef.current)
          ) {
            return;
          }

          setState((prev) => {
            const nextEvent = schedulerEvent as SchedulerEvent;
            const nextState: UseSubAgentSchedulerState =
              nextEvent.type === "started"
                ? {
                    ...prev,
                    isRunning: true,
                    progress: null,
                    events: [nextEvent],
                    result: null,
                    error: null,
                    summary:
                      prev.summary ||
                      `已启动 ${nextEvent.totalTasks} 个子任务`,
                  }
                : {
                    ...prev,
                    events: [...prev.events, nextEvent],
                  };

            if (nextEvent.type === "progress") {
              nextState.progress = nextEvent.progress;
              nextState.summary =
                summarizeSubAgentProgress(nextEvent.progress) || prev.summary;
            }

            if (
              nextEvent.type === "completed" ||
              nextEvent.type === "cancelled"
            ) {
              nextState.isRunning = false;
              if (nextEvent.type === "cancelled") {
                nextState.summary = "子任务执行已取消";
              }
            }

            if (nextEvent.type === "taskFailed") {
              nextState.summary = `任务 ${nextEvent.taskId} 失败`;
            }

            if (nextEvent.type === "taskCompleted") {
              nextState.summary = `任务 ${nextEvent.taskId} 已完成`;
            }

            return nextState;
          });
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // 执行任务
  const execute = useCallback(
    async (
      tasks: SubAgentTask[],
      config?: SchedulerConfig,
    ): Promise<SchedulerExecutionResult> => {
      setState((prev) => ({
        ...prev,
        isRunning: true,
        error: null,
        events: [],
        progress: null,
        result: null,
        summary: summarizeSubAgentTaskBatch(tasks),
      }));
      lastSubmittedTasksRef.current = tasks;

      try {
        const result = await executeSubAgentTasks(tasks, config, sessionId);

        setState((prev) => ({
          ...prev,
          isRunning: false,
          result,
          summary:
            summarizeSubAgentResult(result, lastSubmittedTasksRef.current) ||
            prev.summary,
        }));

        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          isRunning: false,
          error: errorMessage,
          summary: errorMessage,
        }));
        throw err;
      }
    },
    [sessionId],
  );

  // 取消执行
  const cancel = useCallback(async () => {
    try {
      await cancelSubAgentTasks();
    } catch (err) {
      console.error("取消 SubAgent 任务失败:", err);
    }
  }, []);

  // 清除事件
  const clearEvents = useCallback(() => {
    setState((prev) => ({
      ...prev,
      events: [],
    }));
  }, []);

  return {
    ...state,
    execute,
    cancel,
    clearEvents,
  };
}

export default useSubAgentScheduler;
