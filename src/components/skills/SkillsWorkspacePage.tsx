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
import { buildWorkspaceSkillRuntimeEnableHarnessMetadata } from "@/components/agent/chat/utils/workspaceSkillBindingsMetadata";
import {
  getSlashEntryUsageMap,
  getSlashEntryUsageRecordKey,
  recordSlashEntryUsage,
  subscribeSlashEntryUsageChanged,
} from "@/components/agent/chat/skill-selection/slashEntryUsage";
import { buildServiceSkillLaunchPrefillSummary } from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import { resolveSceneAppsPageEntryParams } from "@/lib/sceneapp";
import { getProject } from "@/lib/api/project";
import type { AgentRuntimeWorkspaceSkillBinding } from "@/lib/api/agentRuntime";
import {
  CapabilityDraftPanel,
  WorkspaceRegisteredSkillsPanel,
} from "@/features/capability-drafts";
import { createAutomationJob } from "@/lib/api/automation";
import type { Project } from "@/lib/api/project";
import {
  AutomationJobDialog,
  type AutomationJobDialogInitialValues,
  type AutomationJobDialogSubmit,
} from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { buildWorkspaceSkillAgentAutomationInitialValues } from "@/features/capability-drafts/workspaceSkillAgentAutomationDraft";

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

function buildWorkspaceRuntimeEnablePrompt(
  binding: AgentRuntimeWorkspaceSkillBinding,
): string {
  const skillName = binding.name?.trim() || binding.directory;
  return [
    `请在本回合使用 Workspace 本地 Skill「${skillName}」（skill: project:${binding.directory}）。`,
    "先读取这个 Skill 的说明与约束，再基于当前任务完成交付。",
    "如果输入信息不足，请先提出最少必要问题；不要创建自动化、定时任务或 marketplace 发布。",
  ].join("\n");
}

