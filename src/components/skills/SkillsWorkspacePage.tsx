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
import { buildSkillScaffoldCreationSeed } from "./skillScaffoldCreationSeed";
import {
  FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS,
  buildCuratedTaskLaunchPrompt,
  filterCuratedTaskTemplates,
  getCuratedTaskOutputDestination,
  listCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  summarizeCuratedTaskFollowUpActions,
  summarizeCuratedTaskOptionalReferences,
  summarizeCuratedTaskOutputContract,
  summarizeCuratedTaskRequiredInputs,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "@/components/agent/chat/utils/curatedTaskTemplates";
import {
  buildCuratedTaskLaunchRequestMetadata,
  normalizeCuratedTaskLaunchInputValues,
  type CuratedTaskReferenceSelection,
} from "@/components/agent/chat/utils/curatedTaskReferenceSelection";
import { subscribeCuratedTaskRecommendationSignalsChanged } from "@/components/agent/chat/utils/curatedTaskRecommendationSignals";

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

function resolveSkillCardTone(skill: ServiceSkillHomeItem): ServiceSkillTone {
  if (skill.cloudStatus?.tone) {
    return skill.cloudStatus.tone;
  }
  if (skill.automationStatus?.tone) {
    return skill.automationStatus.tone;
  }
  return skill.runnerTone;
}

function resolveSkillCardStatusLabel(skill: ServiceSkillHomeItem): string {
  if (skill.cloudStatus?.statusLabel) {
    return skill.cloudStatus.statusLabel;
  }
  if (skill.automationStatus?.statusLabel) {
    return skill.automationStatus.statusLabel;
  }
  return skill.runnerLabel;
}

function resolveSkillCardStatusDetail(skill: ServiceSkillHomeItem): string {
  if (skill.cloudStatus?.detail) {
    return skill.cloudStatus.detail;
  }
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
  const scaffoldCreationReplay = useMemo(() => {
    if (!pageParams?.initialScaffoldDraft) {
      return undefined;
    }

    const projectId = pageParams.creationProjectId?.trim() || undefined;
    return buildSkillScaffoldCreationReplayRequestMetadata(
      pageParams.initialScaffoldDraft,
      {
        projectId,
      },
    ).harness.creation_replay;
  }, [pageParams?.creationProjectId, pageParams?.initialScaffoldDraft]);

  useEffect(() => {
    if (selectedGroupKey && !selectedGroup) {
      setSelectedGroupKey(null);
    }
  }, [selectedGroup, selectedGroupKey]);

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
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
      const projectId = pageParams?.creationProjectId?.trim() || undefined;
      onNavigate(
        "agent",
        buildHomeAgentParams({
          projectId,
          initialUserPrompt: seed.initialUserPrompt,
          entryBannerMessage: seed.entryBannerMessage,
          initialRequestMetadata:
            buildSkillScaffoldCreationReplayRequestMetadata(draft, {
              projectId,
            }),
        }),
      );
    },
    [onNavigate, pageParams?.creationProjectId],
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
      void curatedTaskRecommendationSignalsVersion;
      return filterCuratedTaskTemplates(searchQuery, listCuratedTaskTemplates());
    },
    [curatedTaskRecommendationSignalsVersion, searchQuery],
  );
  const visibleFeaturedCuratedTaskTemplates = useMemo(
    () =>
      listFeaturedHomeCuratedTaskTemplates(visibleCuratedTaskTemplates, {
        projectId: pageParams?.creationProjectId,
        limit: FEATURED_HOME_CURATED_TASK_TEMPLATE_IDS.length,
      }),
    [pageParams?.creationProjectId, visibleCuratedTaskTemplates],
  );
  const visibleRecentPreview = useMemo(
    () => visibleRecentSkills.slice(0, 4),
    [visibleRecentSkills],
  );
  const visibleInstalledPreview = useMemo(
    () => visibleInstalledLocalSkills.slice(0, 4),
    [visibleInstalledLocalSkills],
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
      ...buildHomeAgentParams(),
      initialPendingServiceSkillLaunch: {
        skillId: skill.id,
        requestKey: Date.now(),
        initialSlotValues: prefill?.slotValues,
        prefillHint: prefill?.hint,
      },
    });
  };

  const handleInstalledSkillSelect = useCallback(
    (skill: Skill) => {
      onNavigate("agent", {
        ...buildHomeAgentParams(),
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
    [onNavigate],
  );

  const handleScaffoldCreated = useCallback(
    async (skill: Skill) => {
      setOptimisticInstalledSkill(skill);
      try {
        await refreshLocalSkills();
      } catch (error) {
        toast.error(`同步我的方法库失败：${String(error)}`);
      }

      setSearchQuery("");
      setHighlightedInstalledSkillDirectory(skill.directory);
      setAdvancedManagerOpen(false);
      setConsumedScaffoldRequestKey(
        pageParams?.initialScaffoldRequestKey ?? null,
      );
      toast.success(`已创建“${skill.name}”并加入我的方法库`);
    },
    [pageParams?.initialScaffoldRequestKey, refreshLocalSkills],
  );

  const activeScaffoldRequestKey =
    pageParams?.initialScaffoldRequestKey === consumedScaffoldRequestKey
      ? null
      : (pageParams?.initialScaffoldRequestKey ?? null);
  const activeScaffoldDraft =
    pageParams?.initialScaffoldRequestKey === consumedScaffoldRequestKey
      ? null
      : (pageParams?.initialScaffoldDraft ?? null);

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
    [onNavigate],
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

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.82fr)]">
            <div className="space-y-4">
              {selectedGroup ? (
                <>
                  <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                          做法组 · {selectedGroup.title}
                        </span>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-semibold text-slate-950">
                              {selectedGroup.title}
                            </h2>
                            <WorkbenchInfoTip
                              ariaLabel={`${selectedGroup.title}做法组说明`}
                              content={selectedGroup.summary}
                              tone="slate"
                            />
                            {selectedGroup.entryHint ? (
                              <WorkbenchInfoTip
                                ariaLabel={`${selectedGroup.title}入口提示`}
                                content={selectedGroup.entryHint}
                                tone="mint"
                                variant="pill"
                                label="入口提示"
                              />
                            ) : null}
                          </div>
                          <p className="text-sm leading-6 text-slate-500">
                            先在这个做法组里选一个具体做法，再决定是否继续扩展到更多技能。
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl border-slate-200"
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        返回方法目录
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
                <section className="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                        方法目录
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="做法组说明"
                        content="首页先看结果模板；当你已经知道要找哪类做法时，再从这里进入对应技能组。"
                        tone="mint"
                      />
                    </div>
                    <p className="text-sm leading-6 text-slate-500">
                      先按目标方向找一组做法，不必先理解目录结构。
                    </p>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleGroups.map((group) => {
                      const groupSkills =
                        recommendedSkillGroupMap.get(group.key) ?? [];
                      const hasRecommendedGroupSkills = groupSkills.length > 0;

                      return (
                        <article
                          key={group.key}
                          className="flex h-full flex-col rounded-[28px] border border-slate-200/80 bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm hover:shadow-slate-950/5"
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

                          <div className="mt-4 space-y-3">
                            <div>
                              <h3 className="text-xl font-semibold text-slate-950">
                                {group.title}
                              </h3>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <WorkbenchInfoTip
                                  ariaLabel={`${group.title}做法组摘要`}
                                  content={group.summary}
                                  tone="slate"
                                />
                                {group.entryHint ? (
                                  <WorkbenchInfoTip
                                    ariaLabel={`${group.title}入口提示`}
                                    content={group.entryHint}
                                    tone="mint"
                                    variant="pill"
                                    label="入口提示"
                                  />
                                ) : null}
                              </div>
                            </div>
                            <div className="space-y-2 text-xs leading-5 text-slate-500">
                              {hasRecommendedGroupSkills ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    覆盖做法：
                                  </span>
                                  {groupSkills
                                    .slice(0, 3)
                                    .map((skill) => skill.title)
                                    .join("、")}
                                  {groupSkills.length > 3 ? " 等" : ""}
                                </div>
                              ) : (
                                <div>
                                  当前这组做法已沉淀到常用做法，可直接从右侧继续，或打开做法组查看。
                                </div>
                              )}
                              {group.themeTarget ? (
                                <div>
                                  <span className="font-medium text-slate-700">
                                    主题：
                                  </span>
                                  {group.themeTarget}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                            <div className="text-xs text-slate-400">
                              进入后再选具体做法
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto rounded-2xl px-0 text-sm font-medium text-slate-900 hover:bg-transparent hover:text-slate-950"
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
              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    先拿结果
                  </h2>
                  <WorkbenchInfoTip
                    ariaLabel="结果模板桥接说明"
                    content="结果模板和方法目录现在共享同一套 curated task 事实源；如果你还没想好做法，先拿一个结果起手式进入生成。"
                    tone="mint"
                  />
                  {visibleCuratedTaskTemplates.length > 0 ? (
                    <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                      {visibleCuratedTaskTemplates.length} 个
                    </span>
                  ) : null}
                </div>

                {visibleFeaturedCuratedTaskTemplates.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {visibleFeaturedCuratedTaskTemplates.map((featured) => {
                      const template = featured.template;

                      return (
                      <article
                        key={template.id}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                            {featured.badgeLabel}
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            {template.outputHint}
                          </span>
                        </div>
                        <div className="mt-3 text-base font-semibold text-slate-900">
                          {template.title}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {template.summary}
                        </p>
                        {featured.reasonSummary ? (
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {featured.reasonSummary}
                          </div>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          <div className="rounded-[18px] border border-slate-200 bg-white/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              你来给
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-600">
                              {summarizeCuratedTaskRequiredInputs(template)}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-slate-200 bg-white/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              可选参考
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-600">
                              {summarizeCuratedTaskOptionalReferences(template)}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-slate-200 bg-white/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              会拿到
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-600">
                              {summarizeCuratedTaskOutputContract(template)}
                            </div>
                          </div>
                          <div className="rounded-[18px] border border-slate-200 bg-white/70 px-3 py-2.5">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                              结果去向
                            </div>
                            <div className="mt-1 text-xs leading-5 text-slate-600">
                              {getCuratedTaskOutputDestination(template)}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3">
                          <div className="text-xs leading-5 text-slate-400">
                            下一步可继续：
                            {summarizeCuratedTaskFollowUpActions(template)}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto rounded-2xl px-0 text-sm font-medium text-slate-900 hover:bg-transparent hover:text-slate-950"
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
                  <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前搜索下暂无结果模板。可以先清掉关键词，或直接从左侧做法目录继续找具体方法。
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">
                    继续常用做法
                  </h2>
                  <WorkbenchInfoTip
                    ariaLabel="最近做法说明"
                    content="最近跑通过的做法会沉淀在这里，方便再次续上。"
                    tone="slate"
                  />
                  {visibleRecentSkills.length > 0 ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      {visibleRecentSkills.length} 个
                    </span>
                  ) : null}
                </div>

                {visibleRecentPreview.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {visibleRecentPreview.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => handleServiceSkillSelect(skill)}
                        className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            最近成功
                          </span>
                          <span className="text-[11px] text-slate-400">
                            {skill.actionLabel}
                          </span>
                        </div>
                        <div className="mt-3 text-base font-semibold text-slate-900">
                          {skill.title}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                          {skill.summary}
                        </p>
                        <div className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
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
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    当前还没有最近做法。先从一个现成做法开始，后续会自动收敛到这里。
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">
                      我的方法库
                    </h2>
                    <WorkbenchInfoTip
                      ariaLabel="本地方法库说明"
                      content="项目级、本地补充和内置技能仍然可用，但高阶仓库、导入和标准检查收纳在导入与整理。"
                      tone="slate"
                    />
                    {visibleInstalledLocalSkills.length > 0 ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                        {visibleInstalledLocalSkills.length} 个
                      </span>
                    ) : null}
                  </div>
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

                {visibleInstalledPreview.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {visibleInstalledPreview.map((skill) => {
                      const isHighlighted =
                        skill.directory === highlightedInstalledSkillDirectory;

                      return (
                        <article
                          key={skill.directory}
                          className={cn(
                            "rounded-[24px] border bg-slate-50 px-4 py-4 transition",
                            isHighlighted
                              ? "border-emerald-300 bg-emerald-50/70 shadow-sm shadow-emerald-950/5"
                              : "border-slate-200",
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
                          <div className="mt-3 text-base font-semibold text-slate-900">
                            {skill.name}
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                            {resolveInstalledSkillPromise(skill)}
                          </p>
                          {isHighlighted ? (
                            <div className="mt-3 rounded-2xl border border-emerald-200 bg-white/80 px-3 py-2 text-xs leading-5 text-emerald-800">
                              这套做法刚从当前结果沉淀下来，已经回到你的方法库，可以直接带去生成继续跑下一轮。
                            </div>
                          ) : null}
                          <div className="mt-3 space-y-1 text-xs leading-5 text-slate-500">
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
                            <div className="text-xs text-slate-400">
                              会带着这套方法进入生成主执行面，后续结果继续沉淀到当前工作区。
                            </div>
                            <Button
                              type="button"
                              className={SKILLS_WORKSPACE_PRIMARY_BUTTON_CLASSNAME}
                              onClick={() => handleInstalledSkillSelect(skill)}
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
        onOpenChange={handleCuratedTaskLauncherOpenChange}
        onConfirm={handleCuratedTaskTemplateSelect}
      />
    </>
  );
}
