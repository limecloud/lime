import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FolderOpen, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useSkills } from "@/hooks/useSkills";
import type { Skill } from "@/lib/api/skills";
import type {
  Page,
  PageParams,
  SkillScaffoldDraft,
  SkillsPageParams,
} from "@/types/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CuratedTaskLauncherDialog } from "@/components/agent/chat/components/CuratedTaskLauncherDialog";
import { resolveServiceSkillEntryDescription } from "@/components/agent/chat/service-skills/entryAdapter";
import { buildServiceSkillRecommendationBuckets } from "@/components/agent/chat/service-skills/recommendedServiceSkills";
import { resolveServiceSkillLaunchPrefill } from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import {
  buildServiceSkillCapabilityDescription,
  getServiceSkillOutputDestination,
  getServiceSkillTypeLabel,
  summarizeServiceSkillRequiredInputs,
} from "@/components/agent/chat/service-skills/skillPresentation";
import type {
  ServiceSkillHomeItem,
  ServiceSkillTone,
} from "@/components/agent/chat/service-skills/types";
import { useServiceSkills } from "@/components/agent/chat/service-skills/useServiceSkills";
import { SkillsPage } from "./SkillsPage";
import {
  buildInstalledSkillCapabilityDescription,
  getInstalledSkillOutputHint,
  resolveInstalledSkillPromise,
  summarizeInstalledSkillRequiredInputs,
} from "./installedSkillPresentation";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { buildSkillScaffoldCreationReplayRequestMetadata } from "@/components/agent/chat/utils/creationReplayMetadata";
import {
  buildSkillScaffoldCreationSeed,
  buildSkillScaffoldReplayText,
} from "./skillScaffoldCreationSeed";
import {
  FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS,
  buildCuratedTaskRecentUsageDescription,
  buildCuratedTaskLaunchPrompt,
  filterCuratedTaskTemplates,
  getCuratedTaskOutputDestination,
  listCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  resolveCuratedTaskTemplateLaunchPrefill,
  subscribeCuratedTaskTemplateUsageChanged,
  summarizeCuratedTaskFollowUpActions,
  summarizeCuratedTaskOutputContract,
  summarizeCuratedTaskRequiredInputs,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";
import {
  buildSceneAppExecutionReviewPrefillHighlights,
  buildSceneAppExecutionReviewPrefillSnapshot,
} from "@/components/agent/chat/utils/sceneAppCuratedTaskReference";
import {
  buildCuratedTaskLaunchRequestMetadata,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
  type CuratedTaskReferenceEntry,
  normalizeCuratedTaskLaunchInputValues,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
import { buildReviewFeedbackProjection } from "@/components/agent/chat/utils/reviewFeedbackProjection";
import {
  getSlashEntryUsageMap,
  getSlashEntryUsageRecordKey,
  recordSlashEntryUsage,
  subscribeSlashEntryUsageChanged,
} from "@/components/agent/chat/skill-selection/slashEntryUsage";
import { buildServiceSkillLaunchPrefillSummary } from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import { resolveSceneAppsPageEntryParams } from "@/lib/sceneapp";

interface SkillsWorkspacePageProps {
  onNavigate: (page: Page, params?: PageParams) => void;
  pageParams?: SkillsPageParams;
}

const TONE_BADGE_CLASSNAMES: Record<ServiceSkillTone, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
};

const SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME =
  "rounded-2xl border border-emerald-200 bg-[image:var(--lime-primary-gradient)] px-4 text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";
const SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME =
  "rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900";

function normalizeKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function matchesText(
  query: string,
  ...values: Array<string | undefined>
): boolean {
  const normalizedQuery = normalizeKeyword(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function summarizeRecentReplayText(value: string, maxLength = 56): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function buildInstalledSkillRecentUsageDescription(
  replayText: string | undefined,
): string {
  const normalizedReplayText = replayText?.trim();
  if (!normalizedReplayText) {
    return "";
  }

  return `上次目标：${summarizeRecentReplayText(normalizedReplayText)}`;
}

function buildSkillGroupStarterSummary(skills: ServiceSkillHomeItem[]): string {
  const starterTitles = skills.slice(0, 2).map((skill) => `「${skill.title}」`);

  if (starterTitles.length === 0) {
    return "先带着这次目标进去继续收窄。";
  }

  return starterTitles.length < skills.length
    ? `这一组里可以先从${starterTitles.join(" / ")}等做法开始。`
    : `这一组里可以先从${starterTitles.join(" / ")}开始。`;
}

function resolveSkillCardTone(skill: ServiceSkillHomeItem): ServiceSkillTone {
  if (skill.automationStatus?.tone) {
    return skill.automationStatus.tone;
  }
  return skill.runnerTone;
}

function resolveSkillCardStatusLabel(skill: ServiceSkillHomeItem): string {
  if (skill.automationStatus?.statusLabel) {
    return skill.automationStatus.statusLabel;
  }
  return skill.runnerLabel;
}

function resolveSkillCardStatusDetail(skill: ServiceSkillHomeItem): string {
  if (skill.automationStatus?.detail) {
    return skill.automationStatus.detail;
  }
  return skill.runnerDescription;
}

function resolveSkillGroupKey(skill: ServiceSkillHomeItem): string {
  return (
    (skill as ServiceSkillHomeItem & { groupKey?: string }).groupKey ??
    "general"
  );
}

function buildServiceSkillGroupMap(
  skills: ServiceSkillHomeItem[],
  groupKeys: Array<{ key: string }>,
): Map<string, ServiceSkillHomeItem[]> {
  const nextMap = new Map<string, ServiceSkillHomeItem[]>();
  for (const group of groupKeys) {
    nextMap.set(group.key, []);
  }
  for (const skill of skills) {
    const groupKey = resolveSkillGroupKey(skill);
    const current = nextMap.get(groupKey) ?? [];
    current.push(skill);
    nextMap.set(groupKey, current);
  }
  return nextMap;
}

function listPreferredGroupSkills(
  skills: ServiceSkillHomeItem[],
): ServiceSkillHomeItem[] {
  const recommendationBuckets = buildServiceSkillRecommendationBuckets(skills, {
    featuredLimit: 0,
  });
  return recommendationBuckets.remainingSkills.length > 0
    ? recommendationBuckets.remainingSkills
    : recommendationBuckets.recentSkills;
}

export function SkillsWorkspacePage({
  onNavigate,
  pageParams,
}: SkillsWorkspacePageProps) {
  const {
    skills: serviceSkills,
    groups: skillGroups,
    error: serviceSkillsError,
    refresh: refreshServiceSkills,
  } = useServiceSkills();
  const {
    skills: localSkills,
    error: localSkillsError,
    refresh: refreshLocalSkills,
  } = useSkills("lime", { includeRepos: false });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [advancedManagerOpen, setAdvancedManagerOpen] = useState(false);
  const [curatedTaskLauncherTask, setCuratedTaskLauncherTask] =
    useState<CuratedTaskTemplateItem | null>(null);
  const [
    curatedTaskLauncherInitialInputValues,
    setCuratedTaskLauncherInitialInputValues,
  ] = useState<CuratedTaskInputValues | null>(null);
  const [
    curatedTaskLauncherInitialReferenceMemoryIds,
    setCuratedTaskLauncherInitialReferenceMemoryIds,
  ] = useState<string[] | null>(null);
  const [
    curatedTaskLauncherInitialReferenceEntries,
    setCuratedTaskLauncherInitialReferenceEntries,
  ] = useState<CuratedTaskReferenceEntry[] | null>(null);
  const [curatedTaskLauncherPrefillHint, setCuratedTaskLauncherPrefillHint] =
    useState<string | null>(null);
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  const [curatedTaskTemplatesVersion, setCuratedTaskTemplatesVersion] =
    useState(0);
  const [slashEntryUsageVersion, setSlashEntryUsageVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [
    highlightedInstalledSkillDirectory,
    setHighlightedInstalledSkillDirectory,
  ] = useState<string | null>(null);
  const [optimisticInstalledSkill, setOptimisticInstalledSkill] =
    useState<Skill | null>(null);
  const [consumedScaffoldRequestKey, setConsumedScaffoldRequestKey] = useState<
    number | null
  >(null);
  const lastHandledScaffoldRequestKeyRef = useRef<number | null>(null);

  const installedLocalSkills = useMemo(() => {
    const installedSkills = localSkills.filter((skill) => skill.installed);

    if (!optimisticInstalledSkill) {
      return installedSkills;
    }

    return [
      optimisticInstalledSkill,
      ...installedSkills.filter(
        (skill) => skill.directory !== optimisticInstalledSkill.directory,
      ),
    ];
  }, [localSkills, optimisticInstalledSkill]);
  const serviceSkillRecommendationBuckets = useMemo(
    () =>
      buildServiceSkillRecommendationBuckets(serviceSkills, {
        featuredLimit: 0,
        surface: "workspace",
      }),
    [serviceSkills],
  );
  const recentServiceSkills = serviceSkillRecommendationBuckets.recentSkills;
  const nonRecentServiceSkills =
    serviceSkillRecommendationBuckets.remainingSkills;
  const workspaceServiceSkills = useMemo(
    () => [...recentServiceSkills, ...nonRecentServiceSkills],
    [nonRecentServiceSkills, recentServiceSkills],
  );
  const allSkillGroupMap = useMemo(
    () => buildServiceSkillGroupMap(workspaceServiceSkills, skillGroups),
    [skillGroups, workspaceServiceSkills],
  );
  const recommendedSkillGroupMap = useMemo(
    () => buildServiceSkillGroupMap(nonRecentServiceSkills, skillGroups),
    [nonRecentServiceSkills, skillGroups],
  );
  const selectedGroup = useMemo(
    () => skillGroups.find((group) => group.key === selectedGroupKey) ?? null,
    [selectedGroupKey, skillGroups],
  );
  const creationProjectId = pageParams?.creationProjectId?.trim() || undefined;
  const scaffoldCreationReplay = useMemo(() => {
    if (!pageParams?.initialScaffoldDraft) {
      return undefined;
    }

    return buildSkillScaffoldCreationReplayRequestMetadata(
      pageParams.initialScaffoldDraft,
      {
        projectId: creationProjectId,
      },
    ).harness.creation_replay;
  }, [creationProjectId, pageParams?.initialScaffoldDraft]);

  useEffect(() => {
    if (selectedGroupKey && !selectedGroup) {
      setSelectedGroupKey(null);
    }
  }, [selectedGroup, selectedGroupKey]);

  useEffect(() => {
    return subscribeCuratedTaskTemplateUsageChanged(() => {
      setCuratedTaskTemplatesVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeSlashEntryUsageChanged(() => {
      setSlashEntryUsageVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    const requestKey = pageParams?.initialScaffoldRequestKey ?? null;
    if (
      !pageParams?.initialScaffoldDraft ||
      requestKey === null ||
      lastHandledScaffoldRequestKeyRef.current === requestKey
    ) {
      return;
    }

    lastHandledScaffoldRequestKeyRef.current = requestKey;
    setAdvancedManagerOpen(true);
  }, [pageParams?.initialScaffoldDraft, pageParams?.initialScaffoldRequestKey]);

  const handleBringScaffoldToCreation = useCallback(
    (draft: SkillScaffoldDraft) => {
      const seed = buildSkillScaffoldCreationSeed(draft);
      onNavigate(
        "agent",
        buildHomeAgentParams({
          projectId: creationProjectId,
          initialUserPrompt: seed.initialUserPrompt,
          entryBannerMessage: seed.entryBannerMessage,
          initialRequestMetadata:
            buildSkillScaffoldCreationReplayRequestMetadata(draft, {
              projectId: creationProjectId,
            }),
        }),
      );
    },
    [creationProjectId, onNavigate],
  );

  const visibleGroups = useMemo(() => {
    return skillGroups.filter((group) => {
      const groupSkills = allSkillGroupMap.get(group.key) ?? [];
      if (groupSkills.length === 0) {
        return false;
      }
      return matchesText(
        searchQuery,
        group.title,
        group.summary,
        group.entryHint,
        group.themeTarget,
        ...groupSkills.flatMap((skill) => [
          skill.title,
          skill.summary,
          skill.outputHint,
        ]),
      );
    });
  }, [allSkillGroupMap, searchQuery, skillGroups]);

  const visibleGroupSkills = useMemo(() => {
    const scopedSkills = selectedGroup
      ? listPreferredGroupSkills(allSkillGroupMap.get(selectedGroup.key) ?? [])
      : [];

    return scopedSkills.filter((skill) =>
      matchesText(
        searchQuery,
        skill.title,
        skill.summary,
        skill.category,
        skill.outputHint,
        skill.badge,
        skill.skillKey,
        buildServiceSkillCapabilityDescription(skill),
        getServiceSkillOutputDestination(skill),
        getServiceSkillTypeLabel(skill),
      ),
    );
  }, [allSkillGroupMap, searchQuery, selectedGroup]);

  const visibleRecentSkills = useMemo(() => {
    return recentServiceSkills.filter((skill) =>
      matchesText(
        searchQuery,
        skill.title,
        skill.summary,
        skill.category,
        skill.outputHint,
        buildServiceSkillCapabilityDescription(skill),
      ),
    );
  }, [recentServiceSkills, searchQuery]);

  const visibleInstalledLocalSkills = useMemo(() => {
    const filteredSkills = installedLocalSkills.filter((skill) =>
      matchesText(
        searchQuery,
        skill.name,
        skill.description,
        skill.key,
        skill.repoOwner,
        skill.repoName,
        buildInstalledSkillCapabilityDescription(skill),
      ),
    );

    if (!highlightedInstalledSkillDirectory) {
      return filteredSkills;
    }

    return [...filteredSkills].sort((left, right) => {
      const leftHighlighted =
        left.directory === highlightedInstalledSkillDirectory ? 1 : 0;
      const rightHighlighted =
        right.directory === highlightedInstalledSkillDirectory ? 1 : 0;

      if (leftHighlighted !== rightHighlighted) {
        return rightHighlighted - leftHighlighted;
      }

      return left.name.localeCompare(right.name, "zh-CN");
    });
  }, [highlightedInstalledSkillDirectory, installedLocalSkills, searchQuery]);
  const visibleCuratedTaskTemplates = useMemo(() => {
    void curatedTaskTemplatesVersion;
    void curatedTaskRecommendationSignalsVersion;
    return filterCuratedTaskTemplates(searchQuery, listCuratedTaskTemplates());
  }, [
    curatedTaskRecommendationSignalsVersion,
    curatedTaskTemplatesVersion,
    searchQuery,
  ]);
  const visibleFeaturedCuratedTaskTemplates = useMemo(
    () =>
      listFeaturedHomeCuratedTaskTemplates(visibleCuratedTaskTemplates, {
        projectId: pageParams?.creationProjectId,
        limit: FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS.length,
      }),
    [pageParams?.creationProjectId, visibleCuratedTaskTemplates],
  );
  const latestReviewRecommendationSignal = useMemo(() => {
    void curatedTaskRecommendationSignalsVersion;
    return (
      listCuratedTaskRecommendationSignals({
        projectId: pageParams?.creationProjectId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [curatedTaskRecommendationSignalsVersion, pageParams?.creationProjectId]);
  const reviewRecommendationBanner = useMemo(() => {
    if (!latestReviewRecommendationSignal) {
      return null;
    }

    const projection = buildReviewFeedbackProjection({
      signal: latestReviewRecommendationSignal,
    });
    const highlightedTemplates = visibleFeaturedCuratedTaskTemplates
      .filter((featured) => featured.reasonLabel === "围绕最近判断")
      .slice(0, 2);
    if (highlightedTemplates.length === 0) {
      return null;
    }
    const primarySuggestedTemplate =
      (projection?.suggestedTasks[0]
        ? highlightedTemplates.find(
            (featured) =>
              featured.template.id === projection.suggestedTasks[0]?.taskId,
          )
        : null) ?? highlightedTemplates[0];

    return {
      title: latestReviewRecommendationSignal.title,
      summary: summarizeRecentReplayText(
        [
          latestReviewRecommendationSignal.summary,
          projection?.suggestionText ?? "",
        ]
          .filter((segment) => segment.trim().length > 0)
          .join(" "),
        132,
      ),
      nextSteps: highlightedTemplates
        .map((featured) => featured.template.title)
        .join(" / "),
      actionLabel: primarySuggestedTemplate
        ? `继续去「${primarySuggestedTemplate.template.title}」`
        : null,
      onAction: primarySuggestedTemplate
        ? () => {
            setCuratedTaskLauncherTask(primarySuggestedTemplate.template);
            setCuratedTaskLauncherInitialInputValues(null);
            setCuratedTaskLauncherInitialReferenceMemoryIds(null);
            setCuratedTaskLauncherInitialReferenceEntries(null);
            setCuratedTaskLauncherPrefillHint(null);
          }
        : null,
    };
  }, [latestReviewRecommendationSignal, visibleFeaturedCuratedTaskTemplates]);
  const visibleRecentPreview = useMemo(
    () => visibleRecentSkills.slice(0, 4),
    [visibleRecentSkills],
  );
  const visibleInstalledPreview = useMemo(
    () => visibleInstalledLocalSkills.slice(0, 4),
    [visibleInstalledLocalSkills],
  );
  const installedSkillUsageMap = useMemo(() => {
    void slashEntryUsageVersion;
    return getSlashEntryUsageMap();
  }, [slashEntryUsageVersion]);
  const highlightedInstalledSkill = useMemo(
    () =>
      highlightedInstalledSkillDirectory
        ? (installedLocalSkills.find(
            (skill) => skill.directory === highlightedInstalledSkillDirectory,
          ) ?? null)
        : null,
    [highlightedInstalledSkillDirectory, installedLocalSkills],
  );
  const highlightedInstalledSkillUsage = useMemo(
    () =>
      highlightedInstalledSkill
        ? installedSkillUsageMap.get(
            getSlashEntryUsageRecordKey("skill", highlightedInstalledSkill.key),
          )
        : undefined,
    [highlightedInstalledSkill, installedSkillUsageMap],
  );

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([refreshServiceSkills(), refreshLocalSkills()]);
      toast.success("做法已刷新");
    } catch (error) {
      toast.error(`刷新做法失败：${String(error)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleServiceSkillSelect = (skill: ServiceSkillHomeItem) => {
    const prefill = resolveServiceSkillLaunchPrefill({
      skill,
      creationReplay: scaffoldCreationReplay,
    });
    onNavigate("agent", {
      ...buildHomeAgentParams({
        projectId: creationProjectId,
      }),
      initialPendingServiceSkillLaunch: {
        skillId: skill.id,
        requestKey: Date.now(),
        initialSlotValues: prefill?.slotValues,
        prefillHint: prefill?.hint,
        launchUserInput: prefill?.launchUserInput,
      },
    });
  };

  const handleInstalledSkillSelect = useCallback(
    (skill: Skill, replayText?: string) => {
      const normalizedReplayText = replayText?.trim() || undefined;
      onNavigate("agent", {
        ...buildHomeAgentParams({
          projectId: creationProjectId,
          ...(normalizedReplayText
            ? {
                initialUserPrompt: normalizedReplayText,
              }
            : {}),
          entryBannerMessage: normalizedReplayText
            ? `已带着方法“${skill.name}”和上次目标回到生成，接着把这轮做下去就行。`
            : `已带着方法“${skill.name}”回到生成，接着把这轮做下去就行。`,
        }),
        initialInputCapability: {
          capabilityRoute: {
            kind: "installed_skill",
            skillKey: skill.key,
            skillName: skill.name,
          },
          requestKey: Date.now(),
        },
      });
    },
    [creationProjectId, onNavigate],
  );

  const handleOpenSceneAppsDirectory = useCallback(() => {
    const normalizedSearchQuery = searchQuery.trim();
    onNavigate(
      "sceneapps",
      resolveSceneAppsPageEntryParams(
        {
          view: "catalog",
          ...(normalizedSearchQuery
            ? {
                search: normalizedSearchQuery,
              }
            : {}),
        },
        {
          mode: "browse",
        },
      ),
    );
  }, [onNavigate, searchQuery]);

  const handleScaffoldCreated = useCallback(
    async (skill: Skill) => {
      const scaffoldReplayText = pageParams?.initialScaffoldDraft
        ? buildSkillScaffoldReplayText(pageParams.initialScaffoldDraft)
        : undefined;

      setOptimisticInstalledSkill(skill);
      try {
        await refreshLocalSkills();
      } catch (error) {
        toast.error(`刷新我的方法失败：${String(error)}`);
      }

      if (scaffoldReplayText) {
        recordSlashEntryUsage({
          kind: "skill",
          entryId: skill.key,
          replayText: scaffoldReplayText,
        });
      }

      setSearchQuery("");
      setHighlightedInstalledSkillDirectory(skill.directory);
      setAdvancedManagerOpen(false);
      setConsumedScaffoldRequestKey(
        pageParams?.initialScaffoldRequestKey ?? null,
      );
      toast.success(`已创建“${skill.name}”并收进我的方法`);
    },
    [
      pageParams?.initialScaffoldDraft,
      pageParams?.initialScaffoldRequestKey,
      refreshLocalSkills,
    ],
  );

  const activeScaffoldRequestKey =
    pageParams?.initialScaffoldRequestKey === consumedScaffoldRequestKey
      ? null
      : (pageParams?.initialScaffoldRequestKey ?? null);
  const activeScaffoldDraft =
    pageParams?.initialScaffoldRequestKey === consumedScaffoldRequestKey
      ? null
      : (pageParams?.initialScaffoldDraft ?? null);
  const activeScaffoldTitle = useMemo(
    () => activeScaffoldDraft?.name?.trim() || "当前做法草稿",
    [activeScaffoldDraft],
  );
  const activeScaffoldReplayText = useMemo(
    () =>
      activeScaffoldDraft
        ? buildSkillScaffoldReplayText(activeScaffoldDraft)
        : undefined,
    [activeScaffoldDraft],
  );
  const activeScaffoldSummary = useMemo(() => {
    if (!activeScaffoldDraft) {
      return null;
    }

    const candidates = [
      activeScaffoldDraft.description,
      activeScaffoldDraft.sourceExcerpt,
      activeScaffoldDraft.whenToUse?.[0],
    ]
      .map((value) => value?.replace(/\s+/g, " ").trim())
      .filter((value): value is string => Boolean(value));

    return candidates[0] ?? null;
  }, [activeScaffoldDraft]);

  const handleCuratedTaskTemplateLauncherRequest = useCallback(
    (
      template: CuratedTaskTemplateItem,
      initialInputValues?: CuratedTaskInputValues | null,
      initialReferenceMemoryIds?: string[] | null,
      initialReferenceEntries?: CuratedTaskReferenceEntry[] | null,
      prefillHint?: string | null,
    ) => {
      setCuratedTaskLauncherTask(template);
      setCuratedTaskLauncherInitialInputValues(initialInputValues ?? null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(
        normalizeCuratedTaskReferenceMemoryIds(initialReferenceMemoryIds) ??
          null,
      );
      setCuratedTaskLauncherInitialReferenceEntries(
        mergeCuratedTaskReferenceEntries(initialReferenceEntries ?? []),
      );
      setCuratedTaskLauncherPrefillHint(prefillHint ?? null);
    },
    [],
  );

  const handleCuratedTaskLauncherOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialInputValues(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);
      setCuratedTaskLauncherPrefillHint(null);
    }
  }, []);
  const handleApplyLauncherReviewSuggestion = useCallback(
    (
      template: CuratedTaskTemplateItem,
      options: {
        inputValues: CuratedTaskInputValues;
        referenceSelection: CuratedTaskReferenceSelection;
      },
    ) => {
      handleCuratedTaskTemplateLauncherRequest(
        template,
        options.inputValues,
        options.referenceSelection.referenceMemoryIds,
        options.referenceSelection.referenceEntries,
        "已按最近判断切到更适合的结果模板，接着把这一步补齐就能开始。",
      );
    },
    [handleCuratedTaskTemplateLauncherRequest],
  );

  const handleCuratedTaskTemplateSelect = useCallback(
    (
      template: CuratedTaskTemplateItem,
      inputValues: CuratedTaskInputValues,
      referenceSelection: CuratedTaskReferenceSelection,
    ) => {
      const normalizedLaunchInputValues =
        normalizeCuratedTaskLaunchInputValues(inputValues);
      recordCuratedTaskTemplateUsage({
        templateId: template.id,
        launchInputValues: inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialInputValues(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);
      setCuratedTaskLauncherPrefillHint(null);
      const resolvedTemplate = template;
      const requestMetadata = buildCuratedTaskLaunchRequestMetadata({
        taskId: resolvedTemplate.id,
        taskTitle: resolvedTemplate.title,
        inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });
      onNavigate(
        "agent",
        buildHomeAgentParams({
          projectId: creationProjectId,
          initialRequestMetadata: requestMetadata,
          initialInputCapability: {
            capabilityRoute: {
              kind: "curated_task",
              taskId: resolvedTemplate.id,
              taskTitle: resolvedTemplate.title,
              prompt: buildCuratedTaskLaunchPrompt({
                task: resolvedTemplate,
                inputValues,
                referenceEntries: referenceSelection.referenceEntries,
              }),
              ...(normalizedLaunchInputValues
                ? {
                    launchInputValues: normalizedLaunchInputValues,
                  }
                : {}),
              ...(referenceSelection.referenceMemoryIds.length > 0
                ? {
                    referenceMemoryIds: referenceSelection.referenceMemoryIds,
                  }
                : {}),
              ...(referenceSelection.referenceEntries.length > 0
                ? {
                    referenceEntries: referenceSelection.referenceEntries,
                  }
                : {}),
            },
            requestKey: Date.now(),
          },
          entryBannerMessage: `已带着结果模板“${resolvedTemplate.title}”的启动信息回到生成，接着把这轮做下去就行。`,
        }),
      );
    },
    [creationProjectId, onNavigate],
  );

  const renderSkillCard = (skill: ServiceSkillHomeItem) => {
    const tone = resolveSkillCardTone(skill);
    const statusLabel = resolveSkillCardStatusLabel(skill);
    const statusDetail = resolveSkillCardStatusDetail(skill);
    const promise = resolveServiceSkillEntryDescription(skill);
    const requiredInputs = summarizeServiceSkillRequiredInputs(skill);
    const outputDestination = getServiceSkillOutputDestination(skill);

    return (
      <article
        key={skill.id}
        className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              TONE_BADGE_CLASSNAMES[tone],
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-3 space-y-2.5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              {skill.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
              {skill.summary || promise}
            </p>
          </div>

          <div className="space-y-1 text-[11px] leading-5 text-slate-500">
            <div>
              <span className="font-medium text-slate-700">你先给：</span>
              {requiredInputs}
            </div>
            <div>
              <span className="font-medium text-slate-700">会拿到：</span>
              {skill.outputHint}
            </div>
            <div>
              <span className="font-medium text-slate-700">接下来：</span>
              {statusDetail}
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="text-[11px] leading-5 text-slate-400">
            {outputDestination}
          </div>
          <Button
            type="button"
            variant="outline"
            className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
            onClick={() => handleServiceSkillSelect(skill)}
          >
            {skill.actionLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="lime-workbench-theme-scope flex h-full min-h-0 flex-col overflow-hidden bg-[image:var(--lime-stage-surface)]">
        <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col gap-6 overflow-auto px-6 py-6">
          <header className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                      我的方法
                    </h1>
                    <WorkbenchInfoTip
                      ariaLabel="方法主入口说明"
                      content="先从结果起手，顺手的做法和自己沉淀下来的方法都在这里续上；点开后直接把这一步接下去。"
                      tone="mint"
                    />
                  </div>
                  <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    先拿一个结果起手；后面常用做法和自己沉淀的方法都在这里续上。
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                    data-testid="skills-workspace-refresh-button"
                    onClick={() => void handleRefreshAll()}
                    disabled={refreshing}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-1.5 h-3.5 w-3.5",
                        refreshing && "animate-spin",
                      )}
                    />
                    刷新
                  </Button>
                </div>
              </div>

              <section
                className="rounded-[24px] border border-sky-200/80 bg-[color:var(--lime-info-soft)] p-4 shadow-sm shadow-slate-950/5"
                data-testid="skills-workspace-sceneapps-migration-banner"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700">
                        全部做法
                      </span>
                      <h2 className="text-base font-semibold text-slate-900">
                        完整做法都在这里
                      </h2>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">
                      想看完整做法，或继续某条做法时，直接从这里进入“查看全部做法”。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                    onClick={handleOpenSceneAppsDirectory}
                  >
                    查看全部做法
                  </Button>
                </div>
              </section>

              <div className="space-y-3">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
                    <span>搜做法</span>
                    <WorkbenchInfoTip
                      ariaLabel="做法搜索说明"
                      content="先从这轮想拿的结果方向找起；没命中时，再接着你自己顺手的方法。"
                      tone="slate"
                    />
                  </div>
                  {activeScaffoldDraft ? (
                    <div
                      className="rounded-[20px] border border-slate-200 bg-slate-50 px-3.5 py-3"
                      data-testid="skills-workspace-active-scaffold-banner"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700">
                            这次续用
                          </span>
                          <span className="min-w-0 font-semibold text-slate-900">
                            {activeScaffoldTitle}
                          </span>
                          {activeScaffoldSummary ? (
                            <span className="max-w-xl truncate text-xs leading-5 text-slate-500">
                              这次沿用：
                              {summarizeRecentReplayText(activeScaffoldSummary)}
                            </span>
                          ) : null}
                          {activeScaffoldReplayText ? (
                            <span className="max-w-xl truncate text-xs leading-5 text-slate-500">
                              上次目标：
                              {summarizeRecentReplayText(
                                activeScaffoldReplayText,
                              )}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-xl px-2.5 text-slate-600 hover:bg-white hover:text-slate-900"
                            data-testid="skills-workspace-open-scaffold-manager"
                            onClick={() => setAdvancedManagerOpen(true)}
                          >
                            继续补完
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-xl border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                            data-testid="skills-workspace-bring-scaffold-to-agent"
                            onClick={() =>
                              handleBringScaffoldToCreation(activeScaffoldDraft)
                            }
                          >
                            回到生成
                            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索想拿的结果、这一步或做法名"
                      className="h-12 rounded-[22px] border-slate-200 bg-slate-50 pl-10"
                    />
                  </div>
                </div>
              </div>
            </div>
          </header>

          {(serviceSkillsError || localSkillsError) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {serviceSkillsError
                ? `现成做法暂时没同步下来：${serviceSkillsError}`
                : null}
              {serviceSkillsError && localSkillsError ? "；" : null}
              {localSkillsError
                ? `已经沉淀的方法暂时没读到：${localSkillsError}`
                : null}
            </div>
          )}

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(320px,0.82fr)]">
            <div className="space-y-4">
              <section className="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                        先拿结果
                      </h2>
                    </div>
                    <p className="text-sm leading-6 text-slate-500">
                      还没想好怎么做时，先拿一个结果起手；启动时再补最少信息。
                    </p>
                  </div>
                </div>

                {reviewRecommendationBanner ? (
                  <div
                    className="mt-4 flex flex-wrap items-start gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-3.5 py-3"
                    data-testid="skills-workspace-review-feedback-banner"
                  >
                    <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      围绕最近判断
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-semibold text-slate-900">
                        最近判断已更新：{reviewRecommendationBanner.title}
                      </div>
                      <div className="text-sm leading-6 text-slate-600">
                        {reviewRecommendationBanner.summary}
                      </div>
                    </div>
                    <div className="text-xs leading-5 text-sky-700">
                      更适合继续：{reviewRecommendationBanner.nextSteps}
                    </div>
                    {reviewRecommendationBanner.actionLabel &&
                    reviewRecommendationBanner.onAction ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full border-sky-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-sky-300 hover:bg-sky-50"
                        data-testid="skills-workspace-review-feedback-banner-action"
                        onClick={() => reviewRecommendationBanner.onAction?.()}
                      >
                        {reviewRecommendationBanner.actionLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {visibleFeaturedCuratedTaskTemplates.length > 0 ? (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {visibleFeaturedCuratedTaskTemplates.map(
                      (featured, index) => {
                        const template = featured.template;
                        const isPrimaryRecommendation = index === 0;
                        const launchPrefill =
                          resolveCuratedTaskTemplateLaunchPrefill(template);
                        const reviewPrefillSnapshot =
                          buildSceneAppExecutionReviewPrefillSnapshot({
                            referenceEntries: launchPrefill?.referenceEntries,
                            taskId: template.id,
                          });
                        const reviewPrefillHighlights =
                          buildSceneAppExecutionReviewPrefillHighlights(
                            reviewPrefillSnapshot,
                          );
                        const recentUsageDescription =
                          buildCuratedTaskRecentUsageDescription({
                            task: template,
                            prefill: launchPrefill,
                          });
                        const compactReasonSummary =
                          featured.reasonSummary || recentUsageDescription;
                        const requiredSummary =
                          summarizeCuratedTaskRequiredInputs(template);
                        const outputSummary =
                          summarizeCuratedTaskOutputContract(template);
                        const followUpSummary =
                          summarizeCuratedTaskFollowUpActions(template);
                        const resultDestination =
                          getCuratedTaskOutputDestination(template);

                        return (
                          <article
                            key={template.id}
                            className={cn(
                              "flex h-full flex-col rounded-[24px] border px-4 py-4 transition hover:border-slate-300 hover:shadow-sm hover:shadow-slate-950/5",
                              isPrimaryRecommendation
                                ? "border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] md:col-span-2"
                                : "border-slate-200 bg-white",
                            )}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              {isPrimaryRecommendation ? (
                                <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                  优先起手
                                </span>
                              ) : (
                                <span />
                              )}
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                {template.outputHint}
                              </span>
                            </div>
                            <div className="mt-3 space-y-2.5">
                              <div className="space-y-1.5">
                                <h3 className="text-base font-semibold text-slate-950">
                                  {template.title}
                                </h3>
                                <p className="text-sm leading-6 text-slate-600">
                                  {template.summary}
                                </p>
                                {featured.reasonLabel ||
                                compactReasonSummary ? (
                                  <div className="text-[11px] leading-5 text-slate-500">
                                    {[
                                      featured.reasonLabel,
                                      compactReasonSummary,
                                    ]
                                      .filter((segment): segment is string =>
                                        Boolean(segment && segment.trim()),
                                      )
                                      .join(" · ")}
                                  </div>
                                ) : null}
                              </div>
                              {reviewPrefillHighlights.length > 0 ? (
                                <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/70 px-3 py-3 text-[11px] leading-5 text-emerald-800">
                                  <div className="font-medium text-emerald-900">
                                    当前结果基线：
                                    {reviewPrefillSnapshot?.sourceTitle ||
                                      "当前项目结果"}
                                  </div>
                                  <div className="mt-1.5 space-y-1">
                                    {reviewPrefillHighlights.map((item) => (
                                      <div key={`${template.id}-${item}`}>
                                        {item}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-4 space-y-1 text-[11px] leading-5 text-slate-500">
                              <div>
                                <span className="font-medium text-slate-700">
                                  你先给：
                                </span>
                                {requiredSummary}
                              </div>
                              <div>
                                <span className="font-medium text-slate-700">
                                  这一步先拿：
                                </span>
                                {outputSummary}
                              </div>
                            </div>
                            <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                              <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                                <div>{resultDestination}</div>
                                <div>接着可做：{followUpSummary}</div>
                              </div>
                              <Button
                                type="button"
                                variant={
                                  isPrimaryRecommendation
                                    ? undefined
                                    : "outline"
                                }
                                className={
                                  isPrimaryRecommendation
                                    ? SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME
                                    : SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME
                                }
                                onClick={() =>
                                  handleCuratedTaskTemplateLauncherRequest(
                                    template,
                                  )
                                }
                              >
                                进入生成
                                <ArrowRight className="ml-2 h-4 w-4" />
                              </Button>
                            </div>
                          </article>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前搜索下暂无结果模板。可以先清掉关键词，或直接从下方换个方向继续找。
                  </div>
                )}
              </section>

              {selectedGroup ? (
                <>
                  <section className="rounded-[24px] border border-slate-200/80 bg-slate-50 p-4 shadow-sm shadow-slate-950/5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                            正在看这一组
                          </span>
                          <h2 className="text-base font-semibold text-slate-900">
                            {selectedGroup.title}
                          </h2>
                        </div>
                        <p className="text-sm leading-6 text-slate-700">
                          先从 {selectedGroup.title}{" "}
                          里最接近的一条开始；不对再换方向。
                        </p>
                        <div className="space-y-1 text-sm leading-6 text-slate-500">
                          <p>{selectedGroup.summary}</p>
                          {selectedGroup.entryHint ? (
                            <p>{selectedGroup.entryHint}</p>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        换个方向
                      </Button>
                    </div>
                  </section>

                  {visibleGroupSkills.length > 0 ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {visibleGroupSkills.map(renderSkillCard)}
                    </div>
                  ) : (
                    <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                      <div className="text-base font-semibold text-slate-900">
                        当前做法组下暂无匹配做法
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        可以调整搜索词，或先返回上一步换个方向继续找。
                      </p>
                    </div>
                  )}
                </>
              ) : visibleGroups.length > 0 ? (
                <section className="rounded-[28px] border border-slate-200/80 bg-slate-50 p-5 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-medium text-slate-700">
                        换个方向
                      </h2>
                      <Button
                        type="button"
                        variant="outline"
                        className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                        onClick={handleOpenSceneAppsDirectory}
                      >
                        查看全部做法
                      </Button>
                    </div>
                    <p className="text-[11px] leading-5 text-slate-500">
                      上面没命中时，再换个方向。
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {visibleGroups.map((group) => {
                      const groupSkills =
                        recommendedSkillGroupMap.get(group.key) ?? [];
                      const hasRecommendedGroupSkills = groupSkills.length > 0;

                      return (
                        <article
                          key={group.key}
                          className="flex h-full flex-col rounded-[22px] border border-slate-200 bg-white px-4 py-3.5 text-left transition hover:border-slate-300 hover:shadow-sm hover:shadow-slate-950/5"
                        >
                          <div className="space-y-2.5">
                            <div>
                              <h3 className="text-base font-semibold text-slate-900">
                                {group.title}
                              </h3>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
                                {group.summary}
                              </p>
                            </div>
                            <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                              <div>
                                {hasRecommendedGroupSkills
                                  ? buildSkillGroupStarterSummary(groupSkills)
                                  : "先带着这次目标进去继续收窄。"}
                              </div>
                              {group.themeTarget ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    适合：
                                  </span>
                                  {group.themeTarget}
                                </div>
                              ) : null}
                              {group.entryHint ? (
                                <div>{group.entryHint}</div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-auto flex justify-end pt-4">
                            <Button
                              type="button"
                              variant="outline"
                              className={
                                SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME
                              }
                              onClick={() => setSelectedGroupKey(group.key)}
                            >
                              进去看看
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <div className="text-base font-semibold text-slate-900">
                    当前搜索下暂无做法组
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    可以尝试刷新，或换个结果方向、做法名继续找。
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section
                className="rounded-[28px] border border-emerald-200/80 bg-[image:var(--lime-home-card-surface-strong)] p-5 shadow-sm shadow-emerald-950/5"
                data-testid="skills-workspace-sidebar-section-continuation"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-emerald-800">
                      继续上次做法
                    </h2>
                    <WorkbenchInfoTip
                      ariaLabel="最近做法说明"
                      content="最近顺手的做法会先留在这里，下次可以直接接着跑。"
                      tone="slate"
                    />
                  </div>
                  <p className="text-[11px] leading-5 text-emerald-700/80">
                    优先接着已经跑过的方法，通常比重新挑一条更省重来成本。
                  </p>
                </div>

                {visibleRecentPreview.length > 0 ? (
                  <div className="mt-4 space-y-2.5">
                    {visibleRecentPreview.map((skill) => {
                      const recentPrefill = resolveServiceSkillLaunchPrefill({
                        skill,
                      });
                      const recentPrefillSummary =
                        buildServiceSkillLaunchPrefillSummary({
                          skill,
                          slotValues: recentPrefill?.slotValues,
                          launchUserInput: recentPrefill?.launchUserInput,
                        });

                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => handleServiceSkillSelect(skill)}
                          className="w-full rounded-[22px] border border-emerald-100 bg-white px-4 py-3.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                              最近成功
                            </span>
                          </div>
                          <div className="mt-2.5 text-sm font-semibold text-slate-900">
                            {skill.title}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-slate-600">
                            {skill.summary}
                          </p>
                          <div className="mt-2.5 space-y-1 text-[11px] leading-5 text-slate-500">
                            {recentPrefillSummary ? (
                              <div>{recentPrefillSummary}</div>
                            ) : null}
                            <div>
                              <span className="font-medium text-slate-700">
                                你来给：
                              </span>
                              {summarizeServiceSkillRequiredInputs(skill)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                会拿到：
                              </span>
                              {skill.outputHint}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                结果去向：
                              </span>
                              {getServiceSkillOutputDestination(skill)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[24px] border border-dashed border-emerald-200 bg-white px-4 py-8 text-sm text-emerald-700/80">
                    当前还没有可继续项。先从左侧拿一个结果或做法开始，后续会自动回到这里。
                  </div>
                )}
              </section>

              <section
                className="rounded-[28px] border border-slate-200/80 bg-slate-50 p-5 shadow-sm shadow-slate-950/5"
                data-testid="skills-workspace-sidebar-section-library"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-medium text-slate-700">
                        已经沉淀的方法
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="本地方法库说明"
                        content="自己的固定做法都在这里；要补、改或收拾时再点调整。"
                        tone="slate"
                      />
                    </div>
                    <p className="text-[11px] leading-5 text-slate-500">
                      上面没命中时，再从这里接着自己的方法往下走。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-2xl px-3 text-slate-600 hover:bg-white hover:text-slate-900"
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    调整
                  </Button>
                </div>

                {visibleInstalledPreview.length > 0 ? (
                  <div className="mt-4 space-y-2.5">
                    {highlightedInstalledSkill ? (
                      <div
                        className="rounded-[20px] border border-emerald-200 bg-white px-3.5 py-3 shadow-sm shadow-emerald-950/5"
                        data-testid="skills-workspace-highlighted-skill-banner"
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                              刚沉淀
                            </span>
                            <span className="min-w-0 font-semibold text-slate-900">
                              {highlightedInstalledSkill.name}
                            </span>
                            {highlightedInstalledSkillUsage?.replayText ? (
                              <span className="max-w-xl truncate text-xs leading-5 text-slate-500">
                                {buildInstalledSkillRecentUsageDescription(
                                  highlightedInstalledSkillUsage.replayText,
                                )}
                              </span>
                            ) : null}
                            <span className="text-xs leading-5 text-slate-500">
                              已经收回这里，后面可以直接继续。
                            </span>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                              data-testid="skills-workspace-highlighted-skill-continue"
                              onClick={() =>
                                handleInstalledSkillSelect(
                                  highlightedInstalledSkill,
                                  highlightedInstalledSkillUsage?.replayText,
                                )
                              }
                            >
                              回到生成
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {visibleInstalledPreview.map((skill) => {
                      const isHighlighted =
                        skill.directory === highlightedInstalledSkillDirectory;
                      const usage = installedSkillUsageMap.get(
                        getSlashEntryUsageRecordKey("skill", skill.key),
                      );
                      const recentUsageDescription =
                        buildInstalledSkillRecentUsageDescription(
                          usage?.replayText,
                        );

                      return (
                        <article
                          key={skill.directory}
                          className={cn(
                            "rounded-[22px] border bg-white px-4 py-3.5 transition",
                            isHighlighted
                              ? "border-emerald-300 bg-emerald-50/70 shadow-sm shadow-emerald-950/5"
                              : "border-slate-200 hover:border-slate-300",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">
                              {skill.name}
                            </div>
                            {isHighlighted ? (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                                刚沉淀
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-slate-600">
                            {resolveInstalledSkillPromise(skill)}
                          </p>
                          <div className="mt-2.5 space-y-1 text-[11px] leading-5 text-slate-500">
                            {recentUsageDescription ? (
                              <div>{recentUsageDescription}</div>
                            ) : null}
                            <div>
                              <span className="font-medium text-slate-700">
                                你来给：
                              </span>
                              {summarizeInstalledSkillRequiredInputs(skill)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                会拿到：
                              </span>
                              {getInstalledSkillOutputHint(skill)}
                            </div>
                            <div>回到生成后会继续按这套方法往下做。</div>
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="text-[11px] leading-5 text-slate-400">
                              回到生成后会继续按这套方法往下做，跑顺后的结果也会再沉淀回来。
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className={
                                SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME
                              }
                              onClick={() =>
                                handleInstalledSkillSelect(
                                  skill,
                                  usage?.replayText,
                                )
                              }
                            >
                              继续这套方法
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前还没有自己的方法。先从一个现成做法开始，后续再沉淀到这里也很自然。
                  </div>
                )}
              </section>
            </aside>
          </section>
        </div>
      </div>

      <Dialog open={advancedManagerOpen} onOpenChange={setAdvancedManagerOpen}>
        <DialogContent className="lime-workbench-theme-scope max-h-[calc(100vh-40px)] w-[min(1240px,calc(100vw-32px))] max-w-none overflow-hidden border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-0">
          <div className="flex h-[calc(100vh-88px)] min-h-[680px] flex-col bg-white">
            <DialogHeader className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>调整我的方法</DialogTitle>
                <WorkbenchInfoTip
                  ariaLabel="调整我的方法弹窗说明"
                  content="需要补、改、删时在这里处理；平时还是先从结果和顺手做法开工。"
                  tone="mint"
                />
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
              <SkillsPage
                hideHeader
                initialScaffoldDraft={activeScaffoldDraft}
                initialScaffoldRequestKey={activeScaffoldRequestKey}
                onBringScaffoldToCreation={handleBringScaffoldToCreation}
                onScaffoldCreated={handleScaffoldCreated}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CuratedTaskLauncherDialog
        open={Boolean(curatedTaskLauncherTask)}
        task={curatedTaskLauncherTask}
        projectId={pageParams?.creationProjectId}
        initialInputValues={curatedTaskLauncherInitialInputValues}
        initialReferenceMemoryIds={curatedTaskLauncherInitialReferenceMemoryIds}
        initialReferenceEntries={curatedTaskLauncherInitialReferenceEntries}
        prefillHint={curatedTaskLauncherPrefillHint}
        onOpenChange={handleCuratedTaskLauncherOpenChange}
        onApplyReviewSuggestion={handleApplyLauncherReviewSuggestion}
        onConfirm={handleCuratedTaskTemplateSelect}
      />
    </>
  );
}
