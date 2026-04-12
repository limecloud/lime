import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { AsterSubagentSessionInfo } from "@/lib/api/agentRuntime";
import {
  closeAgentRuntimeSubagent,
  resumeAgentRuntimeSubagent,
  sendAgentRuntimeSubagentInput,
  waitAgentRuntimeSubagents,
} from "@/lib/api/agentRuntime";
import {
  isTeamWorkspaceActiveStatus,
  isTeamWorkspaceTerminalStatus,
  resolveTeamWorkspaceRuntimeStatusLabel,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceLiveRuntimeState,
  type TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";

function normalizeUniqueSessionIds(ids: string[]): string[] {
  return Array.from(
    new Set(ids.map((sessionId) => sessionId.trim()).filter(Boolean)),
  );
}

function buildTeamControlSummary(params: {
  action: TeamWorkspaceControlSummary["action"];
  requestedSessionIds: string[];
  cascadeSessionIds?: string[];
  affectedSessionIds?: string[];
}): TeamWorkspaceControlSummary {
  return {
    action: params.action,
    requestedSessionIds: normalizeUniqueSessionIds(params.requestedSessionIds),
    cascadeSessionIds: normalizeUniqueSessionIds(
      params.cascadeSessionIds ?? [],
    ),
    affectedSessionIds: normalizeUniqueSessionIds(
      params.affectedSessionIds ?? [],
    ),
    updatedAt: Date.now(),
  };
}

interface UseWorkspaceTeamSessionControlRuntimeParams {
  childSubagentSessions: AsterSubagentSessionInfo[];
  liveRuntimeBySessionId: Record<string, TeamWorkspaceLiveRuntimeState>;
  stopSending: () => Promise<void>;
}

export function useWorkspaceTeamSessionControlRuntime({
  childSubagentSessions,
  liveRuntimeBySessionId,
  stopSending,
}: UseWorkspaceTeamSessionControlRuntimeParams) {
  const [teamWaitSummary, setTeamWaitSummary] =
    useState<TeamWorkspaceWaitSummary | null>(null);
  const [teamControlSummary, setTeamControlSummary] =
    useState<TeamWorkspaceControlSummary | null>(null);

  const handleCloseSubagentSession = useCallback(
    async (subagentSessionId: string) => {
      try {
        const response = await closeAgentRuntimeSubagent({
          id: subagentSessionId,
        });
        const summary = buildTeamControlSummary({
          action: "close",
          requestedSessionIds: [subagentSessionId],
          cascadeSessionIds: response.cascade_session_ids,
          affectedSessionIds: response.changed_session_ids,
        });
        if (summary.affectedSessionIds.length > 0) {
          setTeamControlSummary(summary);
        }

        if (summary.affectedSessionIds.length > 1) {
          toast.success(`已级联停止 ${summary.affectedSessionIds.length} 项任务`);
        } else if (summary.affectedSessionIds.length === 1) {
          toast.success("这项任务已停止");
        } else {
          toast.info(
            `当前任务状态为${resolveTeamWorkspaceRuntimeStatusLabel(response.previous_status.kind)}，未发生新的停止变更`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "停止任务失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );

  const handleResumeSubagentSession = useCallback(
    async (subagentSessionId: string) => {
      try {
        const response = await resumeAgentRuntimeSubagent({
          id: subagentSessionId,
        });
        const summary = buildTeamControlSummary({
          action: "resume",
          requestedSessionIds: [subagentSessionId],
          cascadeSessionIds: response.cascade_session_ids,
          affectedSessionIds: response.changed_session_ids,
        });
        if (summary.affectedSessionIds.length > 0) {
          setTeamControlSummary(summary);
        }

        if (summary.affectedSessionIds.length > 1) {
          toast.success(`已级联恢复 ${summary.affectedSessionIds.length} 项任务`);
        } else if (summary.affectedSessionIds.length === 1) {
          toast.success("这项任务已恢复");
        } else {
          toast.info(
            `当前任务状态为${resolveTeamWorkspaceRuntimeStatusLabel(response.status.kind)}，未发生新的恢复变更`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "恢复任务失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );

  const handleWaitSubagentSession = useCallback(
    async (subagentSessionId: string, timeoutMs = 30_000) => {
      try {
        const response = await waitAgentRuntimeSubagents({
          ids: [subagentSessionId],
          timeout_ms: timeoutMs,
        });
        if (response.timed_out) {
          toast.info("等待超时，这项任务仍未进入最终状态");
          return;
        }

        const status = response.status[subagentSessionId];
        toast.success(
          `这项任务已进入${resolveTeamWorkspaceRuntimeStatusLabel(status?.kind)}状态`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "等待任务失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );

  const handleWaitActiveTeamSessions = useCallback(
    async (subagentSessionIds: string[], timeoutMs = 30_000) => {
      const normalizedSessionIds =
        normalizeUniqueSessionIds(subagentSessionIds);

      if (normalizedSessionIds.length === 0) {
        const error = new Error("没有可等待的活跃任务");
        toast.error(error.message);
        throw error;
      }

      try {
        const response = await waitAgentRuntimeSubagents({
          ids: normalizedSessionIds,
          timeout_ms: timeoutMs,
        });
        if (response.timed_out) {
          setTeamWaitSummary({
            awaitedSessionIds: normalizedSessionIds,
            timedOut: true,
            updatedAt: Date.now(),
          });
          toast.info("等待超时，团队内活跃任务仍未进入最终状态");
          return;
        }

        const resolvedSessionId =
          normalizedSessionIds.find((sessionId) =>
            isTeamWorkspaceTerminalStatus(response.status[sessionId]?.kind),
          ) ?? normalizedSessionIds[0];
        const resolvedStatus = resolvedSessionId
          ? response.status[resolvedSessionId]?.kind
          : undefined;

        setTeamWaitSummary({
          awaitedSessionIds: normalizedSessionIds,
          timedOut: false,
          resolvedSessionId,
          resolvedStatus,
          updatedAt: Date.now(),
        });
        toast.success(
          `团队任务已进入${resolveTeamWorkspaceRuntimeStatusLabel(resolvedStatus)}状态`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "等待团队任务失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );

  const handleCloseCompletedTeamSessions = useCallback(
    async (subagentSessionIds: string[]) => {
      const normalizedSessionIds =
        normalizeUniqueSessionIds(subagentSessionIds);

      if (normalizedSessionIds.length === 0) {
        const error = new Error("没有可关闭的已完成任务");
        toast.error(error.message);
        throw error;
      }

      const results = await Promise.allSettled(
        normalizedSessionIds.map((sessionId) =>
          closeAgentRuntimeSubagent({ id: sessionId }),
        ),
      );
      const successfulResponses = results
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof closeAgentRuntimeSubagent>>
          > => result.status === "fulfilled",
        )
        .map((result) => result.value);
      const succeededCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const affectedSessionIds = normalizeUniqueSessionIds(
        successfulResponses.flatMap((response) => response.changed_session_ids),
      );
      const cascadeSessionIds = normalizeUniqueSessionIds(
        successfulResponses.flatMap((response) => response.cascade_session_ids),
      );
      const failedResults = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      if (successfulResponses.length > 0) {
        setTeamControlSummary(
          buildTeamControlSummary({
            action: "close_completed",
            requestedSessionIds: normalizedSessionIds,
            cascadeSessionIds,
            affectedSessionIds,
          }),
        );
      }

      if (succeededCount > 0) {
        toast.success(
          affectedSessionIds.length > 0
            ? `已级联收起 ${affectedSessionIds.length} 项任务`
            : `已收起 ${succeededCount} 项已完成任务`,
        );
      }

      if (failedResults.length > 0) {
        const firstFailure = failedResults[0]?.reason;
        const message =
          firstFailure instanceof Error
            ? firstFailure.message
            : "部分已完成任务收起失败";
        toast.error(message);
        if (succeededCount === 0) {
          throw firstFailure instanceof Error
            ? firstFailure
            : new Error(message);
        }
      }
    },
    [],
  );

  const handleSendSubagentInput = useCallback(
    async (
      subagentSessionId: string,
      message: string,
      options?: { interrupt?: boolean },
    ) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        const error = new Error("请输入要发送给这项任务的内容");
        toast.error(error.message);
        throw error;
      }

      try {
        await sendAgentRuntimeSubagentInput({
          id: subagentSessionId,
          message: normalizedMessage,
          interrupt: options?.interrupt === true,
        });
        toast.success(
          options?.interrupt === true
            ? "已中断当前执行并发送新说明"
            : "已向这项任务发送补充说明",
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "发送任务说明失败";
        toast.error(messageText);
        throw error;
      }
    },
    [],
  );

  const handleStopSending = useCallback(async () => {
    await stopSending();

    const activeTeamSessionIds = normalizeUniqueSessionIds(
      childSubagentSessions
        .filter((session) => {
          const liveRuntime = liveRuntimeBySessionId[session.id];
          const effectiveRuntimeStatus =
            liveRuntime?.runtimeStatus ?? session.runtime_status;
          const effectiveLatestTurnStatus =
            liveRuntime?.latestTurnStatus ?? session.latest_turn_status;
          return isTeamWorkspaceActiveStatus(
            effectiveRuntimeStatus ?? effectiveLatestTurnStatus,
          );
        })
        .map((session) => session.id),
    );

    if (activeTeamSessionIds.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      activeTeamSessionIds.map((subagentSessionId) =>
        closeAgentRuntimeSubagent({
          id: subagentSessionId,
        }),
      ),
    );

    const successfulResponses = results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof closeAgentRuntimeSubagent>>
        > => result.status === "fulfilled",
      )
      .map((result) => result.value);
    const failedResults = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    const affectedSessionIds = normalizeUniqueSessionIds(
      successfulResponses.flatMap((response) => response.changed_session_ids),
    );
    const cascadeSessionIds = normalizeUniqueSessionIds(
      successfulResponses.flatMap((response) => response.cascade_session_ids),
    );

    if (successfulResponses.length > 0) {
      const summary = buildTeamControlSummary({
        action: "close",
        requestedSessionIds: activeTeamSessionIds,
        cascadeSessionIds,
        affectedSessionIds,
      });
      if (summary.affectedSessionIds.length > 0) {
        setTeamControlSummary(summary);
      }

      toast.success(
        affectedSessionIds.length > 1
          ? `已暂停 ${affectedSessionIds.length} 项任务的处理`
          : affectedSessionIds.length === 1
            ? "已暂停这项任务的处理"
            : activeTeamSessionIds.length > 1
              ? `已向 ${activeTeamSessionIds.length} 项任务发送暂停请求`
              : "已向这项任务发送暂停请求",
      );
    }

    if (failedResults.length > 0) {
      const firstFailure = failedResults[0]?.reason;
      const message =
        firstFailure instanceof Error ? firstFailure.message : "停止任务失败";
      toast.error(message);
      if (successfulResponses.length === 0) {
        throw firstFailure instanceof Error ? firstFailure : new Error(message);
      }
    }
  }, [childSubagentSessions, liveRuntimeBySessionId, stopSending]);

  return {
    teamWaitSummary,
    teamControlSummary,
    handleCloseSubagentSession,
    handleResumeSubagentSession,
    handleWaitSubagentSession,
    handleWaitActiveTeamSessions,
    handleCloseCompletedTeamSessions,
    handleSendSubagentInput,
    handleStopSending,
  };
}
