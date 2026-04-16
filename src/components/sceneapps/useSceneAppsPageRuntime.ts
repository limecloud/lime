import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getSceneAppRunSummary,
  getSceneAppScorecard,
  listSceneAppCatalog,
  listSceneAppRuns,
  prepareSceneAppRunGovernanceArtifact,
  prepareSceneAppRunGovernanceArtifacts,
  type SceneAppCatalog,
  type SceneAppCloudSceneRuntimeRef,
  type SceneAppDescriptor,
  type SceneAppNativeSkillRuntimeRef,
  type SceneAppPattern,
  type SceneAppRunSummary,
  type SceneAppScorecard,
  type SceneAppType,
} from "@/lib/api/sceneapp";
import {
  buildSceneAppCatalogCardViewModel,
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
  serializeSceneAppsPageParams,
  formatSceneAppErrorMessage,
  listSceneAppRecentVisits,
  useSceneAppLaunchRuntime,
  type SceneAppEntryCardItem,
  type SceneAppRecentVisitRecord,
  type SceneAppSeed,
  type SceneAppsPageParams,
  type SceneAppsView,
} from "@/lib/sceneapp";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import type { ChatToolPreferences } from "@/components/agent/chat/utils/chatToolPreferences";
import { extractExplicitUrlFromText } from "@/components/agent/chat/utils/browserAssistIntent";
import type { Page, PageParams } from "@/types/page";

export type SceneAppTypeFilter = "all" | SceneAppType;
export type SceneAppPatternFilter = "all" | SceneAppPattern;
export type SceneAppsViewMode = SceneAppsView;

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
    parts.push("带运行复盘");
  }
  if (record.search) {
    parts.push(`筛选：${record.search}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "恢复最近一次浏览上下文";
}

function normalizeSceneAppSlotValues(
  slots?: Record<string, string>,
): Record<string, string> | undefined {
  if (!slots) {
    return undefined;
  }

  const normalizedEntries = Object.entries(slots)
    .map(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();
      if (!normalizedKey || !normalizedValue) {
        return null;
      }

      return [normalizedKey, normalizedValue] as const;
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry));

  if (normalizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(normalizedEntries);
}

function buildCloudSceneResumeRequestMetadata(params: {
  sceneappId: string;
  runtimeRef: SceneAppCloudSceneRuntimeRef;
}): Record<string, unknown> {
  return {
    sceneapp: {
      id: params.sceneappId,
    },
    harness: {
      service_scene_launch: {
        kind: "cloud_scene",
        service_scene_run: {
          sceneapp_id: params.sceneappId,
          scene_key: params.runtimeRef.sceneKey ?? null,
          skill_id: params.runtimeRef.skillId ?? null,
          linked_skill_id: params.runtimeRef.skillId ?? null,
          project_id: params.runtimeRef.projectId ?? null,
          content_id: params.runtimeRef.contentId ?? null,
          workspace_id: params.runtimeRef.workspaceId ?? null,
          entry_source:
            params.runtimeRef.entrySource?.trim() || "sceneapp_run_resume",
          user_input: params.runtimeRef.userInput ?? null,
          slots: normalizeSceneAppSlotValues(params.runtimeRef.slots) ?? {},
        },
      },
    },
  };
}

function buildCloudSceneResumePrompt(params: {
  title: string;
  runtimeRef: SceneAppCloudSceneRuntimeRef;
}): string {
  const userInput = params.runtimeRef.userInput?.trim();
  if (userInput) {
    return userInput;
  }

  const slotSummary = Object.entries(
    normalizeSceneAppSlotValues(params.runtimeRef.slots) ?? {},
  )
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${value}`)
    .join("；");

  if (slotSummary) {
    return `请继续执行场景应用「${params.title}」。场景参数：${slotSummary}。`;
  }

  return `请继续执行场景应用「${params.title}」，并按最近一次云端 Scene 运行上下文继续。`;
}

