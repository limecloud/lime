import { logAgentDebug } from "@/lib/agentDebug";
import { normalizeLegacyThreadItem } from "../agentTextNormalization";
import type { AgentThreadItem } from "../agentProtocol";
import { normalizeQueuedTurnSnapshots } from "../queuedTurn";
import { AGENT_RUNTIME_COMMANDS } from "./commandManifest.generated";
import {
  normalizeSubagentParentContext,
  normalizeSubagentSessionInfo,
  normalizeThreadReadModel,
} from "./normalizers";
import {
  invokeAgentRuntimeCommand,
  type AgentRuntimeCommandInvoke,
} from "./transport";
import type {
  AsterExecutionStrategy,
  AsterSessionDetail,
  AsterSessionInfo,
  AgentRuntimeListSessionsOptions,
  AgentRuntimeGetSessionOptions,
  AgentRuntimeUpdateSessionRequest,
} from "./types";

const requireWorkspaceId = (
  workspaceId?: string,
  fallbackWorkspaceId?: string,
): string => {
  const resolvedWorkspaceId = (workspaceId ?? fallbackWorkspaceId)?.trim();
  if (!resolvedWorkspaceId) {
    throw new Error("workspaceId 不能为空，请先选择项目工作区");
  }
  return resolvedWorkspaceId;
};

export interface AgentRuntimeSessionClientDeps {
  invokeCommand?: AgentRuntimeCommandInvoke;
}

