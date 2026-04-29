import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  exportAgentRuntimeReviewDecisionTemplate,
  saveAgentRuntimeReviewDecision,
  type AgentRuntimeReviewDecisionTemplate,
  type AgentRuntimeSaveReviewDecisionRequest,
} from "@/lib/api/agentRuntime";
import {
  getSceneAppRunSummary,
  getSceneAppScorecard,
  listSceneAppCatalog,
  listSceneAppRuns,
  planSceneAppLaunch,
  saveSceneAppContextBaseline,
  prepareSceneAppRunGovernanceArtifact,
  prepareSceneAppRunGovernanceArtifacts,
  type SceneAppCatalog,
  type SceneAppDescriptor,
  type SceneAppPlanResult,
  type SceneAppPattern,
  type SceneAppRunSummary,
  type SceneAppScorecard,
  type SceneAppType,
} from "@/lib/api/sceneapp";
import {
  backfillSceneAppExecutionSummaryViewModel,
  buildSceneAppExecutionSummaryViewModel,
  buildSceneAppCatalogCardViewModel,
  buildSceneAppQuickReviewDecisionRequest,
  buildSceneAppDetailViewModel,
  buildSceneAppGovernancePanelViewModel,
  buildSceneAppRunDetailViewModel,
  buildSceneAppRunListItemViewModel,
  buildSceneAppScorecardViewModel,
  buildSceneAppWorkbenchStatItems,
  buildSceneAppEntryCard,
  getSceneAppPresentationCopy,
  normalizeSceneAppsPageParams,
  recordSceneAppRecentVisit,
  readStoredSceneAppCatalog,
  resolveSceneAppSeed,
  resolveSceneAppRunEntryNavigationTarget,
  serializeSceneAppsPageParams,
  formatSceneAppErrorMessage,
  findLatestSceneAppPackResultRun,
  listSceneAppRecentVisits,
  normalizeSceneAppTypeFilter,
  useSceneAppLaunchRuntime,
  resolveSceneAppRuntimeArtifactOpenTarget,
  SCENEAPP_QUICK_REVIEW_ACTIONS,
  type SceneAppQuickReviewAction,
  type SceneAppQuickReviewActionTone,
  type SceneAppEntryCardItem,
  type SceneAppRecentVisitRecord,
  type SceneAppSeed,
  type SceneAppsPageParams,
  type SceneAppsView,
} from "@/lib/sceneapp";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import type { ChatToolPreferences } from "@/components/agent/chat/utils/chatToolPreferences";
import { extractExplicitUrlFromText } from "@/components/agent/chat/utils/browserAssistIntent";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import {
  buildCuratedTaskReferenceEntryFromSceneAppExecution,
  buildSceneAppExecutionCuratedTaskFollowUpAction,
} from "@/components/agent/chat/utils/sceneAppCuratedTaskReference";
import { buildRuntimeInitialInputCapabilityFromFollowUpAction } from "@/components/agent/chat/utils/inputCapabilityBootstrap";
import {
  buildSceneAppExecutionInspirationLibraryPageParams,
  hasSavedSceneAppExecutionAsInspiration,
  saveSceneAppExecutionAsInspiration,
} from "@/components/agent/chat/utils/saveSceneAppExecutionAsInspiration";
import type { Page, PageParams } from "@/types/page";

export type SceneAppTypeFilter = "all" | SceneAppType;
export type SceneAppPatternFilter = "all" | SceneAppPattern;
export type SceneAppsViewMode = SceneAppsView;
export type { SceneAppQuickReviewAction, SceneAppQuickReviewActionTone };

const DEFAULT_TOOL_PREFERENCES: ChatToolPreferences = {
  webSearch: false,
  thinking: false,
  task: false,
  subagent: false,
};

