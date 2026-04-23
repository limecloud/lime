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
import { getSkillSource } from "./SkillCard";
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
  summarizeCuratedTaskOptionalReferences,
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
  normalizeCuratedTaskLaunchInputValues,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";
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
  "rounded-2xl border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 text-white shadow-sm shadow-emerald-950/15 hover:opacity-95";
const SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME =
  "rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900";

const LOCAL_SKILL_SOURCE_LABELS = {
  builtin: "内置",
  project: "项目",
  official: "官方",
  community: "社区",
  local: "本地",
} as const;

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

function resolveLocalSkillSourceLabel(skill: Skill): string {
  return LOCAL_SKILL_SOURCE_LABELS[getSkillSource(skill)];
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
    catalogMeta,
    isLoading: serviceSkillsLoading,
    error: serviceSkillsError,
    refresh: refreshServiceSkills,
  } = useServiceSkills();
  const {
    skills: localSkills,
    loading: localSkillsLoading,
    remoteLoading: localSkillsRemoteLoading,
    error: localSkillsError,
    refresh: refreshLocalSkills,
  } = useSkills("lime", { includeRepos: false });

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [advancedManagerOpen, setAdvancedManagerOpen] = useState(false);
  const [curatedTaskLauncherTask, setCuratedTaskLauncherTask] =
    useState<CuratedTaskTemplateItem | null>(null);
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  const [curatedTaskTemplatesVersion, setCuratedTaskTemplatesVersion] =
    useState(0);
  const [slashEntryUsageVersion, setSlashEntryUsageVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedInstalledSkillDirectory, setHighlightedInstalledSkillDirectory] =
    useState<string | null>(null);
  const [optimisticInstalledSkill, setOptimisticInstalledSkill] =
    useState<Skill | null>(null);
  const [consumedScaffoldRequestKey, setConsumedScaffoldRequestKey] =
    useState<number | null>(null);
  const lastHandledScaffoldRequestKeyRef = useRef<number | null>(null);

  const installedLocalSkills = useMemo(
    () => {
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
    },
    [localSkills, optimisticInstalledSkill],
  );
  const serviceSkillRecommendationBuckets = useMemo(
    () =>
      buildServiceSkillRecommendationBuckets(serviceSkills, {
        featuredLimit: 0,
        surface: "workspace",
      }),
    [serviceSkills],
  );
  const recentServiceSkills = serviceSkillRecommendationBuckets.recentSkills;
  const nonRecentServiceSkills = serviceSkillRecommendationBuckets.remainingSkills;
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
  const directoryStatusLabel = useMemo(() => {
    if (serviceSkillsLoading || localSkillsLoading || localSkillsRemoteLoading) {
      return "正在同步当前方法库...";
    }
    if (selectedGroup) {
      return `当前正在浏览 ${selectedGroup.title} 做法组。`;
    }
    return "这里收的是已经跑通过的做法；不确定从哪开始时，先回首页结果模板。";
  }, [
    localSkillsLoading,
    localSkillsRemoteLoading,
    selectedGroup,
    serviceSkillsLoading,
  ]);
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
        resolveLocalSkillSourceLabel(skill),
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
  const visibleCuratedTaskTemplates = useMemo(
    () => {
      void curatedTaskTemplatesVersion;
      void curatedTaskRecommendationSignalsVersion;
      return filterCuratedTaskTemplates(searchQuery, listCuratedTaskTemplates());
    },
    [curatedTaskRecommendationSignalsVersion, curatedTaskTemplatesVersion, searchQuery],
  );
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
    return listCuratedTaskRecommendationSignals({
      projectId: pageParams?.creationProjectId,
    })
      .filter((signal) => signal.source === "review_feedback")
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  }, [curatedTaskRecommendationSignalsVersion, pageParams?.creationProjectId]);
  const reviewRecommendationBanner = useMemo(() => {
    if (!latestReviewRecommendationSignal) {
      return null;
    }

    const highlightedTemplates = visibleFeaturedCuratedTaskTemplates
      .filter((featured) => featured.reasonLabel === "围绕最近复盘")
      .slice(0, 2);
    if (highlightedTemplates.length === 0) {
      return null;
    }

    return {
      title: latestReviewRecommendationSignal.title,
      summary: summarizeRecentReplayText(
        latestReviewRecommendationSignal.summary,
        96,
      ),
      nextSteps: highlightedTemplates
        .map((featured) => featured.template.title)
        .join(" / "),
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
        ? installedLocalSkills.find(
            (skill) => skill.directory === highlightedInstalledSkillDirectory,
          ) ?? null
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

  const syncedAtLabel = useMemo(() => {
    if (!catalogMeta?.syncedAt) {
      return null;
    }

    const parsed = new Date(catalogMeta.syncedAt);
    if (Number.isNaN(parsed.getTime())) {
      return catalogMeta.syncedAt;
    }

    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  }, [catalogMeta?.syncedAt]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([refreshServiceSkills(), refreshLocalSkills()]);
      toast.success("方法库已刷新");
    } catch (error) {
      toast.error(`刷新方法库失败：${String(error)}`);
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
            ? `已带着方法“${skill.name}”和上次目标进入生成，可继续补充后发送。`
            : `已带着方法“${skill.name}”进入生成，可继续补充后发送。`,
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
        toast.error(`同步我的方法库失败：${String(error)}`);
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
      toast.success(`已创建“${skill.name}”并加入我的方法库`);
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
    (template: CuratedTaskTemplateItem) => {
      setCuratedTaskLauncherTask(template);
    },
    [],
  );

  const handleCuratedTaskLauncherOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCuratedTaskLauncherTask(null);
    }
  }, []);

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
          entryBannerMessage: `已从结果模板“${resolvedTemplate.title}”带着启动信息进入生成，可继续补充后发送。`,
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
        className="flex h-full flex-col rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
            {skill.badge}
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
            {getServiceSkillTypeLabel(skill)}
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              TONE_BADGE_CLASSNAMES[tone],
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {skill.title}
            </h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
              {skill.summary || promise}
            </p>
          </div>

          <div className="space-y-2 text-xs leading-5 text-slate-500">
            <div>
              <span className="font-medium text-slate-700">分类：</span>
              {skill.category}
            </div>
            <div>
              <span className="font-medium text-slate-700">你来给：</span>
              {requiredInputs}
            </div>
            <div>
              <span className="font-medium text-slate-700">会拿到：</span>
              {skill.outputHint}
            </div>
            <div>
              <span className="font-medium text-slate-700">结果去向：</span>
              {outputDestination}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
            {statusDetail}
          </div>
        </div>

        <div className="mt-auto flex justify-end pt-5">
          <Button
            type="button"
            className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_30%),linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(244,247,250,0.98)_100%)]">
        <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col gap-6 overflow-auto px-6 py-6">
          <header className="rounded-[32px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-emerald-700">
                    我的方法 · 对话内继续
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                        我的方法
                      </h1>
                      <WorkbenchInfoTip
                        ariaLabel="方法主入口说明"
                        content="首页负责结果模板，这里负责可复用做法；选中具体方法后，统一进入 Agent 对话补参或继续执行。适配器继续留在后台做治理，前台不再暴露 adapter、runtime 或 YAML 等技术细节。"
                        tone="mint"
                      />
                    </div>
                    <p className="max-w-3xl text-sm leading-7 text-slate-600">
                      这里更像方法库：当你已经知道要找哪类做法时，再进入 Agent 对话补参和执行。
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      {directoryStatusLabel}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
                    onClick={() => void handleRefreshAll()}
                    disabled={refreshing}
                  >
                    <RefreshCw
                      className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")}
                    />
                    刷新方法库
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl border-slate-200"
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    导入与整理
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>查找做法组 / 做法项</span>
                    <WorkbenchInfoTip
                      ariaLabel="做法搜索说明"
                      content="先从结果相关的做法组找起；本地导入、仓库维护和远程安装统一收进导入与整理。"
                      tone="slate"
                    />
                  </div>
                  {activeScaffoldDraft ? (
                    <div
                      className="rounded-[24px] border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(255,255,255,0.98))] px-4 py-4 shadow-sm shadow-sky-950/5"
                      data-testid="skills-workspace-active-scaffold-banner"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700">
                              当前带入做法草稿
                            </span>
                            {pageParams?.creationProjectId ? (
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                                项目内整理
                              </span>
                            ) : null}
                          </div>
                          <div className="text-base font-semibold text-slate-900">
                            {activeScaffoldTitle}
                          </div>
                          <p className="text-sm leading-6 text-slate-600">
                            这套做法草稿已经从当前结果带到方法页；你可以继续在导入与整理里完善，也可以直接带回生成继续改写。
                          </p>
                          <div className="space-y-1 text-xs leading-5 text-slate-500">
                            {activeScaffoldSummary ? (
                              <div>{activeScaffoldSummary}</div>
                            ) : null}
                            {activeScaffoldReplayText ? (
                              <div>
                                上次目标：
                                {summarizeRecentReplayText(activeScaffoldReplayText)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl border-slate-200"
                            data-testid="skills-workspace-open-scaffold-manager"
                            onClick={() => setAdvancedManagerOpen(true)}
                          >
                            继续整理这套做法
                          </Button>
                          <Button
                            type="button"
                            className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
                            data-testid="skills-workspace-bring-scaffold-to-agent"
                            onClick={() =>
                              handleBringScaffoldToCreation(activeScaffoldDraft)
                            }
                          >
                            带回生成继续写
                            <ArrowRight className="ml-2 h-4 w-4" />
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
                      placeholder="搜索结果方向、站点或做法标题"
                      className="h-12 rounded-[22px] border-slate-200 bg-slate-50 pl-10"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-2 text-[11px] leading-5 text-slate-500 xl:justify-end">
                  {catalogMeta ? (
                    <>
                      {catalogMeta.sourceLabel ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          {catalogMeta.sourceLabel}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                        做法 {workspaceServiceSkills.length}
                      </span>
                      {catalogMeta.groupCount ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          分组 {catalogMeta.groupCount}
                        </span>
                      ) : null}
                      {syncedAtLabel ? (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                          同步于 {syncedAtLabel}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                      正在读取当前方法库
                    </span>
                  )}
                </div>
              </div>
            </div>
          </header>

          {(serviceSkillsError || localSkillsError) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {serviceSkillsError
                ? `云端方法库加载失败：${serviceSkillsError}`
                : null}
              {serviceSkillsError && localSkillsError ? "；" : null}
              {localSkillsError
                ? `本地方法加载失败：${localSkillsError}`
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
                      {visibleCuratedTaskTemplates.length > 0 ? (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                          {visibleCuratedTaskTemplates.length} 个
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 text-slate-500">
                      还没想好具体做法时，先拿一个结果起手式；启动时再补最少信息。
                    </p>
                  </div>
                  <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500">
                    统一进入生成主执行面
                  </div>
                </div>

                {reviewRecommendationBanner ? (
                  <div
                    className="mt-5 rounded-[24px] border border-sky-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(239,246,255,0.92))] px-4 py-4"
                    data-testid="skills-workspace-review-feedback-banner"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                        围绕最近复盘
                      </span>
                      <div className="text-sm font-semibold text-slate-900">
                        最近复盘已更新：{reviewRecommendationBanner.title}
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {reviewRecommendationBanner.summary}
                    </p>
                    <div className="mt-2 text-xs leading-5 text-sky-700">
                      更适合继续：{reviewRecommendationBanner.nextSteps}
                    </div>
                  </div>
                ) : null}

                {visibleFeaturedCuratedTaskTemplates.length > 0 ? (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {visibleFeaturedCuratedTaskTemplates.map((featured) => {
                      const template = featured.template;
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

                      return (
                        <article
                          key={template.id}
                          className="flex h-full flex-col rounded-[26px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm hover:shadow-slate-950/5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                              {featured.badgeLabel}
                            </span>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                              {template.outputHint}
                            </span>
                          </div>
                          <div className="mt-3 space-y-2">
                            <h3 className="text-lg font-semibold text-slate-950">
                              {template.title}
                            </h3>
                            <p className="text-sm leading-6 text-slate-600">
                              {template.summary}
                            </p>
                            {featured.reasonSummary ? (
                              <div className="text-xs leading-5 text-slate-500">
                                {featured.reasonSummary}
                              </div>
                            ) : null}
                            {reviewPrefillHighlights.length > 0 ? (
                              <div className="rounded-[18px] border border-emerald-200 bg-emerald-50/80 px-3 py-3 text-xs leading-5 text-emerald-800">
                                <div className="font-medium text-emerald-900">
                                  当前结果基线：
                                  {reviewPrefillSnapshot?.sourceTitle || "当前项目结果"}
                                </div>
                                <div className="mt-1.5 space-y-1">
                                  {reviewPrefillHighlights.map((item) => (
                                    <div key={`${template.id}-${item}`}>{item}</div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-4 space-y-1.5 text-xs leading-5 text-slate-500">
                            {recentUsageDescription ? (
                              <div>{recentUsageDescription}</div>
                            ) : null}
                            <div>
                              <span className="font-medium text-slate-700">
                                你来给：
                              </span>
                              {summarizeCuratedTaskRequiredInputs(template)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                可选参考：
                              </span>
                              {summarizeCuratedTaskOptionalReferences(template)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                会拿到：
                              </span>
                              {summarizeCuratedTaskOutputContract(template)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                结果去向：
                              </span>
                              {getCuratedTaskOutputDestination(template)}
                            </div>
                            <div>
                              <span className="font-medium text-slate-700">
                                下一步可继续：
                              </span>
                              {summarizeCuratedTaskFollowUpActions(template)}
                            </div>
                          </div>
                          <div className="mt-auto flex justify-end pt-4">
                            <Button
                              type="button"
                              className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
                              onClick={() =>
                                handleCuratedTaskTemplateLauncherRequest(template)
                              }
                            >
                              进入生成
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前搜索下暂无结果模板。可以先清掉关键词，或直接从下方方法目录继续找具体做法。
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
                            组内继续挑做法
                          </span>
                          <h2 className="text-base font-semibold text-slate-900">
                            {selectedGroup.title}
                          </h2>
                        </div>
                        <p className="text-sm leading-6 text-slate-700">
                          已进入 {selectedGroup.title}，下面直接挑一条具体做法；没命中再换一组。
                        </p>
                        <div className="space-y-1 text-sm leading-6 text-slate-500">
                          <p>
                            <span className="font-medium text-slate-700">
                              这一组更偏向：
                            </span>
                            {selectedGroup.summary}
                          </p>
                          {selectedGroup.entryHint ? (
                            <p>
                              <span className="font-medium text-slate-700">
                                起手建议：
                              </span>
                              {selectedGroup.entryHint}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        换一组做法
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
                        可以调整搜索词，或先返回方法目录切换到其他方向。
                      </p>
                    </div>
                  )}
                </>
              ) : visibleGroups.length > 0 ? (
                <section className="rounded-[28px] border border-slate-200/80 bg-slate-50 p-5 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-medium text-slate-700">
                        方法目录
                      </h2>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                        补位目录
                      </span>
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
                      上面没命中时，再按方向找一组做法；进入组后再挑具体方法，不必先理解目录结构。
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
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              做法组
                            </span>
                            {hasRecommendedGroupSkills ? (
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                {groupSkills.length} 套做法
                              </span>
                            ) : (
                              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                                已沉淀到常用做法
                              </span>
                            )}
                          </div>

                          <div className="mt-3 space-y-2.5">
                            <div>
                              <h3 className="text-base font-semibold text-slate-900">
                                {group.title}
                              </h3>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
                                {group.summary}
                              </p>
                            </div>
                            <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                              {hasRecommendedGroupSkills ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    可先看：
                                  </span>
                                  {groupSkills
                                    .slice(0, 2)
                                    .map((skill) => skill.title)
                                    .join("、")}
                                  {groupSkills.length > 2 ? " 等" : ""}
                                </div>
                              ) : (
                                <div>
                                  当前这组做法已沉淀到继续上次做法，可直接从右侧续上，或打开做法组查看。
                                </div>
                              )}
                              {group.themeTarget ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    更偏向：
                                  </span>
                                  {group.themeTarget}
                                </div>
                              ) : null}
                              {group.entryHint ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    起手：
                                  </span>
                                  {group.entryHint}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                            <div className="text-[11px] leading-5 text-slate-400">
                              打开后再挑具体做法
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                              onClick={() => setSelectedGroupKey(group.key)}
                            >
                              打开做法组
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
                    可以尝试刷新目录，或换一个站点、业务关键词继续查找。
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-4">
              <section
                className="rounded-[28px] border border-emerald-200/80 bg-[linear-gradient(180deg,rgba(236,253,245,0.84),rgba(255,255,255,0.98))] p-5 shadow-sm shadow-emerald-950/5"
                data-testid="skills-workspace-sidebar-section-continuation"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-emerald-800">
                      继续上次做法
                    </h2>
                    <WorkbenchInfoTip
                      ariaLabel="最近做法说明"
                      content="最近跑通过的做法会沉淀在这里，方便再次续上。"
                      tone="slate"
                    />
                    {visibleRecentSkills.length > 0 ? (
                      <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                        {visibleRecentSkills.length} 个
                      </span>
                    ) : null}
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
                            <span className="text-[11px] text-emerald-700/70">
                              {skill.actionLabel}
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
                        我的方法库
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="本地方法库说明"
                        content="项目级、本地补充和内置技能仍然可用，但高阶仓库、导入和标准检查收纳在导入与整理。"
                        tone="slate"
                      />
                      {visibleInstalledLocalSkills.length > 0 ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {visibleInstalledLocalSkills.length} 个
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[11px] leading-5 text-slate-500">
                      更多本地做法；没命中上面的继续项时，再从这里挑一条带回生成。
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    导入与整理
                  </Button>
                </div>

                {visibleInstalledPreview.length > 0 ? (
                  <div className="mt-4 space-y-2.5">
                    {highlightedInstalledSkill ? (
                      <div
                        className="rounded-[24px] border border-emerald-300 bg-[linear-gradient(135deg,rgba(236,253,245,0.96),rgba(255,255,255,0.98))] px-4 py-4 shadow-sm shadow-emerald-950/5"
                        data-testid="skills-workspace-highlighted-skill-banner"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                刚沉淀成功
                              </span>
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                                {resolveLocalSkillSourceLabel(
                                  highlightedInstalledSkill,
                                )}
                              </span>
                            </div>
                            <div className="text-base font-semibold text-slate-900">
                              {highlightedInstalledSkill.name}
                            </div>
                            <p className="text-sm leading-6 text-slate-600">
                              这套做法已经从当前结果回到你的方法库；如果准备直接跑下一轮，现在可以带着它回到生成继续推进。
                            </p>
                            <div className="space-y-1 text-xs leading-5 text-slate-500">
                              {highlightedInstalledSkillUsage?.replayText ? (
                                <div>
                                  {buildInstalledSkillRecentUsageDescription(
                                    highlightedInstalledSkillUsage.replayText,
                                  )}
                                </div>
                              ) : null}
                              <div>
                                <span className="font-medium text-slate-700">
                                  你来给：
                                </span>
                                {summarizeInstalledSkillRequiredInputs(
                                  highlightedInstalledSkill,
                                )}
                              </div>
                              <div>
                                <span className="font-medium text-slate-700">
                                  会拿到：
                                </span>
                                {getInstalledSkillOutputHint(
                                  highlightedInstalledSkill,
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center">
                            <Button
                              type="button"
                              className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
                              data-testid="skills-workspace-highlighted-skill-continue"
                              onClick={() =>
                                handleInstalledSkillSelect(
                                  highlightedInstalledSkill,
                                  highlightedInstalledSkillUsage?.replayText,
                                )
                              }
                            >
                              带着这套做法继续生成
                              <ArrowRight className="ml-2 h-4 w-4" />
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
                            <span
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                                isHighlighted
                                  ? "border-emerald-200 bg-white text-emerald-700"
                                  : "border-slate-200 bg-white text-slate-600",
                              )}
                            >
                              {resolveLocalSkillSourceLabel(skill)}
                            </span>
                            <div className="flex items-center gap-2">
                              {isHighlighted ? (
                                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                                  刚沉淀
                                </span>
                              ) : null}
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                                已安装
                              </span>
                            </div>
                          </div>
                          <div className="mt-2.5 text-sm font-semibold text-slate-900">
                            {skill.name}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-slate-600">
                            {resolveInstalledSkillPromise(skill)}
                          </p>
                          {isHighlighted ? (
                            <div className="mt-3 rounded-2xl border border-emerald-200 bg-white/80 px-3 py-2 text-xs leading-5 text-emerald-800">
                              这套做法刚从当前结果沉淀下来，已经回到你的方法库，可以直接带去生成继续跑下一轮。
                            </div>
                          ) : null}
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
                            <div>
                              <span className="font-medium text-slate-700">
                                方法入口：
                              </span>
                              /{skill.key}
                              {skill.repoOwner && skill.repoName
                                ? ` · ${skill.repoOwner}/${skill.repoName}`
                                : ""}
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="text-[11px] leading-5 text-slate-400">
                              会带着这套方法进入生成主执行面，后续结果继续沉淀到当前工作区。
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className={SKILLS_WORKSPACE_SECONDARY_BUTTON_CLASSNAME}
                              onClick={() =>
                                handleInstalledSkillSelect(
                                  skill,
                                  usage?.replayText,
                                )
                              }
                            >
                              带着方法进入生成
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
        <DialogContent className="max-h-[calc(100vh-40px)] w-[min(1240px,calc(100vw-32px))] max-w-none overflow-hidden border-slate-200 p-0">
          <div className="flex h-[calc(100vh-88px)] min-h-[680px] flex-col bg-white">
            <DialogHeader className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>导入与整理</DialogTitle>
                <WorkbenchInfoTip
                  ariaLabel="导入与整理弹窗说明"
                  content="首页先服务进入 Agent 对话开工；这里保留本地导入、仓库管理、标准检查和远程技能安装能力。"
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
        onOpenChange={handleCuratedTaskLauncherOpenChange}
        onConfirm={handleCuratedTaskTemplateSelect}
      />
    </>
  );
}
