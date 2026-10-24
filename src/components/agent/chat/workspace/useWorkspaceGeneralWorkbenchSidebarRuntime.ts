import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAppServerClient } from "@/lib/api/appServer";
import {
  executionRunGet,
  executionRunListGeneralWorkbenchHistory,
  type AgentRun,
  type GeneralWorkbenchRunState,
  type GeneralWorkbenchRunTerminalItem,
} from "@/lib/api/executionRun";
import { extractArtifactProtocolPathsFromRecord } from "@/lib/artifact-protocol";
import {
  resolveExecutableSkillId,
  skillExecutionApi,
  type SkillDetailInfo,
} from "@/lib/api/skill-execution";
import type { SidebarActivityLog } from "../components/generalWorkbenchWorkflowData";
import type { Message } from "../types";
import { parseSkillSlashCommand } from "../hooks/skillCommand";
import {
  buildGeneralWorkbenchWorkflowSteps,
  formatGeneralWorkbenchRunDurationLabel,
  formatGeneralWorkbenchRunTimeLabel,
  inferGeneralWorkbenchGateFromQueueItem,
  mergeGeneralWorkbenchTerminalItems,
  resolveGeneralWorkbenchApplyTargetByGateKey,
  resolveGeneralWorkbenchRecentTerminals,
  resolveGeneralWorkbenchSkillSourceRef,
} from "./generalWorkbenchHelpers";
import {
  mapWorkspaceWorkflowStatusToAgentRunStatus,
  readWorkspaceWorkflowRunsFromUnknown,
  selectWorkspaceWorkflowRunById,
  workflowRunToAgentRun,
  type WorkspaceWorkflowRun,
  type WorkspaceWorkflowStep,
} from "./workspaceWorkflowReadModel";
import {
  buildWorkspaceWorkflowControlItems,
  buildWorkspaceWorkflowCancelParams,
  buildWorkspaceWorkflowRespondParams,
  buildWorkspaceWorkflowRetryParams,
  type WorkspaceWorkflowControlItem,
} from "./workspaceWorkflowControls";
import type { StepStatus } from "@/lib/workspace/workbenchContract";

interface UseWorkspaceGeneralWorkbenchSidebarRuntimeParams {
  isThemeWorkbench: boolean;
  sidebarVisible: boolean;
  sessionId?: string | null;
  messages: Message[];
  isSending: boolean;
  themeWorkbenchBackendRunState: GeneralWorkbenchRunState | null;
  historyPageSize: number;
}

