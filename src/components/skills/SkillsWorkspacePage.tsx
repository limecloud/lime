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
import { resolveServiceSkillEntryDescription } from "@/components/agent/chat/service-skills/entryAdapter";
import { buildServiceSkillRecommendationBuckets } from "@/components/agent/chat/service-skills/recommendedServiceSkills";
import { resolveServiceSkillLaunchPrefill } from "@/components/agent/chat/service-skills/serviceSkillLaunchPrefill";
import {
  getServiceSkillOutputDestination,
  getServiceSkillTypeLabel,
} from "@/components/agent/chat/service-skills/skillPresentation";
import type {
  ServiceSkillHomeItem,
  ServiceSkillTone,
} from "@/components/agent/chat/service-skills/types";
import { useServiceSkills } from "@/components/agent/chat/service-skills/useServiceSkills";
import { SkillsPage } from "./SkillsPage";
import { getSkillSource } from "./SkillCard";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { buildSkillScaffoldCreationReplayRequestMetadata } from "@/components/agent/chat/utils/creationReplayMetadata";
import { buildSkillScaffoldCreationSeed } from "./skillScaffoldCreationSeed";

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
  const [refreshing, setRefreshing] = useState(false);
  const lastHandledScaffoldRequestKeyRef = useRef<number | null>(null);

  const installedLocalSkills = useMemo(
    () => localSkills.filter((skill) => skill.installed),
    [localSkills],
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
        resolveServiceSkillEntryDescription(skill),
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
        resolveServiceSkillEntryDescription(skill),
      ),
    );
  }, [recentServiceSkills, searchQuery]);

  const visibleInstalledLocalSkills = useMemo(() => {
    return installedLocalSkills.filter((skill) =>
      matchesText(
        searchQuery,
        skill.name,
        skill.description,
        skill.key,
        skill.repoOwner,
        skill.repoName,
        resolveLocalSkillSourceLabel(skill),
      ),
    );
  }, [installedLocalSkills, searchQuery]);
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

  const renderSkillCard = (skill: ServiceSkillHomeItem) => {
    const tone = resolveSkillCardTone(skill);
    const statusLabel = resolveSkillCardStatusLabel(skill);
    const statusDetail = resolveSkillCardStatusDetail(skill);

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
              {skill.summary || resolveServiceSkillEntryDescription(skill)}
            </p>
          </div>

          <div className="space-y-2 text-xs leading-5 text-slate-500">
            <div>
              <span className="font-medium text-slate-700">分类：</span>
              {skill.category}
            </div>
            <div>
              <span className="font-medium text-slate-700">入口：</span>
              {resolveServiceSkillEntryDescription(skill)}
            </div>
            <div>
              <span className="font-medium text-slate-700">去向：</span>
              {getServiceSkillOutputDestination(skill)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
            {statusDetail}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="text-xs text-slate-400">{skill.outputHint}</div>
          <Button
            type="button"
            className="rounded-2xl bg-slate-950 px-4"
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
                    className="rounded-2xl bg-slate-950 px-4"
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
                    {visibleInstalledPreview.map((skill) => (
                      <div
                        key={skill.directory}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                            {resolveLocalSkillSourceLabel(skill)}
                          </span>
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                            已安装
                          </span>
                        </div>
                        <div className="mt-3 text-base font-semibold text-slate-900">
                          {skill.name}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                          {skill.description || "暂无描述"}
                        </p>
                        <div className="mt-3 text-xs leading-5 text-slate-500">
                          /{skill.key}
                          {skill.repoOwner && skill.repoName
                            ? ` · ${skill.repoOwner}/${skill.repoName}`
                            : ""}
                        </div>
                      </div>
                    ))}
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
                initialScaffoldDraft={pageParams?.initialScaffoldDraft}
                initialScaffoldRequestKey={
                  pageParams?.initialScaffoldRequestKey ?? null
                }
                onBringScaffoldToCreation={handleBringScaffoldToCreation}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SkillsWorkspacePage;