export function createSessionClient({
  invokeCommand = invokeAgentRuntimeCommand,
}: AgentRuntimeSessionClientDeps = {}) {
  async function createAgentRuntimeSession(
    workspaceId: string,
    name?: string,
    executionStrategy?: AsterExecutionStrategy,
  ): Promise<string> {
    return await invokeCommand<string>(AGENT_RUNTIME_COMMANDS.createSession, {
      workspaceId: requireWorkspaceId(workspaceId),
      name,
      executionStrategy,
    });
  }

  async function listAgentRuntimeSessions(
    options?: AgentRuntimeListSessionsOptions,
  ): Promise<AsterSessionInfo[]> {
    const startedAt = Date.now();
    let settled = false;
    const includeArchived = options?.includeArchived === true;
    const archivedOnly = options?.archivedOnly === true;
    const workspaceId = options?.workspaceId?.trim();
    const limit =
      typeof options?.limit === "number" &&
      Number.isFinite(options.limit) &&
      options.limit >= 0
        ? Math.trunc(options.limit)
        : undefined;
    const slowTimer: number | null =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (settled) {
              return;
            }

            logAgentDebug(
              "AgentApi",
              "runtimeListSessions.slow",
              {
                elapsedMs: Date.now() - startedAt,
              },
              {
                dedupeKey: "runtimeListSessions.slow",
                level: "warn",
                throttleMs: 1000,
              },
            );
          }, 1000)
        : null;

    logAgentDebug("AgentApi", "runtimeListSessions.start");

    try {
      const request = {
        ...(includeArchived ? { include_archived: true } : {}),
        ...(archivedOnly ? { archived_only: true } : {}),
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(typeof limit === "number" ? { limit } : {}),
      };
      const sessions = await invokeCommand<AsterSessionInfo[]>(
        AGENT_RUNTIME_COMMANDS.listSessions,
        Object.keys(request).length > 0
          ? {
              request,
            }
          : undefined,
      );
      settled = true;
      logAgentDebug("AgentApi", "runtimeListSessions.success", {
        archivedOnly,
        durationMs: Date.now() - startedAt,
        limit,
        sessionsCount: sessions.length,
        includeArchived,
        workspaceId: workspaceId ?? null,
      });
      return sessions;
    } catch (error) {
      settled = true;
      logAgentDebug(
        "AgentApi",
        "runtimeListSessions.error",
        {
          archivedOnly,
          durationMs: Date.now() - startedAt,
          error,
          limit,
          workspaceId: workspaceId ?? null,
        },
        { level: "error" },
      );
      throw error;
    } finally {
      if (slowTimer !== null) {
        clearTimeout(slowTimer);
      }
    }
  }

  async function getAgentRuntimeSession(
    sessionId: string,
    options?: AgentRuntimeGetSessionOptions,
  ): Promise<AsterSessionDetail> {
    const startedAt = Date.now();
    let settled = false;
    const resumeSessionStartHooks = options?.resumeSessionStartHooks === true;
    const slowTimer: number | null =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            if (settled) {
              return;
            }

            logAgentDebug(
              "AgentApi",
              "runtimeGetSession.slow",
              {
                elapsedMs: Date.now() - startedAt,
                resumeSessionStartHooks,
                sessionId,
              },
              {
                dedupeKey: `runtimeGetSession.slow:${sessionId}`,
                level: "warn",
                throttleMs: 1000,
              },
            );
          }, 1000)
        : null;

    logAgentDebug("AgentApi", "runtimeGetSession.start", {
      resumeSessionStartHooks,
      sessionId,
    });

    try {
      const detail = await invokeCommand<AsterSessionDetail>(
        AGENT_RUNTIME_COMMANDS.getSession,
        {
          sessionId,
          ...(resumeSessionStartHooks ? { resumeSessionStartHooks: true } : {}),
        },
      );
      const normalizedDetail = detail as AsterSessionDetail | null | undefined;
      const normalizedSessionDetail: AsterSessionDetail = {
        ...(detail as AsterSessionDetail),
        items: Array.isArray(normalizedDetail?.items)
          ? normalizedDetail.items.map((item) =>
              normalizeLegacyThreadItem(item as AgentThreadItem),
            )
          : normalizedDetail?.items,
        child_subagent_sessions: Array.isArray(
          normalizedDetail?.child_subagent_sessions,
        )
          ? normalizedDetail.child_subagent_sessions.map(
              normalizeSubagentSessionInfo,
            )
          : normalizedDetail?.child_subagent_sessions,
        subagent_parent_context: normalizeSubagentParentContext(
          normalizedDetail?.subagent_parent_context,
        ),
        queued_turns: normalizeQueuedTurnSnapshots(normalizedDetail?.queued_turns),
        thread_read: normalizeThreadReadModel(normalizedDetail?.thread_read),
      };
      settled = true;
      logAgentDebug("AgentApi", "runtimeGetSession.success", {
        childSubagentSessionsCount:
          normalizedSessionDetail.child_subagent_sessions?.length ?? 0,
        durationMs: Date.now() - startedAt,
        itemsCount: normalizedSessionDetail.items?.length ?? 0,
        messagesCount: normalizedSessionDetail.messages?.length ?? 0,
        queuedTurnsCount: normalizedSessionDetail.queued_turns?.length ?? 0,
        resumeSessionStartHooks,
        sessionId,
        turnsCount: normalizedSessionDetail.turns?.length ?? 0,
      });
      return normalizedSessionDetail;
    } catch (error) {
      settled = true;
      logAgentDebug(
        "AgentApi",
        "runtimeGetSession.error",
        {
          durationMs: Date.now() - startedAt,
          error,
          resumeSessionStartHooks,
          sessionId,
        },
        { level: "error" },
      );
      throw error;
    } finally {
      if (slowTimer !== null) {
        clearTimeout(slowTimer);
      }
    }
  }

  async function updateAgentRuntimeSession(
    request: AgentRuntimeUpdateSessionRequest,
  ): Promise<void> {
    return await invokeCommand<void>(AGENT_RUNTIME_COMMANDS.updateSession, {
      request,
    });
  }

  async function deleteAgentRuntimeSession(sessionId: string): Promise<void> {
    return await invokeCommand<void>(AGENT_RUNTIME_COMMANDS.deleteSession, {
      sessionId,
    });
  }

  return {
    createAgentRuntimeSession,
    deleteAgentRuntimeSession,
    getAgentRuntimeSession,
    listAgentRuntimeSessions,
    updateAgentRuntimeSession,
  };
}

export const {
  createAgentRuntimeSession,
  deleteAgentRuntimeSession,
  getAgentRuntimeSession,
  listAgentRuntimeSessions,
  updateAgentRuntimeSession,
} = createSessionClient();
