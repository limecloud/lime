import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executionRunGet,
  executionRunListGeneralWorkbenchHistory,
  type AgentRun,
  type GeneralWorkbenchRunState,
  type GeneralWorkbenchRunTerminalItem,
} from "@/lib/api/executionRun";
import { extractArtifactProtocolPathsFromRecord } from "@/lib/artifact-protocol";
import {
  skillExecutionApi,
  type SkillDetailInfo,
} from "@/lib/api/skill-execution";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import type { Message } from "../types";
import { parseSkillSlashCommand } from "../hooks/skillCommand";
import {
  buildGeneralWorkbenchWorkflowSteps,
  formatGeneralWorkbenchRunDurationLabel,
  formatGeneralWorkbenchRunTimeLabel,
  inferGeneralWorkbenchGateFromQueueItem,
  mergeGeneralWorkbenchTerminalItems,
  resolveExecutionIdCandidatesForActivityLog,
  resolveGeneralWorkbenchApplyTargetByGateKey,
  resolveGeneralWorkbenchRecentTerminals,
  resolveGeneralWorkbenchSkillSourceRef,
} from "./generalWorkbenchHelpers";

interface UseWorkspaceGeneralWorkbenchSidebarRuntimeParams {
  isThemeWorkbench: boolean;
  sessionId?: string | null;
  messages: Message[];
  isSending: boolean;
  themeWorkbenchBackendRunState: GeneralWorkbenchRunState | null;
  contextActivityLogs: SidebarActivityLog[];
  historyPageSize: number;
}