function buildNativeSkillResumeRequestMetadata(params: {
  sceneappId: string;
  runtimeRef: SceneAppNativeSkillRuntimeRef;
}): Record<string, unknown> | undefined {
  const slots = normalizeSceneAppSlotValues(params.runtimeRef.slots);
  const hasPayload =
    Boolean(params.runtimeRef.skillId?.trim()) ||
    Boolean(params.runtimeRef.skillKey?.trim()) ||
    Boolean(params.runtimeRef.projectId?.trim()) ||
    Boolean(params.runtimeRef.workspaceId?.trim()) ||
    Boolean(params.runtimeRef.userInput?.trim()) ||
    Boolean(slots);

  if (!hasPayload) {
    return undefined;
  }

  return {
    sceneapp: {
      id: params.sceneappId,
    },
    harness: {
      sceneapp_native_skill_launch: {
        skill_id: params.runtimeRef.skillId ?? null,
        skill_key: params.runtimeRef.skillKey ?? null,
        project_id: params.runtimeRef.projectId ?? null,
        workspace_id: params.runtimeRef.workspaceId ?? null,
        user_input: params.runtimeRef.userInput ?? null,
        slots: slots ?? {},
      },
    },
  };
}

export function useSceneAppsPageRuntime({
  onNavigate,
  pageParams,
}: UseSceneAppsPageRuntimeParams) {
  const appliedExternalParamsKeyRef = useRef<string | null>(null);
  const [pageStateTouched, setPageStateTouched] = useState(
    serializeSceneAppsPageParams(pageParams) !== "{}",
  );
  const [catalog, setCatalog] = useState<SceneAppCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(pageParams?.search ?? "");
  const [typeFilter, setTypeFilter] = useState<SceneAppTypeFilter>(
    pageParams?.typeFilter ?? "all",
  );
  const [patternFilter, setPatternFilter] =
    useState<SceneAppPatternFilter>(pageParams?.patternFilter ?? "all");
  const [viewMode, setViewMode] = useState<SceneAppsViewMode>(
    resolveSceneAppsViewMode(pageParams),
  );
  const [selectedSceneAppId, setSelectedSceneAppId] = useState<string | null>(
    pageParams?.sceneappId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    pageParams?.projectId ?? null,
  );
  const [launchInput, setLaunchInput] = useState(
    pageParams?.prefillIntent ?? "",
  );
  const [scorecard, setScorecard] = useState<SceneAppScorecard | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);
  const [scorecardError, setScorecardError] = useState<string | null>(null);
  const [runs, setRuns] = useState<SceneAppRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunSummary, setSelectedRunSummary] =
    useState<SceneAppRunSummary | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [selectedRunError, setSelectedRunError] = useState<string | null>(null);
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
        search: pageParams?.search,
        typeFilter: pageParams?.typeFilter,
        patternFilter: pageParams?.patternFilter,
      }),
    [
      pageParams?.view,
      pageParams?.patternFilter,
      pageParams?.prefillIntent,
      pageParams?.projectId,
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

  useEffect(() => {
    setPageStateTouched(hasIncomingPageState);

    if (appliedExternalParamsKeyRef.current === normalizedIncomingPageParamsKey) {
      return;
    }

    appliedExternalParamsKeyRef.current = normalizedIncomingPageParamsKey;

    const nextSearchQuery = normalizedIncomingPageParams.search ?? "";
    const nextTypeFilter = normalizedIncomingPageParams.typeFilter ?? "all";
    const nextPatternFilter = normalizedIncomingPageParams.patternFilter ?? "all";
    const nextViewMode = resolveSceneAppsViewMode(normalizedIncomingPageParams);
    const nextSceneAppId = normalizedIncomingPageParams.sceneappId ?? null;
    const nextRunId = normalizedIncomingPageParams.runId ?? null;
    const nextProjectId = normalizedIncomingPageParams.projectId ?? null;
    const nextLaunchInput = normalizedIncomingPageParams.prefillIntent ?? "";

    setSearchQuery((current) =>
      current === nextSearchQuery ? current : nextSearchQuery,
    );
    setTypeFilter((current) =>
      current === nextTypeFilter ? current : nextTypeFilter,
    );
    setPatternFilter((current) =>
      current === nextPatternFilter ? current : nextPatternFilter,
    );
    setViewMode((current) => (current === nextViewMode ? current : nextViewMode));
    setSelectedSceneAppId((current) =>
      current === nextSceneAppId ? current : nextSceneAppId,
    );
    setSelectedRunId((current) => (current === nextRunId ? current : nextRunId));
    setSelectedProjectId((current) =>
      current === nextProjectId ? current : nextProjectId,
    );
    setLaunchInput((current) =>
      current === nextLaunchInput ? current : nextLaunchInput,
    );
  }, [
    hasIncomingPageState,
    normalizedIncomingPageParams,
    normalizedIncomingPageParamsKey,
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

  const allDescriptors = useMemo(() => catalog?.items ?? [], [catalog]);

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
    () => filteredDescriptors.map((descriptor) =>
      buildSceneAppCatalogCardViewModel(descriptor),
    ),
    [filteredDescriptors],
  );

  useEffect(() => {
    if (filteredDescriptors.length === 0) {
      setSelectedSceneAppId(null);
      return;
    }

    if (
      selectedSceneAppId &&
      filteredDescriptors.some((descriptor) => descriptor.id === selectedSceneAppId)
    ) {
      return;
    }

    setSelectedSceneAppId(
      pageParams?.sceneappId &&
        filteredDescriptors.some(
          (descriptor) => descriptor.id === pageParams.sceneappId,
        )
        ? pageParams.sceneappId
        : filteredDescriptors[0]?.id ?? null,
    );
  }, [filteredDescriptors, pageParams?.sceneappId, selectedSceneAppId]);

  const selectedDescriptor = useMemo(
    () =>
      selectedSceneAppId
        ? allDescriptors.find((descriptor) => descriptor.id === selectedSceneAppId) ??
          null
        : null,
    [allDescriptors, selectedSceneAppId],
  );

  useEffect(() => {
    if (!selectedDescriptor) {
      setScorecard(null);
      setRuns([]);
      setScorecardError(null);
      setRunsError(null);
      setSelectedRunId(null);
      setSelectedRunSummary(null);
      setSelectedRunLoading(false);
      setSelectedRunError(null);
      return;
    }

    let cancelled = false;
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
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setRuns([]);
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
  }, [selectedDescriptor]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    if (selectedRunId && runs.some((run) => run.runId === selectedRunId)) {
      return;
    }

    setSelectedRunId(runs[0]?.runId ?? null);
  }, [runs, selectedRunId]);

  const syncedPageParams = useMemo(
    () =>
      normalizeSceneAppsPageParams({
        view: viewMode,
        sceneappId: selectedSceneAppId ?? undefined,
        runId: selectedRunId ?? undefined,
        projectId: selectedProjectId ?? undefined,
        prefillIntent: debouncedLaunchInput,
        search: debouncedSearchQuery,
        typeFilter: typeFilter !== "all" ? typeFilter : undefined,
        patternFilter: patternFilter !== "all" ? patternFilter : undefined,
      }),
    [
      debouncedLaunchInput,
      debouncedSearchQuery,
      patternFilter,
      selectedProjectId,
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

  useEffect(() => {
    if (!shouldSyncPageParams) {
      return;
    }
    if (syncedPageParamsKey === normalizedIncomingPageParamsKey) {
      return;
    }

    onNavigate("sceneapps", syncedPageParams);
  }, [
    hasIncomingPageState,
    normalizedIncomingPageParamsKey,
    onNavigate,
    shouldSyncPageParams,
    syncedPageParams,
    syncedPageParamsKey,
  ]);

  useEffect(() => {
    if (!shouldSyncPageParams || !syncedPageParams.sceneappId) {
      return;
    }

    setRecentVisitRecords(recordSceneAppRecentVisit(syncedPageParams));
  }, [shouldSyncPageParams, syncedPageParams, syncedPageParamsKey]);

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

  const scorecardView = useMemo(
    () =>
      buildSceneAppScorecardViewModel({
        descriptor: selectedDescriptor,
        scorecard,
      }),
    [scorecard, selectedDescriptor],
  );
  const governanceView = useMemo(
    () =>
      selectedDescriptor
        ? buildSceneAppGovernancePanelViewModel({
            descriptor: selectedDescriptor,
            scorecard,
            run: selectedRunSummary,
          })
        : null,
    [scorecard, selectedDescriptor, selectedRunSummary],
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
    });
  }, [selectedDescriptor, selectedRunSummary]);

  const selectedRunEntryAction = selectedRunDetailView?.entryAction;

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

      const relativePath = entry.artifactRef.relativePath?.trim();
      const absolutePath = entry.artifactRef.absolutePath?.trim();
      const projectId =
        entry.artifactRef.projectId?.trim() || selectedProjectId || undefined;
      const openTargetPath = projectId
        ? relativePath || absolutePath
        : absolutePath || relativePath;

      if (!openTargetPath) {
        toast.error(options.missingPathMessage);
        return;
      }

      onNavigate("agent", {
        agentEntry: "claw",
        projectId,
        initialProjectFileOpenTarget: {
          relativePath: openTargetPath,
          requestKey: Date.now(),
        },
        entryBannerMessage: `${options.bannerPrefix}：${entry.label}。`,
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

      if (entryAction.kind === "open_automation_job") {
        onNavigate("automation", {
          selectedJobId: entryAction.jobId,
          workspaceTab: "tasks",
        });
        return;
      }

      if (entryAction.kind === "open_agent_session") {
        onNavigate("agent", {
          agentEntry: "claw",
          initialSessionId: entryAction.sessionId,
          entryBannerMessage: "已从 SceneApp 运行复盘恢复对应 Agent 会话。",
        });
        return;
      }

      if (entryAction.kind === "open_browser_runtime") {
        onNavigate("browser-runtime", {
          initialProfileKey:
            entryAction.browserRuntimeRef.profileKey ?? undefined,
          initialSessionId:
            entryAction.browserRuntimeRef.sessionId ?? undefined,
          initialTargetId:
            entryAction.browserRuntimeRef.targetId ?? undefined,
        });
        return;
      }

      if (entryAction.kind === "open_cloud_scene_session") {
        if (entryAction.sessionId) {
          onNavigate("agent", {
            agentEntry: "claw",
            initialSessionId: entryAction.sessionId,
            entryBannerMessage: "已从 SceneApp 运行复盘恢复云端 Scene 会话。",
          });
          return;
        }

        onNavigate("agent", {
          agentEntry: "claw",
          projectId: entryAction.cloudSceneRuntimeRef.projectId ?? undefined,
          contentId: entryAction.cloudSceneRuntimeRef.contentId ?? undefined,
          initialUserPrompt: buildCloudSceneResumePrompt({
            title: selectedDescriptor?.title ?? "SceneApp",
            runtimeRef: entryAction.cloudSceneRuntimeRef,
          }),
          initialAutoSendRequestMetadata: buildCloudSceneResumeRequestMetadata({
            sceneappId: selectedRunSummary?.sceneappId ?? selectedDescriptor?.id ?? "",
            runtimeRef: entryAction.cloudSceneRuntimeRef,
          }),
          autoRunInitialPromptOnMount: true,
          entryBannerMessage: "已从 SceneApp 运行复盘恢复云端 Scene 上下文。",
        });
        return;
      }

      if (entryAction.kind === "open_native_skill_session") {
        if (entryAction.sessionId) {
          onNavigate("agent", {
            agentEntry: "claw",
            initialSessionId: entryAction.sessionId,
            entryBannerMessage: "已从 SceneApp 运行复盘恢复本机技能会话。",
          });
          return;
        }

        const initialPendingServiceSkillLaunch = {
          skillId:
            entryAction.nativeSkillRuntimeRef.skillId ??
            entryAction.nativeSkillRuntimeRef.skillKey ??
            selectedDescriptor?.linkedServiceSkillId ??
            selectedDescriptor?.linkedSceneKey ??
            selectedDescriptor?.id ??
            "",
          skillKey:
            entryAction.nativeSkillRuntimeRef.skillKey ??
            selectedDescriptor?.linkedSceneKey ??
            undefined,
          requestKey: Date.now(),
          initialSlotValues:
            normalizeSceneAppSlotValues(
              entryAction.nativeSkillRuntimeRef.slots,
            ) ?? undefined,
          prefillHint: "已从 SceneApp 最近一次运行恢复技能补参。",
          launchUserInput:
            entryAction.nativeSkillRuntimeRef.userInput ?? undefined,
        };

        onNavigate("agent", {
          agentEntry: "claw",
          projectId:
            entryAction.nativeSkillRuntimeRef.projectId ??
            selectedProjectId ??
            undefined,
          initialRequestMetadata: buildNativeSkillResumeRequestMetadata({
            sceneappId: selectedRunSummary?.sceneappId ?? selectedDescriptor?.id ?? "",
            runtimeRef: entryAction.nativeSkillRuntimeRef,
          }),
          initialPendingServiceSkillLaunch,
          entryBannerMessage: "已从 SceneApp 运行复盘恢复本机技能入口。",
        });
      }
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
        NonNullable<typeof selectedRunDetailView>["deliveryArtifactEntries"][number]
      >,
    ) => {
      openSelectedRunFileEntry(artifactEntry, {
        missingPathMessage: "当前这次运行还没有可打开的结果文件路径。",
        bannerPrefix: "已从 SceneApp 运行复盘打开结果文件",
      });
    },
    [openSelectedRunFileEntry],
  );

  const handleOpenSelectedRunGovernanceArtifact = useCallback(
    (
      artifactEntry?: NonNullable<
        NonNullable<typeof selectedRunDetailView>["governanceArtifactEntries"][number]
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
              toast.error("当前运行已不存在，无法继续准备治理文件。");
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
          bannerPrefix: "已从 SceneApp 运行复盘打开治理文件",
        });
      })();
    },
    [openSelectedRunFileEntry, selectedRunSummary?.runId],
  );

  const handleRunSelectedGovernanceAction = useCallback(
    (
      action?: NonNullable<
        NonNullable<typeof selectedRunDetailView>["governanceActionEntries"][number]
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
            toast.error("当前运行已不存在，无法继续准备治理动作。");
            return;
          }

          setSelectedRunSummary(refreshed);
          const refreshedDetailView = buildSceneAppRunDetailViewModel({
            descriptor: selectedDescriptor,
            run: refreshed,
          });
          const targetEntry = refreshedDetailView.governanceArtifactEntries.find(
            (entry) => entry.artifactRef.kind === action.primaryArtifactKind,
          );
          openSelectedRunFileEntry(targetEntry, {
            missingPathMessage: `治理动作已准备完成，但当前没有可打开的${action.primaryArtifactLabel}路径。`,
            bannerPrefix: `已从 SceneApp 运行复盘打开治理动作`,
          });
        } catch (error) {
          toast.error(formatSceneAppErrorMessage(error));
        }
      })();
    },
    [
      openSelectedRunFileEntry,
      selectedDescriptor,
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
    });
  }, [launchSeed, selectedDescriptor, selectedEntryCard]);

  const launchDisabledReason = useMemo(() => {
    if (!selectedDescriptor) {
      return "先选择一个场景应用";
    }
    if (selectedEntryCard?.disabledReason) {
      return selectedEntryCard.disabledReason;
    }
    if (!launchSeed) {
      return "这个场景需要在输入里包含明确的 URL";
    }
    return undefined;
  }, [launchSeed, selectedDescriptor, selectedEntryCard?.disabledReason]);

  const recentVisits = useMemo<SceneAppRecentVisitItem[]>(() => {
    return recentVisitRecords.slice(0, 4).map((record) => {
      const descriptor =
        allDescriptors.find((item) => item.id === record.sceneappId) ?? null;
      const businessLabel = descriptor
        ? getSceneAppPresentationCopy(descriptor).businessLabel
        : "最近访问";
      const title = descriptor?.title ?? record.sceneappId ?? "未命名 SceneApp";
      const summary =
        record.prefillIntent && record.prefillIntent.trim()
          ? truncateSingleLine(record.prefillIntent)
          : descriptor?.summary ?? "继续上一次场景上下文";

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
  }, [allDescriptors, recentVisitRecords, selectedProjectId, selectedSceneAppId]);

  const handleResumeRecentVisit = useCallback(
    (params: SceneAppsPageParams) => {
      setPageStateTouched(true);
      onNavigate("sceneapps", normalizeSceneAppsPageParams(params));
    },
    [onNavigate],
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
      toast.error("请先选择一个场景应用");
      return;
    }

    if (!launchSeed) {
      toast.error("当前场景需要明确链接或启动输入，请先补齐后再继续");
      return;
    }

    await launchRuntime.launchSceneApp({
      descriptor: selectedDescriptor,
      seed: launchSeed,
      entrySource: "sceneapps_page",
    });
  }, [launchRuntime, launchSeed, selectedDescriptor]);

  return {
    allDescriptors,
    filteredDescriptors,
    workbenchStats,
    catalogCards,
    catalog,
    catalogLoading,
    catalogError,
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
    handleProjectChange,
    launchInput,
    handleLaunchInputChange,
    selectedEntryCard,
    launchSeed,
    selectedDetailView,
    launchDisabledReason,
    launchingSceneAppId: launchRuntime.sceneAppLaunchingId,
    recentVisits,
    handleResumeRecentVisit,
    handleLaunchSelected,
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
    selectedRunLoading,
    selectedRunError,
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