function buildSkillGroupStarterSummary(skills: ServiceSkillHomeItem[]): string {
  const starterTitles = skills.slice(0, 2).map((skill) => `「${skill.title}」`);

  if (starterTitles.length === 0) {
    return "先带着这次目标进去继续收窄。";
  }

  return starterTitles.length < skills.length
    ? `这一组里可以先从${starterTitles.join(" / ")}等 Skill 开始。`
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
    skills: serviceSkills = [],
    groups: skillGroups = [],
    error: serviceSkillsError,
    refresh: refreshServiceSkills,
  } = useServiceSkills();
  const {
    skills: localSkills = [],
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
  const [capabilityDraftWorkspaceRoot, setCapabilityDraftWorkspaceRoot] =
    useState<string | null>(null);
  const [capabilityDraftProject, setCapabilityDraftProject] =
    useState<Project | null>(null);
  const [capabilityDraftProjectLoading, setCapabilityDraftProjectLoading] =
    useState(false);
  const [capabilityDraftProjectError, setCapabilityDraftProjectError] =
    useState<string | null>(null);
  const [registeredSkillsRefreshSignal, setRegisteredSkillsRefreshSignal] =
    useState(0);
  const [
    workspaceSkillAutomationDialogOpen,
    setWorkspaceSkillAutomationDialogOpen,
  ] = useState(false);
  const [
    workspaceSkillAutomationInitialValues,
    setWorkspaceSkillAutomationInitialValues,
  ] = useState<AutomationJobDialogInitialValues | null>(null);
  const [workspaceSkillAutomationSaving, setWorkspaceSkillAutomationSaving] =
    useState(false);
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
  const highlightedCapabilityDraftId =
    pageParams?.highlightCapabilityDraftId?.trim() || undefined;
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

  useEffect(() => {
    let cancelled = false;

    if (!creationProjectId) {
      setCapabilityDraftWorkspaceRoot(null);
      setCapabilityDraftProject(null);
      setCapabilityDraftProjectError(null);
      setCapabilityDraftProjectLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setCapabilityDraftProjectLoading(true);
    setCapabilityDraftProjectError(null);
    void getProject(creationProjectId)
      .then((project) => {
        if (cancelled) {
          return;
        }
        const rootPath = project?.rootPath?.trim() || null;
        setCapabilityDraftProject(project ?? null);
        setCapabilityDraftWorkspaceRoot(rootPath);
        setCapabilityDraftProjectError(
          rootPath ? null : "当前项目没有可用的本地目录",
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setCapabilityDraftProject(null);
        setCapabilityDraftWorkspaceRoot(null);
        setCapabilityDraftProjectError(String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setCapabilityDraftProjectLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [creationProjectId]);

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
      toast.success("Skills 已刷新");
    } catch (error) {
      toast.error(`刷新 Skills 失败：${String(error)}`);
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
            ? `已带着 Skill「${skill.name}」和上次目标回到生成，接着把这轮做下去就行。`
            : `已带着 Skill「${skill.name}」回到生成，接着把这轮做下去就行。`,
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

  const handleWorkspaceRuntimeEnable = useCallback(
    (binding: AgentRuntimeWorkspaceSkillBinding) => {
      if (!capabilityDraftWorkspaceRoot) {
        toast.error("当前项目没有可用的本地目录，无法启用 Workspace Skill。");
        return;
      }

      const runtimeEnableMetadata =
        buildWorkspaceSkillRuntimeEnableHarnessMetadata({
          workspaceRoot: capabilityDraftWorkspaceRoot,
          bindings: [binding],
        });

      if (!runtimeEnableMetadata) {
        toast.error("该 Workspace Skill 尚未通过 runtime enable gate。");
        return;
      }

      const skillName = binding.name?.trim() || binding.directory;
      onNavigate(
        "agent",
        buildHomeAgentParams({
          projectId: creationProjectId,
          initialUserPrompt: buildWorkspaceRuntimeEnablePrompt(binding),
          autoRunInitialPromptOnMount: true,
          initialAutoSendRequestMetadata: {
            harness: runtimeEnableMetadata,
          },
          entryBannerMessage: `已在本回合显式启用 Workspace Skill「${skillName}」；这只授权当前会话调用，不创建自动化。`,
        }),
      );
    },
    [capabilityDraftWorkspaceRoot, creationProjectId, onNavigate],
  );

  const handleWorkspaceManagedAutomationDraft = useCallback(
    (binding: AgentRuntimeWorkspaceSkillBinding) => {
      if (!creationProjectId || !capabilityDraftProject) {
        toast.error("缺少项目工作区，无法创建 Managed Job 草案。");
        return;
      }
      if (!capabilityDraftWorkspaceRoot) {
        toast.error("当前项目没有可用的本地目录，无法创建 Managed Job 草案。");
        return;
      }

      const initialValues = buildWorkspaceSkillAgentAutomationInitialValues({
        binding,
        workspaceRoot: capabilityDraftWorkspaceRoot,
        workspaceId: creationProjectId,
      });
      if (!initialValues) {
        toast.error("该 Workspace Skill 尚未满足 Managed Job 草案条件。");
        return;
      }

      setWorkspaceSkillAutomationInitialValues(initialValues);
      setWorkspaceSkillAutomationDialogOpen(true);
    },
    [capabilityDraftProject, capabilityDraftWorkspaceRoot, creationProjectId],
  );

  const handleWorkspaceSkillAutomationDialogOpenChange = useCallback(
    (open: boolean) => {
      setWorkspaceSkillAutomationDialogOpen(open);
      if (!open) {
        setWorkspaceSkillAutomationInitialValues(null);
      }
    },
    [],
  );

  const handleWorkspaceSkillAutomationSubmit = useCallback(
    async (payload: AutomationJobDialogSubmit) => {
      if (payload.mode !== "create") {
        throw new Error("当前入口只支持创建新的 Managed Job 草案");
      }

      setWorkspaceSkillAutomationSaving(true);
      try {
        const createdJob = await createAutomationJob(payload.request);
        toast.success(`Managed Job 草案已创建：${createdJob.name}`);
        setWorkspaceSkillAutomationDialogOpen(false);
        setWorkspaceSkillAutomationInitialValues(null);
      } catch (error) {
        toast.error(
          `创建 Managed Job 草案失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setWorkspaceSkillAutomationSaving(false);
      }
    },
    [],
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
        toast.error(`刷新 Skills 失败：${String(error)}`);
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
      toast.success(`已创建“${skill.name}”并收进 Skills`);
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
    () => activeScaffoldDraft?.name?.trim() || "当前 Skill 草稿",
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
    const promise = resolveServiceSkillEntryDescription(skill);
    const requiredInputs = summarizeServiceSkillRequiredInputs(skill);
    const outputDestination = getServiceSkillOutputDestination(skill);

    return (
      <article
        key={skill.id}
        className="flex h-full flex-col rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-1 text-sm font-medium text-slate-900">
              {skill.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
              {skill.summary || promise}
            </p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              TONE_BADGE_CLASSNAMES[tone],
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-3">
          <div className="min-w-0 text-[11px] leading-5 text-slate-500">
            <span className="line-clamp-1">{skill.outputHint}</span>
            <span className="sr-only">
              {requiredInputs}
              {outputDestination}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
            onClick={() => handleServiceSkillSelect(skill)}
          >
            {skill.actionLabel}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </article>
    );
  };

  return (
    <>
      <div className="lime-workbench-theme-scope flex h-full min-h-0 flex-col overflow-hidden bg-[image:var(--lime-stage-surface)]">
        <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col gap-4 overflow-auto px-6 py-6">
          <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Skills
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  选择一个 Skill 开始创作
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50"
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50"
                  onClick={handleOpenSceneAppsDirectory}
                >
                  查看全部
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {activeScaffoldDraft ? (
                <div
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                  data-testid="skills-workspace-active-scaffold-banner"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        这次续用
                      </span>
                      <span className="min-w-0 font-medium text-slate-900">
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
                          {summarizeRecentReplayText(activeScaffoldReplayText)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-lg px-2.5 text-slate-600 hover:bg-white hover:text-slate-900"
                        data-testid="skills-workspace-open-scaffold-manager"
                        onClick={() => setAdvancedManagerOpen(true)}
                      >
                        继续补完
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-slate-700 hover:bg-slate-50 hover:text-slate-900"
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
                  placeholder="搜索想拿的结果、这一步或 Skill 名"
                  className="h-10 rounded-lg border-slate-200 bg-slate-50 pl-10"
                />
              </div>
            </div>
          </header>

          {(serviceSkillsError || localSkillsError) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {serviceSkillsError
                ? `推荐 Skills 暂时没同步下来：${serviceSkillsError}`
                : null}
              {serviceSkillsError && localSkillsError ? "；" : null}
              {localSkillsError
                ? `本地 Skills 暂时没读到：${localSkillsError}`
                : null}
            </div>
          )}

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">
                    推荐
                  </h2>
                  <span className="text-xs text-slate-500">
                    先选结果，再补信息
                  </span>
                </div>

                {reviewRecommendationBanner ? (
                  <div
                    className="mt-3 flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
                    data-testid="skills-workspace-review-feedback-banner"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-medium text-slate-900">
                        最近判断已更新：{reviewRecommendationBanner.title}
                      </div>
                      <div className="line-clamp-2 text-xs leading-5 text-slate-600">
                        {reviewRecommendationBanner.summary}
                      </div>
                    </div>
                    <div className="sr-only">
                      更适合继续：{reviewRecommendationBanner.nextSteps}
                    </div>
                    {reviewRecommendationBanner.actionLabel &&
                    reviewRecommendationBanner.onAction ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        data-testid="skills-workspace-review-feedback-banner-action"
                        onClick={() => reviewRecommendationBanner.onAction?.()}
                      >
                        {reviewRecommendationBanner.actionLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {visibleFeaturedCuratedTaskTemplates.length > 0 ? (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
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
                              "flex h-full flex-col rounded-xl border px-3 py-3 transition hover:border-slate-300 hover:shadow-sm",
                              isPrimaryRecommendation
                                ? "border-emerald-200 bg-emerald-50/60"
                                : "border-slate-200 bg-white",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="line-clamp-1 text-sm font-medium text-slate-950">
                                  {template.title}
                                </h3>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                                  {template.summary}
                                </p>
                              </div>
                              {isPrimaryRecommendation ? (
                                <span className="shrink-0 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                  推荐
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 space-y-2">
                              {featured.reasonLabel || compactReasonSummary ? (
                                <div className="line-clamp-1 text-[11px] leading-5 text-slate-500">
                                  {[featured.reasonLabel, compactReasonSummary]
                                    .filter((segment): segment is string =>
                                      Boolean(segment && segment.trim()),
                                    )
                                    .join(" · ")}
                                </div>
                              ) : null}
                              {reviewPrefillHighlights.length > 0 ? (
                                <div className="rounded-lg border border-emerald-200 bg-white/80 px-2.5 py-2 text-[11px] leading-5 text-emerald-800">
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
                            <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                              <div className="min-w-0 text-[11px] leading-5 text-slate-500">
                                <div className="line-clamp-1">
                                  {template.outputHint || outputSummary}
                                </div>
                                <span className="sr-only">
                                  {requiredSummary}
                                  {resultDestination}
                                  {followUpSummary}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                                onClick={() =>
                                  handleCuratedTaskTemplateLauncherRequest(
                                    template,
                                  )
                                }
                              >
                                进入生成
                                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </article>
                        );
                      },
                    )}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前搜索下暂无结果模板。可以先清掉关键词，或直接从下方换个方向继续找。
                  </div>
                )}
              </section>

              {selectedGroup ? (
                <>
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <h2 className="text-base font-semibold text-slate-900">
                          {selectedGroup.title}
                        </h2>
                        <p className="text-xs leading-5 text-slate-600">
                          选择这一组里的一个 Skill 继续
                        </p>
                        <span className="sr-only">
                          {selectedGroup.summary}
                          {selectedGroup.entryHint}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        换个方向
                      </Button>
                    </div>
                  </section>

                  {visibleGroupSkills.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {visibleGroupSkills.map(renderSkillCard)}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                      <div className="text-sm font-semibold text-slate-900">
                        当前分组下暂无匹配 Skill
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        可以调整搜索词，或先返回上一步换个方向继续找。
                      </p>
                    </div>
                  )}
                </>
              ) : visibleGroups.length > 0 ? (
                <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">
                        分类
                      </h2>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={handleOpenSceneAppsDirectory}
                      >
                        查看全部
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {visibleGroups.map((group) => {
                      const groupSkills =
                        recommendedSkillGroupMap.get(group.key) ?? [];
                      const hasRecommendedGroupSkills = groupSkills.length > 0;

                      return (
                        <article
                          key={group.key}
                          className="flex h-full flex-col rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-slate-300 hover:shadow-sm"
                        >
                          <div className="space-y-2">
                            <div>
                              <h3 className="text-sm font-medium text-slate-900">
                                {group.title}
                              </h3>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
                                {group.summary}
                              </p>
                            </div>
                            <div className="line-clamp-1 text-[11px] leading-5 text-slate-500">
                              <div>
                                {hasRecommendedGroupSkills
                                  ? buildSkillGroupStarterSummary(groupSkills)
                                  : "先带着这次目标进去继续收窄。"}
                              </div>
                              <span className="sr-only">
                                {group.themeTarget}
                                {group.entryHint}
                              </span>
                            </div>
                          </div>

                          <div className="mt-auto flex justify-end pt-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                              onClick={() => setSelectedGroupKey(group.key)}
                            >
                              进去看看
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <div className="text-sm font-semibold text-slate-900">
                    当前搜索下暂无 Skill 分组
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    可以尝试刷新，或换个结果方向、Skill 名继续找。
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-3">
              <section
                className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm"
                data-testid="skills-workspace-sidebar-section-continuation"
              >
                <h2 className="text-sm font-semibold text-emerald-900">最近</h2>

                {visibleRecentPreview.length > 0 ? (
                  <div className="mt-3 space-y-2">
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
                          className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2.5 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
                        >
                          <div className="line-clamp-1 text-sm font-medium text-slate-900">
                            {skill.title}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-600">
                            {skill.summary}
                          </p>
                          <div className="mt-1 text-[11px] leading-5 text-slate-500">
                            <span className="line-clamp-1">
                              {recentPrefillSummary || skill.outputHint}
                            </span>
                            <span className="sr-only">
                              {summarizeServiceSkillRequiredInputs(skill)}
                              {getServiceSkillOutputDestination(skill)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-emerald-200 bg-white px-4 py-6 text-sm text-emerald-700/80">
                    当前还没有可继续项。先从左侧拿一个结果或 Skill
                    开始，后续会自动回到这里。
                  </div>
                )}
              </section>

              <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                  能力草案
                </summary>
                <div className="mt-3">
                  <CapabilityDraftPanel
                    workspaceRoot={capabilityDraftWorkspaceRoot}
                    projectPending={capabilityDraftProjectLoading}
                    projectError={capabilityDraftProjectError}
                    highlightedDraftId={highlightedCapabilityDraftId}
                    onRegisteredSkillsChanged={() =>
                      setRegisteredSkillsRefreshSignal(
                        (previous) => previous + 1,
                      )
                    }
                  />
                </div>
              </details>

              <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer list-none text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
                  已注册能力
                </summary>
                <div className="mt-3">
                  <WorkspaceRegisteredSkillsPanel
                    workspaceRoot={capabilityDraftWorkspaceRoot}
                    workspaceId={creationProjectId}
                    projectPending={capabilityDraftProjectLoading}
                    projectError={capabilityDraftProjectError}
                    refreshSignal={registeredSkillsRefreshSignal}
                    onEnableRuntime={handleWorkspaceRuntimeEnable}
                    onCreateManagedAutomationDraft={
                      handleWorkspaceManagedAutomationDraft
                    }
                  />
                </div>
              </details>

              <section
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                data-testid="skills-workspace-sidebar-section-library"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    本地 Skills
                  </h2>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg px-2.5 text-xs text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                    调整
                  </Button>
                </div>

                {visibleInstalledPreview.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {highlightedInstalledSkill ? (
                      <div
                        className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 shadow-sm"
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
                              className="h-8 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50 hover:text-slate-900"
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
                            "rounded-lg border bg-white px-3 py-2.5 transition",
                            isHighlighted
                              ? "border-emerald-300 bg-emerald-50/70 shadow-sm"
                              : "border-slate-200 hover:border-slate-300",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="line-clamp-1 text-sm font-medium text-slate-900">
                              {skill.name}
                            </div>
                            {isHighlighted ? (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                刚沉淀
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-1 text-[12px] leading-5 text-slate-600">
                            {resolveInstalledSkillPromise(skill)}
                          </p>
                          <div className="mt-1.5 text-[11px] leading-5 text-slate-500">
                            {recentUsageDescription ? (
                              <div className="line-clamp-1">
                                {recentUsageDescription}
                              </div>
                            ) : null}
                            <span className="sr-only">
                              {summarizeInstalledSkillRequiredInputs(skill)}
                              {getInstalledSkillOutputHint(skill)}
                              回到生成后会继续按这个 Skill 往下做。
                            </span>
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="line-clamp-1 text-[11px] leading-5 text-slate-500">
                              回到生成后会继续按这个 Skill
                              往下做，跑顺后的结果也会再沉淀回来。
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0 rounded-lg border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                              onClick={() =>
                                handleInstalledSkillSelect(
                                  skill,
                                  usage?.replayText,
                                )
                              }
                            >
                              继续这个 Skill
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    当前还没有本地 Skill。先从左侧 Skill
                    开始，后续再沉淀到这里也很自然。
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
                <DialogTitle>调整 Skills</DialogTitle>
                <WorkbenchInfoTip
                  ariaLabel="调整 Skills 弹窗说明"
                  content="需要补、改、删时在这里处理；平时还是先从结果和顺手 Skill 开工。"
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

      <AutomationJobDialog
        open={workspaceSkillAutomationDialogOpen}
        mode="create"
        workspaces={capabilityDraftProject ? [capabilityDraftProject] : []}
        initialValues={workspaceSkillAutomationInitialValues}
        saving={workspaceSkillAutomationSaving}
        onOpenChange={handleWorkspaceSkillAutomationDialogOpenChange}
        onSubmit={handleWorkspaceSkillAutomationSubmit}
      />
    </>
  );
}