export function useWorkspaceGeneralWorkbenchSidebarRuntime({
  isThemeWorkbench,
  sessionId,
  messages,
  isSending,
  themeWorkbenchBackendRunState,
  contextActivityLogs,
  historyPageSize,
}: UseWorkspaceGeneralWorkbenchSidebarRuntimeParams) {
  const [
    generalWorkbenchHistoryTerminals,
    setGeneralWorkbenchHistoryTerminals,
  ] = useState<GeneralWorkbenchRunTerminalItem[]>([]);
  const [generalWorkbenchHistoryHasMore, setGeneralWorkbenchHistoryHasMore] =
    useState(false);
  const [
    generalWorkbenchHistoryNextOffset,
    setGeneralWorkbenchHistoryNextOffset,
  ] = useState<number | null>(null);
  const [generalWorkbenchHistoryLoading, setGeneralWorkbenchHistoryLoading] =
    useState(false);
  const [generalWorkbenchSkillDetailMap, setGeneralWorkbenchSkillDetailMap] =
    useState<Record<string, SkillDetailInfo | null>>({});
  const [selectedGeneralWorkbenchRunId, setSelectedGeneralWorkbenchRunId] =
    useState<string | null>(null);
  const [
    selectedGeneralWorkbenchRunDetail,
    setSelectedGeneralWorkbenchRunDetail,
  ] = useState<AgentRun | null>(null);
  const [
    generalWorkbenchRunDetailLoading,
    setGeneralWorkbenchRunDetailLoading,
  ] = useState(false);
  const generalWorkbenchHistoryLoadingRef = useRef(false);

  const loadGeneralWorkbenchHistory = useCallback(
    async (offset: number, replace: boolean) => {
      if (
        !isThemeWorkbench ||
        !sessionId ||
        generalWorkbenchHistoryLoadingRef.current
      ) {
        return;
      }

      generalWorkbenchHistoryLoadingRef.current = true;
      setGeneralWorkbenchHistoryLoading(true);
      try {
        const page = await executionRunListGeneralWorkbenchHistory(
          sessionId,
          historyPageSize,
          offset,
        );
        setGeneralWorkbenchHistoryTerminals((previous) =>
          replace
            ? mergeGeneralWorkbenchTerminalItems(page.items || [])
            : mergeGeneralWorkbenchTerminalItems(previous, page.items || []),
        );
        setGeneralWorkbenchHistoryHasMore(Boolean(page.has_more));
        setGeneralWorkbenchHistoryNextOffset(page.next_offset ?? null);
      } catch (error) {
        console.warn("[AgentChatPage] 拉取工作区编排历史日志失败:", error);
        if (replace) {
          setGeneralWorkbenchHistoryTerminals([]);
          setGeneralWorkbenchHistoryHasMore(false);
          setGeneralWorkbenchHistoryNextOffset(null);
        }
      } finally {
        generalWorkbenchHistoryLoadingRef.current = false;
        setGeneralWorkbenchHistoryLoading(false);
      }
    },
    [historyPageSize, isThemeWorkbench, sessionId],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      generalWorkbenchHistoryLoadingRef.current = false;
      setGeneralWorkbenchHistoryTerminals([]);
      setGeneralWorkbenchHistoryHasMore(false);
      setGeneralWorkbenchHistoryNextOffset(null);
      setGeneralWorkbenchHistoryLoading(false);
      return;
    }

    void loadGeneralWorkbenchHistory(0, true);
  }, [isThemeWorkbench, loadGeneralWorkbenchHistory, sessionId]);

  const generalWorkbenchRequiredSkillNames = useMemo(() => {
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
      const sourceRef = resolveGeneralWorkbenchSkillSourceRef(item);
      if (sourceRef) {
        requiredSkillNames.add(sourceRef);
      }
    });
    const terminalSourceRef = resolveGeneralWorkbenchSkillSourceRef(
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
      setGeneralWorkbenchSkillDetailMap((previous) =>
        Object.keys(previous).length === 0 ? previous : {},
      );
      return;
    }

    const missingSkillNames = generalWorkbenchRequiredSkillNames.filter(
      (skillName) => !(skillName in generalWorkbenchSkillDetailMap),
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
      setGeneralWorkbenchSkillDetailMap((previous) => {
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
    generalWorkbenchRequiredSkillNames,
    generalWorkbenchSkillDetailMap,
  ]);

  const generalWorkbenchWorkflowSteps = useMemo(
    () =>
      buildGeneralWorkbenchWorkflowSteps(
        messages,
        themeWorkbenchBackendRunState,
        isSending,
        generalWorkbenchSkillDetailMap,
      ),
    [
      isSending,
      messages,
      themeWorkbenchBackendRunState,
      generalWorkbenchSkillDetailMap,
    ],
  );

  const generalWorkbenchMergedTerminals = useMemo(
    () =>
      mergeGeneralWorkbenchTerminalItems(
        resolveGeneralWorkbenchRecentTerminals(themeWorkbenchBackendRunState),
        generalWorkbenchHistoryTerminals,
      ),
    [themeWorkbenchBackendRunState, generalWorkbenchHistoryTerminals],
  );

  const generalWorkbenchExecutionRunMap = useMemo(() => {
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
    generalWorkbenchMergedTerminals.forEach((item) => {
      register(item.execution_id, item.run_id);
    });

    return map;
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    generalWorkbenchMergedTerminals,
  ]);

  const generalWorkbenchBackendActivityLogs = useMemo<
    SidebarActivityLog[]
  >(() => {
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return [];
    }

    const runningLogs = (themeWorkbenchBackendRunState.queue_items || []).map(
      (item) => {
        const gateKey =
          item.gate_key || inferGeneralWorkbenchGateFromQueueItem(item).key;
        const artifactPaths = extractArtifactProtocolPathsFromRecord(item);
        return {
          id: `run-queue-${item.run_id}`,
          name: item.title || "执行工作区编排",
          status: "running" as const,
          timeLabel: formatGeneralWorkbenchRunTimeLabel(item.started_at),
          applyTarget: resolveGeneralWorkbenchApplyTargetByGateKey(gateKey),
          runId: item.run_id,
          executionId: item.execution_id || undefined,
          sessionId: item.session_id || undefined,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : undefined,
          gateKey,
          source: item.source,
          sourceRef: item.source_ref || undefined,
        };
      },
    );

    const terminalLogs: SidebarActivityLog[] =
      generalWorkbenchMergedTerminals.map((terminal) => {
        const artifactPaths = extractArtifactProtocolPathsFromRecord(terminal);
        return {
          id: `run-terminal-${terminal.run_id}`,
          name: terminal.title || "执行工作区编排",
          status: terminal.status === "success" ? "completed" : "failed",
          timeLabel: formatGeneralWorkbenchRunTimeLabel(
            terminal.finished_at || terminal.started_at,
          ),
          durationLabel: formatGeneralWorkbenchRunDurationLabel(
            terminal.started_at,
            terminal.finished_at,
          ),
          applyTarget: resolveGeneralWorkbenchApplyTargetByGateKey(
            terminal.gate_key || "idle",
          ),
          runId: terminal.run_id,
          executionId: terminal.execution_id || undefined,
          sessionId: terminal.session_id || undefined,
          artifactPaths: artifactPaths.length > 0 ? artifactPaths : undefined,
          gateKey: terminal.gate_key || "idle",
          source: terminal.source,
          sourceRef: terminal.source_ref || undefined,
        };
      });

    return [...runningLogs, ...terminalLogs];
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    generalWorkbenchMergedTerminals,
  ]);

  const handleLoadMoreGeneralWorkbenchHistory = useCallback(() => {
    const nextOffset =
      generalWorkbenchHistoryNextOffset ??
      generalWorkbenchHistoryTerminals.length;
    void loadGeneralWorkbenchHistory(nextOffset, false);
  }, [
    loadGeneralWorkbenchHistory,
    generalWorkbenchHistoryNextOffset,
    generalWorkbenchHistoryTerminals.length,
  ]);

  const generalWorkbenchActivityLogs = useMemo<SidebarActivityLog[]>(() => {
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
        const mappedRunId = generalWorkbenchExecutionRunMap.get(executionId);
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

    return [...generalWorkbenchBackendActivityLogs, ...enrichedContextLogs];
  }, [
    contextActivityLogs,
    isThemeWorkbench,
    generalWorkbenchBackendActivityLogs,
    generalWorkbenchExecutionRunMap,
  ]);

  const handleViewGeneralWorkbenchRunDetail = useCallback((runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    setSelectedGeneralWorkbenchRunId(normalizedRunId);
  }, []);

  useEffect(() => {
    if (!isThemeWorkbench || !selectedGeneralWorkbenchRunId) {
      setGeneralWorkbenchRunDetailLoading(false);
      setSelectedGeneralWorkbenchRunDetail(null);
      return;
    }

    let cancelled = false;
    setGeneralWorkbenchRunDetailLoading(true);
    executionRunGet(selectedGeneralWorkbenchRunId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedGeneralWorkbenchRunDetail(detail);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedGeneralWorkbenchRunDetail(null);
        console.warn("[AgentChatPage] 加载运行详情失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setGeneralWorkbenchRunDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isThemeWorkbench, selectedGeneralWorkbenchRunId]);

  return {
    handleLoadMoreGeneralWorkbenchHistory,
    handleViewGeneralWorkbenchRunDetail,
    selectedGeneralWorkbenchRunDetail,
    generalWorkbenchActivityLogs,
    generalWorkbenchHistoryHasMore,
    generalWorkbenchHistoryLoading,
    generalWorkbenchRunDetailLoading,
    generalWorkbenchSkillDetailMap,
    generalWorkbenchWorkflowSteps,
  };
}
