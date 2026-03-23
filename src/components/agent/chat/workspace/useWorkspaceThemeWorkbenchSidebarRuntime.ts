import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executionRunGet,
  executionRunListThemeWorkbenchHistory,
  type AgentRun,
  type ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
  type ThemeWorkbenchRunTerminalItem,
} from "@/lib/api/executionRun";
import {
  skillExecutionApi,
  type SkillDetailInfo,
} from "@/lib/api/skill-execution";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import type { Message } from "../types";
import { parseSkillSlashCommand } from "../hooks/skillCommand";
import {
  buildThemeWorkbenchWorkflowSteps,
  formatThemeWorkbenchRunDurationLabel,
  formatThemeWorkbenchRunTimeLabel,
  inferThemeWorkbenchGateFromQueueItem,
  mergeThemeWorkbenchTerminalItems,
  resolveExecutionIdCandidatesForActivityLog,
  resolveThemeWorkbenchApplyTargetByGateKey,
  resolveThemeWorkbenchRecentTerminals,
  resolveThemeWorkbenchSkillSourceRef,
} from "./themeWorkbenchHelpers";

interface UseWorkspaceThemeWorkbenchSidebarRuntimeParams {
  isThemeWorkbench: boolean;
  sessionId?: string | null;
  messages: Message[];
  isSending: boolean;
  themeWorkbenchBackendRunState: BackendThemeWorkbenchRunState | null;
  contextActivityLogs: SidebarActivityLog[];
  historyPageSize: number;
}