export function useWorkspaceGeneralWorkbenchSidebarRuntime({
  isThemeWorkbench,
  sidebarVisible,
  sessionId,
  messages,
  isSending,
  themeWorkbenchBackendRunState,
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
  const [generalWorkbenchWorkflowRuns, setGeneralWorkbenchWorkflowRuns] =
    useState<WorkspaceWorkflowRun[]>([]);
  const [
    generalWorkbenchWorkflowControlPendingItemId,
    setGeneralWorkbenchWorkflowControlPendingItemId,
  ] = useState<string | null>(null);
  const generalWorkbenchHistoryLoadingRef = useRef(false);

  useEffect(() => {
    if (!isThemeWorkbench || !sidebarVisible || !sessionId) {
      setGeneralWorkbenchWorkflowRuns([]);
      return;
    }

    let disposed = false;
    createAppServerClient()
      .readWorkflow({ sessionId })
      .then((response) => {
        if (disposed) {
          return;
        }
        setGeneralWorkbenchWorkflowRuns(
          readWorkspaceWorkflowRunsFromUnknown(response.result),
        );
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        setGeneralWorkbenchWorkflowRuns([]);
        console.warn("[AgentChatPage] 加载 Workflow Read Model 失败:", error);
      });

    return () => {
      disposed = true;
    };
  }, [isThemeWorkbench, sessionId, sidebarVisible]);

  const loadGeneralWorkbenchHistory = useCallback(
    async (offset: number, replace: boolean) => {
      if (
        !isThemeWorkbench ||
        !sidebarVisible ||
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
    [historyPageSize, isThemeWorkbench, sessionId, sidebarVisible],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !sidebarVisible || !sessionId) {
      generalWorkbenchHistoryLoadingRef.current = false;
      setGeneralWorkbenchHistoryTerminals([]);
      setGeneralWorkbenchHistoryHasMore(false);
      setGeneralWorkbenchHistoryNextOffset(null);
      setGeneralWorkbenchHistoryLoading(false);
      return;
    }

    void loadGeneralWorkbenchHistory(0, true);
  }, [
    isThemeWorkbench,
    loadGeneralWorkbenchHistory,
    sessionId,
    sidebarVisible,
  ]);

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
    if (!isThemeWorkbench || !sidebarVisible) {
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
    void skillExecutionApi
      .listExecutableSkills()
      .then((skills) =>
        Promise.all(
          missingSkillNames.map(async (skillReference) => {
            const skillId = resolveExecutableSkillId(skills, skillReference);
            if (!skillId) {
              console.warn(
                "[AgentChatPage] 无法唯一解析 Skill 引用:",
                skillReference,
              );
              return [skillReference, null] as const;
            }
            try {
              const detail = await skillExecutionApi.getSkillDetail(skillId);
              return [skillReference, detail] as const;
            } catch (error) {
              console.warn(
                "[AgentChatPage] 加载 Skill 详情失败:",
                skillId,
                error,
              );
              return [skillReference, null] as const;
            }
          }),
        ),
      )
      .catch((error) => {
        console.warn("[AgentChatPage] 加载 Skill catalog 失败:", error);
        return missingSkillNames.map(
          (skillReference) => [skillReference, null] as const,
        );
      })
      .then((entries) => {
        if (disposed) {
          return;
        }
        setGeneralWorkbenchSkillDetailMap((previous) => {
          const next = { ...previous };
          entries.forEach(([skillReference, detail]) => {
            next[skillReference] = detail;
          });
          return next;
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    isThemeWorkbench,
    sidebarVisible,
    generalWorkbenchRequiredSkillNames,
    generalWorkbenchSkillDetailMap,
  ]);

  const generalWorkbenchReadModelWorkflowSteps = useMemo(
    () => buildWorkflowStepsFromReadModel(generalWorkbenchWorkflowRuns),
    [generalWorkbenchWorkflowRuns],
  );
  const generalWorkbenchWorkflowControlItems = useMemo(
    () => buildWorkspaceWorkflowControlItems(generalWorkbenchWorkflowRuns),
    [generalWorkbenchWorkflowRuns],
  );

  const generalWorkbenchWorkflowSteps = useMemo(
    () =>
      generalWorkbenchReadModelWorkflowSteps.length > 0
        ? generalWorkbenchReadModelWorkflowSteps
        : buildGeneralWorkbenchWorkflowSteps(
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
      generalWorkbenchReadModelWorkflowSteps,
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

  const generalWorkbenchWorkflowActivityLogs = useMemo<SidebarActivityLog[]>(
    () =>
      isThemeWorkbench
        ? generalWorkbenchWorkflowRuns.map((run) =>
            workflowRunToActivityLog(run, sessionId),
          )
        : [],
    [generalWorkbenchWorkflowRuns, isThemeWorkbench, sessionId],
  );

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
    return [
      ...generalWorkbenchWorkflowActivityLogs,
      ...generalWorkbenchBackendActivityLogs,
    ];
  }, [
    generalWorkbenchWorkflowActivityLogs,
    generalWorkbenchBackendActivityLogs,
  ]);

  const handleViewGeneralWorkbenchRunDetail = useCallback((runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    setSelectedGeneralWorkbenchRunId(normalizedRunId);
  }, []);

  const handleTriggerGeneralWorkbenchWorkflowControl = useCallback(
    async (item: WorkspaceWorkflowControlItem) => {
      if (!isThemeWorkbench || !sessionId) {
        return;
      }
      setGeneralWorkbenchWorkflowControlPendingItemId(item.id);
      const client = createAppServerClient();
      try {
        const response =
          item.kind === "cancel"
            ? await client.cancelWorkflow(
                buildWorkspaceWorkflowCancelParams(item, sessionId),
              )
            : item.kind === "retry"
              ? await client.retryWorkflow(
                  buildWorkspaceWorkflowRetryParams(item, sessionId),
                )
              : await client.respondWorkflow(
                  buildWorkspaceWorkflowRespondParams(item, sessionId),
                );
        const nextRuns = readWorkspaceWorkflowRunsFromUnknown(response.result);
        setGeneralWorkbenchWorkflowRuns(nextRuns);
        const selectedRunId = selectedGeneralWorkbenchRunId?.trim();
        if (selectedRunId) {
          const selectedRun = selectWorkspaceWorkflowRunById(
            nextRuns,
            selectedRunId,
          );
          if (selectedRun) {
            setSelectedGeneralWorkbenchRunDetail(
              workflowRunToAgentRun(selectedRun, sessionId),
            );
          }
        }
      } catch (error) {
        console.warn("[AgentChatPage] Workflow 控制动作失败:", error);
      } finally {
        setGeneralWorkbenchWorkflowControlPendingItemId((current) =>
          current === item.id ? null : current,
        );
      }
    },
    [isThemeWorkbench, selectedGeneralWorkbenchRunId, sessionId],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !selectedGeneralWorkbenchRunId) {
      setGeneralWorkbenchRunDetailLoading(false);
      setSelectedGeneralWorkbenchRunDetail(null);
      return;
    }

    let cancelled = false;
    setGeneralWorkbenchRunDetailLoading(true);
    const workflowRun =
      selectWorkspaceWorkflowRunById(
        generalWorkbenchWorkflowRuns,
        selectedGeneralWorkbenchRunId,
      ) ??
      (selectedGeneralWorkbenchRunId === sessionId
        ? (generalWorkbenchWorkflowRuns[0] ?? null)
        : null);
    if (workflowRun) {
      setSelectedGeneralWorkbenchRunDetail(
        workflowRunToAgentRun(workflowRun, sessionId),
      );
      setGeneralWorkbenchRunDetailLoading(false);
      return;
    }

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
  }, [
    generalWorkbenchWorkflowRuns,
    isThemeWorkbench,
    selectedGeneralWorkbenchRunId,
    sessionId,
  ]);

  return {
    handleLoadMoreGeneralWorkbenchHistory,
    handleViewGeneralWorkbenchRunDetail,
    selectedGeneralWorkbenchRunDetail,
    generalWorkbenchActivityLogs,
    generalWorkbenchHistoryHasMore,
    generalWorkbenchHistoryLoading,
    generalWorkbenchRunDetailLoading,
    generalWorkbenchSkillDetailMap,
    generalWorkbenchWorkflowControlItems,
    generalWorkbenchWorkflowControlPendingItemId,
    generalWorkbenchWorkflowSteps,
    handleTriggerGeneralWorkbenchWorkflowControl,
  };
}

function buildWorkflowStepsFromReadModel(
  workflowRuns: readonly WorkspaceWorkflowRun[],
): Array<{ id: string; title: string; status: StepStatus }> {
  const run = workflowRuns[0];
  if (!run || run.steps.length === 0) {
    return [];
  }
  return run.steps.map((step) => ({
    id: `${run.workflowRunId}-${step.id}`,
    title: step.title,
    status: mapWorkflowStepStatus(step),
  }));
}

function mapWorkflowStepStatus(step: WorkspaceWorkflowStep): StepStatus {
  const normalized = step.status?.trim().toLowerCase();
  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "success" ||
    normalized === "succeeded"
  ) {
    return "completed";
  }
  if (
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "error"
  ) {
    return "error";
  }
  if (normalized === "skipped" || normalized === "canceled") {
    return "skipped";
  }
  if (
    normalized === "running" ||
    normalized === "retrying" ||
    normalized === "waiting" ||
    normalized === "waitingaction"
  ) {
    return "active";
  }
  return "pending";
}

function workflowRunToActivityLog(
  run: WorkspaceWorkflowRun,
  fallbackSessionId?: string | null,
): SidebarActivityLog {
  const status = mapWorkspaceWorkflowStatusToAgentRunStatus(run.status);
  const failedStep = run.steps.find(
    (step) => mapWorkflowStepStatus(step) === "error",
  );
  return {
    id: `workflow-run-${run.workflowRunId}`,
    name:
      run.workflowTitle ?? run.workflowKey ?? failedStep?.title ?? "Workflow",
    status:
      status === "error"
        ? "failed"
        : status === "success" || status === "canceled"
          ? "completed"
          : "running",
    timeLabel: formatGeneralWorkbenchRunTimeLabel(
      run.updatedAt ?? run.startedAt,
    ),
    durationLabel: formatGeneralWorkbenchRunDurationLabel(
      run.startedAt,
      run.finishedAt ?? run.completedAt ?? run.failedAt,
    ),
    runId: run.workflowRunId,
    executionId: run.turnId ?? undefined,
    sessionId: run.sessionId ?? fallbackSessionId ?? undefined,
    artifactPaths: collectWorkflowArtifactRefs(run),
    inputSummary: run.taskKind ?? undefined,
    outputSummary: failedStep?.progressMessage ?? undefined,
    source: "workflow",
    sourceRef: run.workflowKey ?? undefined,
  };
}

function collectWorkflowArtifactRefs(run: WorkspaceWorkflowRun): string[] {
  const refs = new Set<string>();
  for (const ref of run.artifactRefs) {
    refs.add(ref);
  }
  for (const step of run.steps) {
    for (const ref of step.artifactRefs) {
      refs.add(ref);
    }
  }
  return Array.from(refs);
}