const SEARCH_PARAM_SYNC_DELAY_MS = 180;
const PREFILL_PARAM_SYNC_DELAY_MS = 220;
function matchesSearch(descriptor: SceneAppDescriptor, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    descriptor.title,
    descriptor.summary,
    descriptor.outputHint,
    descriptor.id,
    descriptor.category,
    descriptor.patternStack.join(" "),
    descriptor.infraProfile.join(" "),
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function resolveSceneAppsViewMode(
  params?: Partial<SceneAppsPageParams>,
): SceneAppsViewMode {
  if (
    params?.view === "catalog" ||
    params?.view === "detail" ||
    params?.view === "governance"
  ) {
    return params.view;
  }

  if (params?.runId) {
    return "governance";
  }

  if (params?.sceneappId) {
    return "detail";
  }

  return "detail";
}

interface UseSceneAppsPageRuntimeParams {
  onNavigate: (page: Page, params?: PageParams) => void;
  pageParams?: SceneAppsPageParams;
  isActive?: boolean;
  isNavigationTargetOwner?: boolean;
  navigationRequestId?: number;
}

export interface SceneAppRecentVisitItem {
  key: string;
  title: string;
  businessLabel: string;
  summary: string;
  hint: string;
  visitedAt: number;
  params: SceneAppsPageParams;
  isCurrent: boolean;
}

function truncateSingleLine(value: string, maxLength = 72): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRecentVisitHint(record: SceneAppRecentVisitRecord): string {
  const parts: string[] = [];
  if (record.projectId) {
    parts.push(`项目 ${record.projectId}`);
  }
  if (record.runId) {
    parts.push("带最近结果");
  }
  if (record.search) {
    parts.push(`筛选：${record.search}`);
  }
  if ((record.referenceMemoryIds?.length ?? 0) > 0) {
    parts.push(`灵感 ${record.referenceMemoryIds?.length} 条`);
  }

  return parts.length > 0 ? parts.join(" · ") : "恢复最近一次浏览上下文";
}

function resolveSceneAppRunSortTime(run: SceneAppRunSummary): number {
  const timestamp = Date.parse(run.finishedAt ?? run.startedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildLatestSceneAppRunMap(
  runs: SceneAppRunSummary[],
): Record<string, SceneAppRunSummary> {
  return runs.reduce<Record<string, SceneAppRunSummary>>((acc, run) => {
    const current = acc[run.sceneappId];
    if (
      !current ||
      resolveSceneAppRunSortTime(run) >= resolveSceneAppRunSortTime(current)
    ) {
      acc[run.sceneappId] = run;
    }
    return acc;
  }, {});
}

export function useSceneAppsPageRuntime({
  onNavigate,
  pageParams,
  isActive = true,
  isNavigationTargetOwner = isActive,
  navigationRequestId = 0,
}: UseSceneAppsPageRuntimeParams) {
  const appliedExternalParamsKeyRef = useRef<string | null>(null);
  const requestedPageParamsSyncKeyRef = useRef<string | null>(null);
  const navigationOwnershipBarrierRef = useRef(false);
  const lastHandledNavigationRequestIdRef = useRef(navigationRequestId);
  const [pageStateTouched, setPageStateTouched] = useState(
    serializeSceneAppsPageParams(pageParams) !== "{}",
  );
  const [catalog, setCatalog] = useState<SceneAppCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogRuntimeLoading, setCatalogRuntimeLoading] = useState(false);
  const [catalogRuntimeError, setCatalogRuntimeError] = useState<string | null>(
    null,
  );
  const [catalogScorecardMap, setCatalogScorecardMap] = useState<
    Record<string, SceneAppScorecard>
  >({});
  const [catalogLatestRunMap, setCatalogLatestRunMap] = useState<
    Record<string, SceneAppRunSummary>
  >({});
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  const [searchQuery, setSearchQuery] = useState(pageParams?.search ?? "");
  const [typeFilter, setTypeFilter] = useState<SceneAppTypeFilter>(
    normalizeSceneAppTypeFilter(pageParams?.typeFilter) ?? "all",
  );
  const [patternFilter, setPatternFilter] = useState<SceneAppPatternFilter>(
    pageParams?.patternFilter ?? "all",
  );
  const [viewMode, setViewMode] = useState<SceneAppsViewMode>(
    resolveSceneAppsViewMode(pageParams),
  );
  const [selectedSceneAppId, setSelectedSceneAppId] = useState<string | null>(
    pageParams?.sceneappId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    pageParams?.projectId ?? null,
  );
  const [selectedReferenceMemoryIds, setSelectedReferenceMemoryIds] = useState<
    string[]
  >(pageParams?.referenceMemoryIds ?? []);
  const [launchInput, setLaunchInput] = useState(
    pageParams?.prefillIntent ?? "",
  );
  const [scorecard, setScorecard] = useState<SceneAppScorecard | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState<string | null>(null);
  const [runs, setRuns] = useState<SceneAppRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(Boolean(pageParams?.runId));
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    pageParams?.runId ?? null,
  );
  const [selectedRunSummary, setSelectedRunSummary] =
    useState<SceneAppRunSummary | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [selectedRunError, setSelectedRunError] = useState<string | null>(null);
  const [selectedPlanResult, setSelectedPlanResult] =
    useState<SceneAppPlanResult | null>(null);
  const [selectedPlanLoading, setSelectedPlanLoading] = useState(false);
  const [selectedPlanError, setSelectedPlanError] = useState<string | null>(
    null,
  );
  const [savingContextBaseline, setSavingContextBaseline] = useState(false);
  const [reviewDecisionDialogOpen, setReviewDecisionDialogOpen] =
    useState(false);
  const [reviewDecisionTemplate, setReviewDecisionTemplate] =
    useState<AgentRuntimeReviewDecisionTemplate | null>(null);
  const [reviewDecisionLoading, setReviewDecisionLoading] = useState(false);
  const [reviewDecisionSaving, setReviewDecisionSaving] = useState(false);
  const [recentVisitRecords, setRecentVisitRecords] = useState<
    SceneAppRecentVisitRecord[]
  >(() => listSceneAppRecentVisits());
  const launchRuntime = useSceneAppLaunchRuntime({
    activeTheme: "general",
    creationMode: "guided",
    projectId: selectedProjectId,
    defaultToolPreferences: DEFAULT_TOOL_PREFERENCES,
    onNavigate,
  });

  const normalizedIncomingPageParams = useMemo(
    () =>
      normalizeSceneAppsPageParams({
        view: pageParams?.view,
        sceneappId: pageParams?.sceneappId,
        runId: pageParams?.runId,
        projectId: pageParams?.projectId,
        prefillIntent: pageParams?.prefillIntent,
        referenceMemoryIds: pageParams?.referenceMemoryIds,
        search: pageParams?.search,
        typeFilter: pageParams?.typeFilter,
        patternFilter: pageParams?.patternFilter,
      }),
    [
      pageParams?.view,
      pageParams?.patternFilter,
      pageParams?.prefillIntent,
      pageParams?.projectId,
      pageParams?.referenceMemoryIds,
      pageParams?.runId,
      pageParams?.sceneappId,
      pageParams?.search,
      pageParams?.typeFilter,
    ],
  );
  const normalizedIncomingPageParamsKey = useMemo(
    () => serializeSceneAppsPageParams(normalizedIncomingPageParams),
    [normalizedIncomingPageParams],
  );
  const hasIncomingPageState = normalizedIncomingPageParamsKey !== "{}";
  const resolvedIncomingPageParams = useMemo(() => {
    if (!hasIncomingPageState) {
      return normalizedIncomingPageParams;
    }

    return normalizeSceneAppsPageParams({
      ...normalizedIncomingPageParams,
      view: resolveSceneAppsViewMode(normalizedIncomingPageParams),
    });
  }, [hasIncomingPageState, normalizedIncomingPageParams]);
  const resolvedIncomingPageParamsKey = useMemo(
    () => serializeSceneAppsPageParams(resolvedIncomingPageParams),
    [resolvedIncomingPageParams],
  );

  const applySceneAppsPageParams = useCallback(
    (params: SceneAppsPageParams) => {
      const nextSearchQuery = params.search ?? "";
      const nextTypeFilter = params.typeFilter ?? "all";
      const nextPatternFilter = params.patternFilter ?? "all";
      const nextViewMode = resolveSceneAppsViewMode(params);
      const nextSceneAppId = params.sceneappId ?? null;
      const nextRunId = params.runId ?? null;
      const nextProjectId = params.projectId ?? null;
      const nextReferenceMemoryIds = params.referenceMemoryIds ?? [];
      const nextLaunchInput = params.prefillIntent ?? "";

      setSearchQuery((current) =>
        current === nextSearchQuery ? current : nextSearchQuery,
      );
      setTypeFilter((current) =>
        current === nextTypeFilter ? current : nextTypeFilter,
      );
      setPatternFilter((current) =>
        current === nextPatternFilter ? current : nextPatternFilter,
      );
      setViewMode((current) =>
        current === nextViewMode ? current : nextViewMode,
      );
      setSelectedSceneAppId((current) =>
        current === nextSceneAppId ? current : nextSceneAppId,
      );
      setSelectedRunId((current) =>
        current === nextRunId ? current : nextRunId,
      );
      setSelectedProjectId((current) =>
        current === nextProjectId ? current : nextProjectId,
      );
      setSelectedReferenceMemoryIds((current) =>
        current.length === nextReferenceMemoryIds.length &&
        current.every((value, index) => value === nextReferenceMemoryIds[index])
          ? current
          : nextReferenceMemoryIds,
      );
      setLaunchInput((current) =>
        current === nextLaunchInput ? current : nextLaunchInput,
      );
    },
    [],
  );

  useEffect(() => {
    setPageStateTouched(hasIncomingPageState);

    if (appliedExternalParamsKeyRef.current === resolvedIncomingPageParamsKey) {
      if (
        requestedPageParamsSyncKeyRef.current === resolvedIncomingPageParamsKey
      ) {
        requestedPageParamsSyncKeyRef.current = null;
      }
      return;
    }

    appliedExternalParamsKeyRef.current = resolvedIncomingPageParamsKey;
    if (
      requestedPageParamsSyncKeyRef.current === resolvedIncomingPageParamsKey
    ) {
      requestedPageParamsSyncKeyRef.current = null;
    }
    applySceneAppsPageParams(resolvedIncomingPageParams);
  }, [
    applySceneAppsPageParams,
    hasIncomingPageState,
    resolvedIncomingPageParams,
    resolvedIncomingPageParamsKey,
  ]);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);

    try {
      const nextCatalog = await listSceneAppCatalog();
      setCatalog(nextCatalog);
    } catch (error) {
      const storedCatalog = readStoredSceneAppCatalog();
      if (storedCatalog) {
        setCatalog(storedCatalog);
        setCatalogError("已切换为本地缓存目录，远端目录稍后会自动恢复。");
      } else {
        setCatalog(null);
        setCatalogError(formatSceneAppErrorMessage(error));
      }
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
    });
  }, []);

  const debouncedSearchQuery = useDebouncedValue(
    searchQuery,
    SEARCH_PARAM_SYNC_DELAY_MS,
    { maxWait: 600 },
  );
  const debouncedLaunchInput = useDebouncedValue(
    launchInput,
    PREFILL_PARAM_SYNC_DELAY_MS,
    { maxWait: 900 },
  );
  const effectiveSearchParam = useMemo(() => {
    const incomingSearch = normalizedIncomingPageParams.search ?? "";
    return searchQuery === incomingSearch ? searchQuery : debouncedSearchQuery;
  }, [debouncedSearchQuery, normalizedIncomingPageParams.search, searchQuery]);
  const effectivePrefillIntent = useMemo(() => {
    const incomingPrefill = normalizedIncomingPageParams.prefillIntent ?? "";
    return launchInput === incomingPrefill ? launchInput : debouncedLaunchInput;
  }, [
    debouncedLaunchInput,
    launchInput,
    normalizedIncomingPageParams.prefillIntent,
  ]);

  const allDescriptors = useMemo(() => catalog?.items ?? [], [catalog]);

  useEffect(() => {
    if (allDescriptors.length === 0) {
      setCatalogRuntimeLoading(false);
      setCatalogRuntimeError(null);
      setCatalogScorecardMap({});
      setCatalogLatestRunMap({});
      return;
    }

    let cancelled = false;
    setCatalogRuntimeLoading(true);
    setCatalogRuntimeError(null);

    void (async () => {
      const [runsResult, scorecardResults] = await Promise.all([
        listSceneAppRuns().then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        ),
        Promise.all(
          allDescriptors.map(async (descriptor) => {
            try {
              const scorecard = await getSceneAppScorecard(descriptor.id);
              return {
                id: descriptor.id,
                ok: true as const,
                scorecard,
              };
            } catch (error) {
              return {
                id: descriptor.id,
                ok: false as const,
                error,
              };
            }
          }),
        ),
      ]);

      if (cancelled) {
        return;
      }

      const nextScorecardMap: Record<string, SceneAppScorecard> = {};
      scorecardResults.forEach((result) => {
        if (result.ok) {
          nextScorecardMap[result.id] = result.scorecard;
        }
      });

      setCatalogScorecardMap(nextScorecardMap);
      setCatalogLatestRunMap(
        runsResult.ok ? buildLatestSceneAppRunMap(runsResult.value) : {},
      );

      const partialErrors: string[] = [];
      if (!runsResult.ok) {
        partialErrors.push(formatSceneAppErrorMessage(runsResult.error));
      }
      if (scorecardResults.some((result) => !result.ok)) {
        partialErrors.push(
          "部分结果判断暂未回流，目录先按已拿到的运行事实展示。",
        );
      }
      setCatalogRuntimeError(partialErrors[0] ?? null);
      setCatalogRuntimeLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [allDescriptors]);

  const filteredDescriptors = useMemo(() => {
    return allDescriptors.filter((descriptor) => {
      if (!matchesSearch(descriptor, searchQuery)) {
        return false;
      }
      if (typeFilter !== "all" && descriptor.sceneappType !== typeFilter) {
        return false;
      }
      if (
        patternFilter !== "all" &&
        !descriptor.patternStack.includes(patternFilter)
      ) {
        return false;
      }
      return true;
    });
  }, [allDescriptors, patternFilter, searchQuery, typeFilter]);

  const workbenchStats = useMemo(
    () => buildSceneAppWorkbenchStatItems(allDescriptors),
    [allDescriptors],
  );

  const catalogCards = useMemo(
    () =>
      filteredDescriptors.map((descriptor) =>
        buildSceneAppCatalogCardViewModel({
          descriptor,
          scorecard: catalogScorecardMap[descriptor.id] ?? null,
          run: catalogLatestRunMap[descriptor.id] ?? null,
        }),
      ),
    [catalogLatestRunMap, catalogScorecardMap, filteredDescriptors],
  );

  useEffect(() => {
    if (filteredDescriptors.length === 0) {
      setSelectedSceneAppId(null);
      return;
    }

    if (
      selectedSceneAppId &&
      filteredDescriptors.some(
        (descriptor) => descriptor.id === selectedSceneAppId,
      )
    ) {
      return;
    }

    setSelectedSceneAppId(
      pageParams?.sceneappId &&
        filteredDescriptors.some(
          (descriptor) => descriptor.id === pageParams.sceneappId,
        )
        ? pageParams.sceneappId
        : (filteredDescriptors[0]?.id ?? null),
    );
  }, [filteredDescriptors, pageParams?.sceneappId, selectedSceneAppId]);

  const selectedDescriptor = useMemo(
    () =>
      selectedSceneAppId
        ? (allDescriptors.find(
            (descriptor) => descriptor.id === selectedSceneAppId,
          ) ?? null)
        : null,
    [allDescriptors, selectedSceneAppId],
  );

  useEffect(() => {
    if (!selectedDescriptor) {
      if (catalogLoading) {
        return;
      }

      // 目录刚加载完、选中场景还未落稳时，不要抢先清空运行态；
      // 否则带 runId 进入治理页会在这一帧丢失外部 run 选择。
      if (filteredDescriptors.length > 0) {
        return;
      }

      setScorecard(null);
      setRuns([]);
      setScorecardError(null);
      setRunsError(null);
      setSelectedPlanResult(null);
      setSelectedPlanLoading(false);
      setSelectedPlanError(null);
      setSelectedRunId(null);
      setSelectedRunSummary(null);
      setSelectedRunLoading(false);
      setSelectedRunError(null);
      return;
    }

    let cancelled = false;
    setScorecard(null);
    setRuns([]);
    setSelectedRunSummary(null);
    setSelectedRunLoading(false);
    setSelectedRunError(null);
    setScorecardLoading(true);
    setRunsLoading(true);
    setScorecardError(null);
    setRunsError(null);

    void getSceneAppScorecard(selectedDescriptor.id)
      .then((nextScorecard) => {
        if (cancelled) {
          return;
        }
        setScorecard(nextScorecard);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setScorecard(null);
        setScorecardError(formatSceneAppErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setScorecardLoading(false);
        }
      });

    void listSceneAppRuns(selectedDescriptor.id)
      .then((nextRuns) => {
        if (cancelled) {
          return;
        }
        setRuns(nextRuns);
        setSelectedRunId((current) => {
          if (nextRuns.length === 0) {
            return null;
          }
          if (current && nextRuns.some((run) => run.runId === current)) {
            return current;
          }
          return nextRuns[0]?.runId ?? null;
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuns([]);
        setSelectedRunId(null);
        setRunsError(formatSceneAppErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setRunsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [catalogLoading, filteredDescriptors.length, selectedDescriptor]);

  const syncedPageParams = useMemo(
    () =>
      normalizeSceneAppsPageParams({
        view: viewMode,
        sceneappId: selectedSceneAppId ?? undefined,
        runId:
          viewMode === "governance" ? (selectedRunId ?? undefined) : undefined,
        projectId: selectedProjectId ?? undefined,
        prefillIntent: effectivePrefillIntent,
        referenceMemoryIds:
          selectedReferenceMemoryIds.length > 0
            ? selectedReferenceMemoryIds
            : undefined,
        search: effectiveSearchParam,
        typeFilter: typeFilter !== "all" ? typeFilter : undefined,
        patternFilter: patternFilter !== "all" ? patternFilter : undefined,
      }),
    [
      effectivePrefillIntent,
      effectiveSearchParam,
      patternFilter,
      selectedProjectId,
      selectedReferenceMemoryIds,
      selectedRunId,
      selectedSceneAppId,
      typeFilter,
      viewMode,
    ],
  );
  const syncedPageParamsKey = useMemo(
    () => serializeSceneAppsPageParams(syncedPageParams),
    [syncedPageParams],
  );
  const shouldSyncPageParams = pageStateTouched || hasIncomingPageState;
  const canWriteSceneAppsNavigation =
    isActive &&
    isNavigationTargetOwner &&
    !navigationOwnershipBarrierRef.current;

  useEffect(() => {
    if (lastHandledNavigationRequestIdRef.current === navigationRequestId) {
      return;
    }

    lastHandledNavigationRequestIdRef.current = navigationRequestId;

    if (!isNavigationTargetOwner) {
      navigationOwnershipBarrierRef.current = false;
      return;
    }

    if (syncedPageParamsKey !== resolvedIncomingPageParamsKey) {
      navigationOwnershipBarrierRef.current = true;
    }
  }, [
    isNavigationTargetOwner,
    navigationRequestId,
    resolvedIncomingPageParamsKey,
    syncedPageParamsKey,
  ]);

  useEffect(() => {
    if (!navigationOwnershipBarrierRef.current) {
      return;
    }

    if (!isNavigationTargetOwner) {
      navigationOwnershipBarrierRef.current = false;
      return;
    }

    if (syncedPageParamsKey !== resolvedIncomingPageParamsKey) {
      return;
    }

    navigationOwnershipBarrierRef.current = false;
  }, [
    isNavigationTargetOwner,
    resolvedIncomingPageParamsKey,
    syncedPageParamsKey,
  ]);

  useEffect(() => {
    if (!canWriteSceneAppsNavigation || !shouldSyncPageParams) {
      return;
    }
    if (syncedPageParamsKey === resolvedIncomingPageParamsKey) {
      if (requestedPageParamsSyncKeyRef.current === syncedPageParamsKey) {
        requestedPageParamsSyncKeyRef.current = null;
      }
      return;
    }
    if (requestedPageParamsSyncKeyRef.current === syncedPageParamsKey) {
      return;
    }

    requestedPageParamsSyncKeyRef.current = syncedPageParamsKey;
    onNavigate("sceneapps", syncedPageParams);
  }, [
    canWriteSceneAppsNavigation,
    onNavigate,
    resolvedIncomingPageParamsKey,
    shouldSyncPageParams,
    syncedPageParams,
    syncedPageParamsKey,
  ]);

  useEffect(() => {
    if (
      !canWriteSceneAppsNavigation ||
      !shouldSyncPageParams ||
      !syncedPageParams.sceneappId
    ) {
      return;
    }

    setRecentVisitRecords(recordSceneAppRecentVisit(syncedPageParams));
  }, [
    canWriteSceneAppsNavigation,
    shouldSyncPageParams,
    syncedPageParams,
    syncedPageParamsKey,
  ]);

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRunSummary(null);
      setSelectedRunLoading(false);
      setSelectedRunError(null);
      return;
    }

    const fallbackSummary =
      runs.find((run) => run.runId === selectedRunId) ?? null;
    setSelectedRunSummary(fallbackSummary);
    setSelectedRunLoading(true);
    setSelectedRunError(null);

    let cancelled = false;
    void getSceneAppRunSummary(selectedRunId)
      .then((nextSummary) => {
        if (cancelled) {
          return;
        }
        setSelectedRunSummary(nextSummary ?? fallbackSummary);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedRunSummary(fallbackSummary);
        setSelectedRunError(formatSceneAppErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedRunLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runs, selectedRunId]);

  const urlCandidate = useMemo(
    () => extractExplicitUrlFromText(launchInput),
    [launchInput],
  );
  const previewUrlCandidate = useMemo(
    () => extractExplicitUrlFromText(effectivePrefillIntent),
    [effectivePrefillIntent],
  );

  const selectedEntryCard = useMemo<SceneAppEntryCardItem | null>(() => {
    if (!selectedDescriptor) {
      return null;
    }

    return buildSceneAppEntryCard({
      descriptor: selectedDescriptor,
      projectId: selectedProjectId,
      input: launchInput,
      urlCandidate,
    });
  }, [launchInput, selectedDescriptor, selectedProjectId, urlCandidate]);
  const previewLaunchSeed = useMemo<SceneAppSeed | null>(() => {
    if (!selectedDescriptor) {
      return null;
    }

    return resolveSceneAppSeed({
      descriptor: selectedDescriptor,
      input: effectivePrefillIntent,
      urlCandidate: previewUrlCandidate,
    });
  }, [effectivePrefillIntent, previewUrlCandidate, selectedDescriptor]);
  const refreshSelectedPlanResult = useCallback(async () => {
    if (!selectedDescriptor) {
      return null;
    }

    const trimmedProjectId = selectedProjectId?.trim() || undefined;
    return planSceneAppLaunch({
      sceneappId: selectedDescriptor.id,
      entrySource: "sceneapp_detail_preview",
      workspaceId: trimmedProjectId,
      projectId: trimmedProjectId,
      userInput: previewLaunchSeed?.userInput,
      referenceMemoryIds: selectedReferenceMemoryIds,
      slots: previewLaunchSeed?.slots,
    });
  }, [
    previewLaunchSeed,
    selectedDescriptor,
    selectedProjectId,
    selectedReferenceMemoryIds,
  ]);

  useEffect(() => {
    if (!selectedDescriptor) {
      setSelectedPlanResult(null);
      setSelectedPlanLoading(false);
      setSelectedPlanError(null);
      return;
    }

    let cancelled = false;
    setSelectedPlanResult((current) =>
      current?.descriptor.id === selectedDescriptor.id ? current : null,
    );
    setSelectedPlanLoading(true);
    setSelectedPlanError(null);

    void refreshSelectedPlanResult()
      .then((nextPlanResult) => {
        if (cancelled) {
          return;
        }
        if (nextPlanResult) {
          setSelectedPlanResult(nextPlanResult);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedPlanError(formatSceneAppErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedPlanLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshSelectedPlanResult, selectedDescriptor]);

  const scorecardView = useMemo(
    () =>
      buildSceneAppScorecardViewModel({
        descriptor: selectedDescriptor,
        scorecard,
        run: selectedRunSummary,
        planResult: selectedPlanResult,
      }),
    [scorecard, selectedDescriptor, selectedPlanResult, selectedRunSummary],
  );
  const governanceView = useMemo(
    () =>
      selectedDescriptor
        ? buildSceneAppGovernancePanelViewModel({
            descriptor: selectedDescriptor,
            scorecard,
            run: selectedRunSummary,
            planResult: selectedPlanResult,
          })
        : null,
    [scorecard, selectedDescriptor, selectedPlanResult, selectedRunSummary],
  );

  const runListItems = useMemo(
    () => runs.map((run) => buildSceneAppRunListItemViewModel(run)),
    [runs],
  );

  const selectedRunDetailView = useMemo(() => {
    if (!selectedDescriptor || !selectedRunSummary) {
      return null;
    }

    return buildSceneAppRunDetailViewModel({
      descriptor: selectedDescriptor,
      run: selectedRunSummary,
      planResult: selectedPlanResult,
    });
  }, [selectedDescriptor, selectedPlanResult, selectedRunSummary]);

  const latestPackResultRunSummary = useMemo(
    () =>
      findLatestSceneAppPackResultRun({
        selectedRun: selectedRunSummary,
        runs,
      }),
    [runs, selectedRunSummary],
  );

  const latestPackResultDetailView = useMemo(() => {
    if (!selectedDescriptor || !latestPackResultRunSummary) {
      return null;
    }

    return buildSceneAppRunDetailViewModel({
      descriptor: selectedDescriptor,
      run: latestPackResultRunSummary,
      planResult: selectedPlanResult,
    });
  }, [latestPackResultRunSummary, selectedDescriptor, selectedPlanResult]);

  const latestPackResultUsesFallback =
    Boolean(latestPackResultRunSummary) &&
    Boolean(selectedRunSummary) &&
    latestPackResultRunSummary?.runId !== selectedRunSummary?.runId;

  const selectedRunEntryAction = selectedRunDetailView?.entryAction;
  const selectedRunPreview = useMemo(
    () =>
      selectedRunSummary ??
      runs.find((run) => run.runId === selectedRunId) ??
      null,
    [runs, selectedRunId, selectedRunSummary],
  );
  const selectedRunSessionId = selectedRunPreview?.sessionId?.trim() || "";
  const latestPackResultSessionId =
    latestPackResultRunSummary?.sessionId?.trim() || "";
  const latestReviewFeedbackSignal = useMemo(() => {
    void curatedTaskRecommendationSignalsVersion;
    return (
      listCuratedTaskRecommendationSignals({
        projectId: selectedProjectId,
        sessionId: selectedRunSessionId || latestPackResultSessionId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [
    curatedTaskRecommendationSignalsVersion,
    latestPackResultSessionId,
    selectedProjectId,
    selectedRunSessionId,
  ]);
  const selectedSceneAppExecutionSummary = useMemo(() => {
    if (!selectedDescriptor || !selectedPlanResult) {
      return null;
    }

    return backfillSceneAppExecutionSummaryViewModel({
      summary: buildSceneAppExecutionSummaryViewModel({
        descriptor: selectedDescriptor,
        planResult: selectedPlanResult,
      }),
      run: selectedRunSummary ?? latestPackResultRunSummary,
      scorecard,
    });
  }, [
    latestPackResultRunSummary,
    scorecard,
    selectedDescriptor,
    selectedPlanResult,
    selectedRunSummary,
  ]);
  const selectedSceneAppExecutionReferenceEntry = useMemo(
    () =>
      buildCuratedTaskReferenceEntryFromSceneAppExecution({
        summary: selectedSceneAppExecutionSummary,
        latestRunDetailView:
          selectedRunDetailView ?? latestPackResultDetailView,
      }),
    [
      latestPackResultDetailView,
      selectedRunDetailView,
      selectedSceneAppExecutionSummary,
    ],
  );
  const canOpenSelectedRunHumanReview =
    selectedRunSessionId.length > 0 &&
    Boolean(
      selectedRunPreview &&
      ["success", "error", "canceled", "timeout"].includes(
        selectedRunPreview.status,
      ),
    );

  const resolveSelectedRunReviewDecisionTemplate = useCallback(async () => {
    if (!selectedRunSessionId) {
      return null;
    }

    if (reviewDecisionTemplate?.session_id === selectedRunSessionId) {
      return reviewDecisionTemplate;
    }

    setReviewDecisionLoading(true);
    try {
      const template =
        await exportAgentRuntimeReviewDecisionTemplate(selectedRunSessionId);
      setReviewDecisionTemplate(template);
      return template;
    } catch (error) {
      toast.error(formatSceneAppErrorMessage(error));
      return null;
    } finally {
      setReviewDecisionLoading(false);
    }
  }, [reviewDecisionTemplate, selectedRunSessionId]);

  const handleOpenSelectedRunHumanReview = useCallback(() => {
    if (!selectedRunSessionId) {
      toast.error("当前运行还没有关联会话，暂时无法填写人工复核。");
      return;
    }

    void (async () => {
      const template = await resolveSelectedRunReviewDecisionTemplate();
      if (template) {
        setReviewDecisionDialogOpen(true);
      }
    })();
  }, [resolveSelectedRunReviewDecisionTemplate, selectedRunSessionId]);
  const handleContinueReviewFeedback = useCallback(
    (taskId: string) => {
      if (!selectedSceneAppExecutionReferenceEntry) {
        toast.error("当前还没有足够的项目结果基线，暂时无法直接继续这条建议。");
        return;
      }

      const followUpAction = buildSceneAppExecutionCuratedTaskFollowUpAction({
        referenceEntries: [selectedSceneAppExecutionReferenceEntry],
        taskId,
      });
      if (!followUpAction) {
        toast.error("当前结果判断还缺少可继续的结果模板。");
        return;
      }

      const initialInputCapability =
        buildRuntimeInitialInputCapabilityFromFollowUpAction({
          payload: followUpAction,
          requestKey: Date.now(),
        });
      if (!initialInputCapability) {
        toast.error("当前建议暂时缺少可恢复的输入能力。");
        return;
      }

      onNavigate("agent", {
        agentEntry: "claw",
        projectId: selectedProjectId?.trim() || undefined,
        initialInputCapability,
        entryBannerMessage: followUpAction.bannerMessage,
        ...(selectedSceneAppExecutionSummary
          ? {
              initialSceneAppExecutionSummary: selectedSceneAppExecutionSummary,
            }
          : {}),
      });
    },
    [
      onNavigate,
      selectedProjectId,
      selectedSceneAppExecutionReferenceEntry,
      selectedSceneAppExecutionSummary,
    ],
  );
  const handleSaveSelectedRunAsInspiration = useCallback(() => {
    void saveSceneAppExecutionAsInspiration({
      summary: selectedSceneAppExecutionSummary,
      detailView: selectedRunDetailView,
      projectId: selectedProjectId,
      sessionId: selectedRunSessionId || latestPackResultSessionId,
    });
  }, [
    latestPackResultSessionId,
    selectedProjectId,
    selectedRunDetailView,
    selectedRunSessionId,
    selectedSceneAppExecutionSummary,
  ]);
  const selectedRunSavedAsInspiration = useMemo(() => {
    void curatedTaskRecommendationSignalsVersion;
    return hasSavedSceneAppExecutionAsInspiration({
      summary: selectedSceneAppExecutionSummary,
      detailView: selectedRunDetailView,
      projectId: selectedProjectId,
      sessionId: selectedRunSessionId || latestPackResultSessionId,
    });
  }, [
    curatedTaskRecommendationSignalsVersion,
    latestPackResultSessionId,
    selectedProjectId,
    selectedRunDetailView,
    selectedRunSessionId,
    selectedSceneAppExecutionSummary,
  ]);
  const handleOpenInspirationLibrary = useCallback(() => {
    onNavigate(
      "memory",
      buildSceneAppExecutionInspirationLibraryPageParams({
        summary: selectedSceneAppExecutionSummary,
        detailView: selectedRunDetailView,
      }),
    );
  }, [onNavigate, selectedRunDetailView, selectedSceneAppExecutionSummary]);

  const persistSelectedRunHumanReview = useCallback(
    async (
      request: AgentRuntimeSaveReviewDecisionRequest,
      options?: {
        closeDialog?: boolean;
        successMessage?: string;
      },
    ) => {
      setReviewDecisionSaving(true);
      try {
        const template = await saveAgentRuntimeReviewDecision(request);
        setReviewDecisionTemplate(template);
        if (options?.closeDialog !== false) {
          setReviewDecisionDialogOpen(false);
        }
        toast.success(options?.successMessage ?? "已保存人工复核结果");

        setSelectedPlanLoading(true);
        setSelectedPlanError(null);
        try {
          const refreshedPlan = await refreshSelectedPlanResult();
          if (refreshedPlan) {
            setSelectedPlanResult(refreshedPlan);
          }
        } catch (error) {
          setSelectedPlanError(formatSceneAppErrorMessage(error));
        } finally {
          setSelectedPlanLoading(false);
        }
      } catch (error) {
        toast.error(formatSceneAppErrorMessage(error));
      } finally {
        setReviewDecisionSaving(false);
      }
    },
    [refreshSelectedPlanResult],
  );

  const handleSaveSelectedRunHumanReview = useCallback(
    async (request: AgentRuntimeSaveReviewDecisionRequest) => {
      await persistSelectedRunHumanReview(request);
    },
    [persistSelectedRunHumanReview],
  );

  const handleApplySelectedRunQuickReview = useCallback(
    (actionKey: SceneAppQuickReviewAction["key"]) => {
      if (!canOpenSelectedRunHumanReview || !selectedRunSessionId) {
        toast.error("当前运行还没有关联会话，暂时无法记录轻量反馈。");
        return;
      }

      const action = SCENEAPP_QUICK_REVIEW_ACTIONS.find(
        (item) => item.key === actionKey,
      );
      if (!action) {
        return;
      }

      void (async () => {
        const template = await resolveSelectedRunReviewDecisionTemplate();
        if (!template) {
          return;
        }

        await persistSelectedRunHumanReview(
          buildSceneAppQuickReviewDecisionRequest({
            template,
            action,
            sceneTitle: selectedDescriptor?.title,
            failureSignal:
              selectedRunDetailView?.failureSignalLabel ??
              governanceView?.topFailureSignalLabel,
            sourceLabel: "整套做法",
          }),
          {
            closeDialog: false,
            successMessage: `已记录「${action.label}」判断`,
          },
        );
      })();
    },
    [
      canOpenSelectedRunHumanReview,
      governanceView?.topFailureSignalLabel,
      persistSelectedRunHumanReview,
      resolveSelectedRunReviewDecisionTemplate,
      selectedDescriptor?.title,
      selectedRunDetailView?.failureSignalLabel,
      selectedRunSessionId,
    ],
  );

  const openSelectedRunFileEntry = useCallback(
    (
      entry:
        | {
            label: string;
            artifactRef: {
              relativePath?: string | null;
              absolutePath?: string | null;
              projectId?: string | null;
            };
          }
        | undefined,
      options: {
        missingPathMessage: string;
        bannerPrefix: string;
      },
    ) => {
      if (!entry) {
        return;
      }

      const target = resolveSceneAppRuntimeArtifactOpenTarget({
        entry,
        fallbackProjectId: selectedProjectId,
        bannerPrefix: options.bannerPrefix,
      });
      if (!target) {
        toast.error(options.missingPathMessage);
        return;
      }

      onNavigate("agent", {
        agentEntry: "claw",
        projectId: target.projectId,
        initialProjectFileOpenTarget: {
          relativePath: target.openTargetPath,
          requestKey: Date.now(),
        },
        entryBannerMessage: target.bannerMessage,
      });
    },
    [onNavigate, selectedProjectId],
  );

  const handleOpenSelectedRunEntryAction = useCallback(
    (
      action?: NonNullable<
        NonNullable<typeof selectedRunDetailView>["entryAction"]
      >,
    ) => {
      const entryAction = action ?? selectedRunEntryAction;
      if (!entryAction) {
        return;
      }
      const target = resolveSceneAppRunEntryNavigationTarget({
        action: entryAction,
        sceneappId:
          selectedRunSummary?.sceneappId ?? selectedDescriptor?.id ?? "",
        sceneTitle: selectedDescriptor?.title,
        sourceLabel: "最近结果",
        projectId: selectedProjectId,
        linkedServiceSkillId: selectedDescriptor?.linkedServiceSkillId,
        linkedSceneKey: selectedDescriptor?.linkedSceneKey,
      });
      if (!target) {
        toast.error("当前运行缺少可恢复的入口上下文。");
        return;
      }

      onNavigate(target.page, target.params);
    },
    [
      onNavigate,
      selectedDescriptor,
      selectedProjectId,
      selectedRunEntryAction,
      selectedRunSummary,
    ],
  );

  const handleOpenSelectedRunDeliveryArtifact = useCallback(
    (
      artifactEntry?: NonNullable<
        NonNullable<
          typeof selectedRunDetailView
        >["deliveryArtifactEntries"][number]
      >,
    ) => {
      openSelectedRunFileEntry(artifactEntry, {
        missingPathMessage: "当前这次运行还没有可打开的结果文件路径。",
        bannerPrefix: "已从最近结果打开结果文件",
      });
    },
    [openSelectedRunFileEntry],
  );

  const handleOpenSelectedRunGovernanceArtifact = useCallback(
    (
      artifactEntry?: NonNullable<
        NonNullable<
          typeof selectedRunDetailView
        >["governanceArtifactEntries"][number]
      >,
    ) => {
      const runId = selectedRunSummary?.runId?.trim();
      if (!artifactEntry) {
        return;
      }

      void (async () => {
        if (runId) {
          try {
            const refreshed = await prepareSceneAppRunGovernanceArtifact(
              runId,
              artifactEntry.artifactRef.kind,
            );
            if (!refreshed) {
              toast.error("当前运行已不存在，无法继续准备结果材料。");
              return;
            }
            setSelectedRunSummary(refreshed);
          } catch (error) {
            toast.error(formatSceneAppErrorMessage(error));
            return;
          }
        }

        openSelectedRunFileEntry(artifactEntry, {
          missingPathMessage: "当前这次运行还没有可打开的证据或复核文件。",
          bannerPrefix: "已从最近结果打开结果材料",
        });
      })();
    },
    [openSelectedRunFileEntry, selectedRunSummary?.runId],
  );

  const handleRunSelectedGovernanceAction = useCallback(
    (
      action?: NonNullable<
        NonNullable<
          typeof selectedRunDetailView
        >["governanceActionEntries"][number]
      >,
    ) => {
      const runId = selectedRunSummary?.runId?.trim();
      if (!action || !runId || !selectedDescriptor) {
        return;
      }

      void (async () => {
        try {
          const refreshed = await prepareSceneAppRunGovernanceArtifacts(
            runId,
            action.artifactKinds,
          );
          if (!refreshed) {
            toast.error("当前运行已不存在，无法继续准备后续动作。");
            return;
          }

          setSelectedRunSummary(refreshed);
          const refreshedDetailView = buildSceneAppRunDetailViewModel({
            descriptor: selectedDescriptor,
            run: refreshed,
            planResult: selectedPlanResult,
          });
          const targetEntry =
            refreshedDetailView.governanceArtifactEntries.find(
              (entry) => entry.artifactRef.kind === action.primaryArtifactKind,
            );
          openSelectedRunFileEntry(targetEntry, {
            missingPathMessage: `后续动作已准备完成，但当前没有可打开的${action.primaryArtifactLabel}路径。`,
            bannerPrefix: "已从最近结果打开后续动作",
          });
        } catch (error) {
          toast.error(formatSceneAppErrorMessage(error));
        }
      })();
    },
    [
      openSelectedRunFileEntry,
      selectedDescriptor,
      selectedPlanResult,
      selectedRunSummary?.runId,
    ],
  );

  const launchSeed = useMemo<SceneAppSeed | null>(() => {
    if (!selectedDescriptor) {
      return null;
    }

    return resolveSceneAppSeed({
      descriptor: selectedDescriptor,
      input: launchInput,
      urlCandidate,
    });
  }, [launchInput, selectedDescriptor, urlCandidate]);

  const selectedDetailView = useMemo(() => {
    if (!selectedDescriptor) {
      return null;
    }

    return buildSceneAppDetailViewModel({
      descriptor: selectedDescriptor,
      entryCard: selectedEntryCard,
      launchSeed,
      planResult: selectedPlanResult,
    });
  }, [launchSeed, selectedDescriptor, selectedEntryCard, selectedPlanResult]);
  const reusableLaunchPlanResult = useMemo(() => {
    if (
      !selectedDescriptor ||
      !launchSeed ||
      !selectedPlanResult ||
      selectedPlanLoading ||
      selectedPlanError
    ) {
      return null;
    }

    if (selectedPlanResult.descriptor.id !== selectedDescriptor.id) {
      return null;
    }

    // 当前输入还没和预览 planning 收敛时，启动仍应走实时规划，避免复用旧上下文。
    if (launchInput !== effectivePrefillIntent) {
      return null;
    }

    return selectedPlanResult;
  }, [
    effectivePrefillIntent,
    launchInput,
    launchSeed,
    selectedDescriptor,
    selectedPlanError,
    selectedPlanLoading,
    selectedPlanResult,
  ]);

  const launchDisabledReason = useMemo(() => {
    if (!selectedDescriptor) {
      return "先选择一套做法";
    }
    if (selectedEntryCard?.disabledReason) {
      return selectedEntryCard.disabledReason;
    }
    if (!launchSeed) {
      return "这套做法需要在输入里包含明确的 URL";
    }
    return undefined;
  }, [launchSeed, selectedDescriptor, selectedEntryCard?.disabledReason]);
  const saveContextBaselineDisabledReason = useMemo(() => {
    if (!selectedDescriptor) {
      return "先选择一套做法";
    }
    if (!selectedProjectId?.trim()) {
      return "先绑定项目工作区，才能写入当前做法基线";
    }
    if (!launchInput.trim() && selectedReferenceMemoryIds.length === 0) {
      return "先带入灵感对象或启动输入，再写入当前做法基线";
    }
    return undefined;
  }, [
    launchInput,
    selectedDescriptor,
    selectedProjectId,
    selectedReferenceMemoryIds,
  ]);

  const recentVisits = useMemo<SceneAppRecentVisitItem[]>(() => {
    return recentVisitRecords.slice(0, 4).map((record) => {
      const descriptor =
        allDescriptors.find((item) => item.id === record.sceneappId) ?? null;
      const businessLabel = descriptor
        ? getSceneAppPresentationCopy(descriptor).businessLabel
        : "最近访问";
      const title = descriptor?.title ?? record.sceneappId ?? "未命名做法";
      const summary =
        record.prefillIntent && record.prefillIntent.trim()
          ? truncateSingleLine(record.prefillIntent)
          : (descriptor?.summary ?? "继续上一次做法上下文");

      return {
        key: `${record.sceneappId}:${record.projectId ?? ""}`,
        title,
        businessLabel,
        summary,
        hint: buildRecentVisitHint(record),
        visitedAt: record.visitedAt,
        params: normalizeSceneAppsPageParams(record),
        isCurrent:
          record.sceneappId === selectedSceneAppId &&
          (record.projectId ?? null) === selectedProjectId,
      };
    });
  }, [
    allDescriptors,
    recentVisitRecords,
    selectedProjectId,
    selectedSceneAppId,
  ]);

  const handleResumeRecentVisit = useCallback(
    (params: SceneAppsPageParams) => {
      const normalizedParams = normalizeSceneAppsPageParams({
        ...params,
        view: resolveSceneAppsViewMode(params),
      });
      const normalizedParamsKey =
        serializeSceneAppsPageParams(normalizedParams);

      setPageStateTouched(true);
      appliedExternalParamsKeyRef.current = normalizedParamsKey;
      requestedPageParamsSyncKeyRef.current = normalizedParamsKey;
      applySceneAppsPageParams(normalizedParams);
      onNavigate("sceneapps", normalizedParams);
    },
    [applySceneAppsPageParams, onNavigate],
  );

  const handleSearchQueryChange = useCallback((value: string) => {
    setPageStateTouched(true);
    setSearchQuery(value);
  }, []);

  const handleTypeFilterChange = useCallback((value: SceneAppTypeFilter) => {
    setPageStateTouched(true);
    setTypeFilter(value);
  }, []);

  const handlePatternFilterChange = useCallback(
    (value: SceneAppPatternFilter) => {
      setPageStateTouched(true);
      setPatternFilter(value);
    },
    [],
  );

  const handleResetCatalogFilters = useCallback(() => {
    setPageStateTouched(true);
    setSearchQuery("");
    setTypeFilter("all");
    setPatternFilter("all");
    setViewMode("catalog");
  }, []);

  const handleViewModeChange = useCallback((value: SceneAppsViewMode) => {
    setPageStateTouched(true);
    setViewMode(value);
  }, []);

  const handleSelectSceneApp = useCallback((sceneappId: string) => {
    setPageStateTouched(true);
    setSelectedSceneAppId(sceneappId);
    setViewMode("detail");
  }, []);

  const handleProjectChange = useCallback((projectId: string) => {
    setPageStateTouched(true);
    setSelectedProjectId(projectId);
  }, []);

  const handleLaunchInputChange = useCallback((value: string) => {
    setPageStateTouched(true);
    setLaunchInput(value);
  }, []);

  const handleSelectRun = useCallback((runId: string) => {
    setPageStateTouched(true);
    setSelectedRunId(runId);
  }, []);

  const handleLaunchSelected = useCallback(async () => {
    if (!selectedDescriptor) {
      toast.error("请先选择一套做法");
      return;
    }

    if (!launchSeed) {
      toast.error("这套做法需要明确链接或启动输入，请先补齐后再继续");
      return;
    }

    await launchRuntime.launchSceneApp({
      descriptor: selectedDescriptor,
      seed: launchSeed,
      entrySource: "sceneapps_page",
      referenceMemoryIds: selectedReferenceMemoryIds,
      planResult: reusableLaunchPlanResult ?? undefined,
    });
  }, [
    launchRuntime,
    launchSeed,
    reusableLaunchPlanResult,
    selectedDescriptor,
    selectedReferenceMemoryIds,
  ]);

  const handleSaveContextBaseline = useCallback(async () => {
    if (!selectedDescriptor) {
      toast.error("请先选择一套做法");
      return;
    }

    const trimmedProjectId = selectedProjectId?.trim();
    if (!trimmedProjectId) {
      toast.error("请先绑定项目工作区，再写入当前做法基线。");
      return;
    }

    if (!launchInput.trim() && selectedReferenceMemoryIds.length === 0) {
      toast.error("请先带入灵感对象或启动输入，再写入当前做法基线。");
      return;
    }

    setSavingContextBaseline(true);
    try {
      const savedPlanResult = await saveSceneAppContextBaseline({
        sceneappId: selectedDescriptor.id,
        entrySource: "sceneapp_detail_save_context_baseline",
        workspaceId: trimmedProjectId,
        projectId: trimmedProjectId,
        userInput: launchInput.trim() || undefined,
        referenceMemoryIds: selectedReferenceMemoryIds,
        slots: launchSeed?.slots,
      });
      setSelectedPlanResult(savedPlanResult);
      setSelectedPlanError(null);
      toast.success("已写入当前做法基线");
    } catch (error) {
      toast.error(formatSceneAppErrorMessage(error));
    } finally {
      setSavingContextBaseline(false);
    }
  }, [
    launchInput,
    launchSeed,
    selectedDescriptor,
    selectedProjectId,
    selectedReferenceMemoryIds,
  ]);

  return {
    allDescriptors,
    filteredDescriptors,
    workbenchStats,
    catalogCards,
    catalog,
    catalogLoading,
    catalogError,
    catalogRuntimeLoading,
    catalogRuntimeError,
    refreshCatalog,
    searchQuery,
    handleSearchQueryChange,
    typeFilter,
    handleTypeFilterChange,
    patternFilter,
    handlePatternFilterChange,
    handleResetCatalogFilters,
    viewMode,
    handleViewModeChange,
    selectedSceneAppId,
    handleSelectSceneApp,
    selectedDescriptor,
    selectedProjectId,
    selectedReferenceMemoryIds,
    handleProjectChange,
    launchInput,
    handleLaunchInputChange,
    selectedEntryCard,
    launchSeed,
    selectedDetailView,
    selectedPlanLoading,
    selectedPlanError,
    savingContextBaseline,
    saveContextBaselineDisabledReason,
    launchDisabledReason,
    launchingSceneAppId: launchRuntime.sceneAppLaunchingId,
    recentVisits,
    handleResumeRecentVisit,
    handleLaunchSelected,
    handleSaveContextBaseline,
    scorecard,
    scorecardView,
    scorecardLoading,
    scorecardError,
    governanceView,
    runs,
    runListItems,
    runsLoading,
    runsError,
    selectedRunId,
    handleSelectRun,
    selectedRunSummary,
    selectedRunDetailView,
    latestPackResultDetailView,
    latestPackResultUsesFallback,
    latestReviewFeedbackSignal,
    handleContinueReviewFeedback,
    handleSaveSelectedRunAsInspiration,
    handleOpenInspirationLibrary,
    selectedRunSavedAsInspiration,
    selectedRunLoading,
    selectedRunError,
    canOpenSelectedRunHumanReview,
    quickReviewActions: SCENEAPP_QUICK_REVIEW_ACTIONS,
    reviewDecisionDialogOpen,
    reviewDecisionTemplate,
    reviewDecisionLoading,
    reviewDecisionSaving,
    setReviewDecisionDialogOpen,
    handleOpenSelectedRunHumanReview,
    handleSaveSelectedRunHumanReview,
    handleApplySelectedRunQuickReview,
    handleOpenSelectedRunEntryAction,
    handleOpenSelectedRunDeliveryArtifact,
    handleOpenSelectedRunGovernanceArtifact,
    handleRunSelectedGovernanceAction,
    automationDialogOpen: launchRuntime.automationDialogOpen,
    automationDialogInitialValues: launchRuntime.automationDialogInitialValues,
    automationWorkspaces: launchRuntime.automationWorkspaces,
    automationJobSaving: launchRuntime.automationJobSaving,
    handleAutomationDialogOpenChange:
      launchRuntime.handleAutomationDialogOpenChange,
    handleAutomationDialogSubmit: launchRuntime.handleAutomationDialogSubmit,
  };
}