export function useWorkspaceThemeWorkbenchSidebarRuntime({
  isThemeWorkbench,
  sessionId,
  messages,
  isSending,
  themeWorkbenchBackendRunState,
  contextActivityLogs,
  historyPageSize,
}: UseWorkspaceThemeWorkbenchSidebarRuntimeParams) {
  const [themeWorkbenchHistoryTerminals, setThemeWorkbenchHistoryTerminals] =
    useState<ThemeWorkbenchRunTerminalItem[]>([]);
  const [themeWorkbenchHistoryHasMore, setThemeWorkbenchHistoryHasMore] =
    useState(false);
  const [themeWorkbenchHistoryNextOffset, setThemeWorkbenchHistoryNextOffset] =
    useState<number | null>(null);
  const [themeWorkbenchHistoryLoading, setThemeWorkbenchHistoryLoading] =
    useState(false);
  const [themeWorkbenchSkillDetailMap, setThemeWorkbenchSkillDetailMap] =
    useState<Record<string, SkillDetailInfo | null>>({});
  const [selectedThemeWorkbenchRunId, setSelectedThemeWorkbenchRunId] =
    useState<string | null>(null);
  const [selectedThemeWorkbenchRunDetail, setSelectedThemeWorkbenchRunDetail] =
    useState<AgentRun | null>(null);
  const [themeWorkbenchRunDetailLoading, setThemeWorkbenchRunDetailLoading] =
    useState(false);
  const themeWorkbenchHistoryLoadingRef = useRef(false);

  const loadThemeWorkbenchHistory = useCallback(
    async (offset: number, replace: boolean) => {
      if (
        !isThemeWorkbench ||
        !sessionId ||
        themeWorkbenchHistoryLoadingRef.current
      ) {
        return;
      }

      themeWorkbenchHistoryLoadingRef.current = true;
      setThemeWorkbenchHistoryLoading(true);
      try {
        const page = await executionRunListThemeWorkbenchHistory(
          sessionId,
          historyPageSize,
          offset,
        );
        setThemeWorkbenchHistoryTerminals((previous) =>
          replace
            ? mergeThemeWorkbenchTerminalItems(page.items || [])
            : mergeThemeWorkbenchTerminalItems(previous, page.items || []),
        );
        setThemeWorkbenchHistoryHasMore(Boolean(page.has_more));
        setThemeWorkbenchHistoryNextOffset(page.next_offset ?? null);
      } catch (error) {
        console.warn("[AgentChatPage] 拉取主题工作台历史日志失败:", error);
        if (replace) {
          setThemeWorkbenchHistoryTerminals([]);
          setThemeWorkbenchHistoryHasMore(false);
          setThemeWorkbenchHistoryNextOffset(null);
        }
      } finally {
        themeWorkbenchHistoryLoadingRef.current = false;
        setThemeWorkbenchHistoryLoading(false);
      }
    },
    [historyPageSize, isThemeWorkbench, sessionId],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      themeWorkbenchHistoryLoadingRef.current = false;
      setThemeWorkbenchHistoryTerminals([]);
      setThemeWorkbenchHistoryHasMore(false);
      setThemeWorkbenchHistoryNextOffset(null);
      setThemeWorkbenchHistoryLoading(false);
      return;
    }

    void loadThemeWorkbenchHistory(0, true);
  }, [isThemeWorkbench, loadThemeWorkbenchHistory, sessionId]);

  const themeWorkbenchRequiredSkillNames = useMemo(() => {
    if (!isThemeWorkbench) {
      return [] as string[];
    }

    const requiredSkillNames = new Set<string>();
    messages.forEach((message) => {
      if (message.role !== "user") {
        return;
      }
      const skillName = parseSkillSlashCommand(message.content)?.skillName;
      if (skillName) {
        requiredSkillNames.add(skillName);
      }
    });
    (themeWorkbenchBackendRunState?.queue_items || []).forEach((item) => {
      const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
      if (sourceRef) {
        requiredSkillNames.add(sourceRef);
      }
    });
    const terminalSourceRef = resolveThemeWorkbenchSkillSourceRef(
      themeWorkbenchBackendRunState?.latest_terminal || {},
    );
    if (terminalSourceRef) {
      requiredSkillNames.add(terminalSourceRef);
    }

    return [...requiredSkillNames].sort();
  }, [
    isThemeWorkbench,
    messages,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchBackendRunState?.queue_items,
  ]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchSkillDetailMap((previous) =>
        Object.keys(previous).length === 0 ? previous : {},
      );
      return;
    }

    const missingSkillNames = themeWorkbenchRequiredSkillNames.filter(
      (skillName) => !(skillName in themeWorkbenchSkillDetailMap),
    );
    if (missingSkillNames.length === 0) {
      return;
    }

    let disposed = false;
    Promise.all(
      missingSkillNames.map(async (skillName) => {
        try {
          const detail = await skillExecutionApi.getSkillDetail(skillName);
          return [skillName, detail] as const;
        } catch (error) {
          console.warn(
            "[AgentChatPage] 加载 Skill 详情失败:",
            skillName,
            error,
          );
          return [skillName, null] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) {
        return;
      }
      setThemeWorkbenchSkillDetailMap((previous) => {
        const next = { ...previous };
        entries.forEach(([skillName, detail]) => {
          next[skillName] = detail;
        });
        return next;
      });
    });

    return () => {
      disposed = true;
    };
  }, [
    isThemeWorkbench,
    themeWorkbenchRequiredSkillNames,
    themeWorkbenchSkillDetailMap,
  ]);

  const themeWorkbenchWorkflowSteps = useMemo(
    () =>
      buildThemeWorkbenchWorkflowSteps(
        messages,
        themeWorkbenchBackendRunState,
        isSending,
        themeWorkbenchSkillDetailMap,
      ),
    [
      isSending,
      messages,
      themeWorkbenchBackendRunState,
      themeWorkbenchSkillDetailMap,
    ],
  );

  const themeWorkbenchMergedTerminals = useMemo(
    () =>
      mergeThemeWorkbenchTerminalItems(
        resolveThemeWorkbenchRecentTerminals(themeWorkbenchBackendRunState),
        themeWorkbenchHistoryTerminals,
      ),
    [themeWorkbenchBackendRunState, themeWorkbenchHistoryTerminals],
  );

  const themeWorkbenchExecutionRunMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return map;
    }

    const register = (executionId?: string | null, runId?: string | null) => {
      const normalizedExecutionId = executionId?.trim();
      const normalizedRunId = runId?.trim();
      if (!normalizedExecutionId || !normalizedRunId) {
        return;
      }
      map.set(normalizedExecutionId, normalizedRunId);
    };

    (themeWorkbenchBackendRunState.queue_items || []).forEach((item) => {
      register(item.execution_id, item.run_id);
    });
    themeWorkbenchMergedTerminals.forEach((item) => {
      register(item.execution_id, item.run_id);
    });

    return map;
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    themeWorkbenchMergedTerminals,
  ]);

  const themeWorkbenchBackendActivityLogs = useMemo<
    SidebarActivityLog[]
  >(() => {
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return [];
    }

    const runningLogs = (themeWorkbenchBackendRunState.queue_items || []).map(
      (item) => {
        const gateKey =
          item.gate_key || inferThemeWorkbenchGateFromQueueItem(item).key;
        return {
          id: `run-queue-${item.run_id}`,
          name: item.title || "执行主题工作台编排",
          status: "running" as const,
          timeLabel: formatThemeWorkbenchRunTimeLabel(item.started_at),
          applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(gateKey),
          runId: item.run_id,
          executionId: item.execution_id || undefined,
          sessionId: item.session_id || undefined,
          artifactPaths:
            Array.isArray(item.artifact_paths) && item.artifact_paths.length > 0
              ? item.artifact_paths
              : undefined,
          gateKey,
          source: item.source,
          sourceRef: item.source_ref || undefined,
        };
      },
    );

    const terminalLogs: SidebarActivityLog[] =
      themeWorkbenchMergedTerminals.map((terminal) => ({
        id: `run-terminal-${terminal.run_id}`,
        name: terminal.title || "执行主题工作台编排",
        status: terminal.status === "success" ? "completed" : "failed",
        timeLabel: formatThemeWorkbenchRunTimeLabel(
          terminal.finished_at || terminal.started_at,
        ),
        durationLabel: formatThemeWorkbenchRunDurationLabel(
          terminal.started_at,
          terminal.finished_at,
        ),
        applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(
          terminal.gate_key || "idle",
        ),
        runId: terminal.run_id,
        executionId: terminal.execution_id || undefined,
        sessionId: terminal.session_id || undefined,
        artifactPaths:
          Array.isArray(terminal.artifact_paths) &&
          terminal.artifact_paths.length > 0
            ? terminal.artifact_paths
            : undefined,
        gateKey: terminal.gate_key || "idle",
        source: terminal.source,
        sourceRef: terminal.source_ref || undefined,
      }));

    return [...runningLogs, ...terminalLogs];
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    themeWorkbenchMergedTerminals,
  ]);

  const handleLoadMoreThemeWorkbenchHistory = useCallback(() => {
    const nextOffset =
      themeWorkbenchHistoryNextOffset ?? themeWorkbenchHistoryTerminals.length;
    void loadThemeWorkbenchHistory(nextOffset, false);
  }, [
    loadThemeWorkbenchHistory,
    themeWorkbenchHistoryNextOffset,
    themeWorkbenchHistoryTerminals.length,
  ]);

  const themeWorkbenchActivityLogs = useMemo<SidebarActivityLog[]>(() => {
    if (!isThemeWorkbench) {
      return contextActivityLogs;
    }

    const enrichedContextLogs = contextActivityLogs.map((log) => {
      const normalizedRunId = log.runId?.trim();
      if (normalizedRunId) {
        return {
          ...log,
          runId: normalizedRunId,
        };
      }

      const candidateExecutionIds =
        resolveExecutionIdCandidatesForActivityLog(log);
      for (const executionId of candidateExecutionIds) {
        const mappedRunId = themeWorkbenchExecutionRunMap.get(executionId);
        if (!mappedRunId) {
          continue;
        }
        return {
          ...log,
          executionId,
          runId: mappedRunId,
        };
      }

      return log;
    });

    return [...themeWorkbenchBackendActivityLogs, ...enrichedContextLogs];
  }, [
    contextActivityLogs,
    isThemeWorkbench,
    themeWorkbenchBackendActivityLogs,
    themeWorkbenchExecutionRunMap,
  ]);

  const handleViewThemeWorkbenchRunDetail = useCallback((runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    setSelectedThemeWorkbenchRunId(normalizedRunId);
  }, []);

  useEffect(() => {
    if (!isThemeWorkbench || !selectedThemeWorkbenchRunId) {
      setThemeWorkbenchRunDetailLoading(false);
      setSelectedThemeWorkbenchRunDetail(null);
      return;
    }

    let cancelled = false;
    setThemeWorkbenchRunDetailLoading(true);
    executionRunGet(selectedThemeWorkbenchRunId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedThemeWorkbenchRunDetail(detail);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedThemeWorkbenchRunDetail(null);
        console.warn("[AgentChatPage] 加载运行详情失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setThemeWorkbenchRunDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isThemeWorkbench, selectedThemeWorkbenchRunId]);

  return {
    handleLoadMoreThemeWorkbenchHistory,
    handleViewThemeWorkbenchRunDetail,
    selectedThemeWorkbenchRunDetail,
    themeWorkbenchActivityLogs,
    themeWorkbenchHistoryHasMore,
    themeWorkbenchHistoryLoading,
    themeWorkbenchRunDetailLoading,
    themeWorkbenchSkillDetailMap,
    themeWorkbenchWorkflowSteps,
  };
}
