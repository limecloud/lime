import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  FolderOpen,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { useSkills } from "@/hooks/useSkills";
import type { Skill } from "@/lib/api/skills";
import {
  createServiceSkillRun,
  getServiceSkillRun,
  isTerminalServiceSkillRunStatus,
  type ServiceSkillRun,
} from "@/lib/api/serviceSkillRuns";
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
import { ServiceSkillLaunchDialog } from "@/components/agent/chat/service-skills/ServiceSkillLaunchDialog";
import { buildCreationReplaySlotPrefill } from "@/components/agent/chat/service-skills/creationReplaySlotPrefill";
import { resolveServiceSkillEntryDescription } from "@/components/agent/chat/service-skills/entryAdapter";
import { composeServiceSkillPrompt } from "@/components/agent/chat/service-skills/promptComposer";
import {
  getServiceSkillOutputDestination,
  getServiceSkillTypeLabel,
} from "@/components/agent/chat/service-skills/skillPresentation";
import {
  buildServiceSkillSiteCapabilityArgs,
  buildServiceSkillSiteCapabilitySaveTitle,
  isServiceSkillSiteCapabilityBound,
} from "@/components/agent/chat/service-skills/siteCapabilityBinding";
import { recordServiceSkillCloudRun } from "@/components/agent/chat/service-skills/cloudRunStorage";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getCloudRunStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "success":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    case "timeout":
      return "超时";
    default:
      return "处理中";
  }
}

function buildCloudRunSuccessMessage(
  skill: ServiceSkillHomeItem,
  run: ServiceSkillRun,
): string {
  const summary = run.outputSummary?.trim();
  if (summary) {
    return summary;
  }
  return `${skill.title} 已完成云端处理`;
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
    recordUsage,
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
  const [selectedServiceSkill, setSelectedServiceSkill] =
    useState<ServiceSkillHomeItem | null>(null);
  const [serviceSkillDialogOpen, setServiceSkillDialogOpen] = useState(false);
  const [advancedManagerOpen, setAdvancedManagerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastHandledScaffoldRequestKeyRef = useRef<number | null>(null);

  const installedLocalSkills = useMemo(
    () => localSkills.filter((skill) => skill.installed),
    [localSkills],
  );
  const recentServiceSkills = useMemo(
    () => serviceSkills.filter((skill) => skill.isRecent),
    [serviceSkills],
  );
  const skillGroupMap = useMemo(() => {
    const nextMap = new Map<string, ServiceSkillHomeItem[]>();
    for (const group of skillGroups) {
      nextMap.set(group.key, []);
    }
    for (const skill of serviceSkills) {
      const groupKey = resolveSkillGroupKey(skill);
      const current = nextMap.get(groupKey) ?? [];
      current.push(skill);
      nextMap.set(groupKey, current);
    }
    return nextMap;
  }, [serviceSkills, skillGroups]);
  const selectedGroup = useMemo(
    () => skillGroups.find((group) => group.key === selectedGroupKey) ?? null,
    [selectedGroupKey, skillGroups],
  );
  const directoryStatusLabel = useMemo(() => {
    if (serviceSkillsLoading || localSkillsLoading || localSkillsRemoteLoading) {
      return "正在同步当前目录...";
    }
    if (selectedGroup) {
      return `当前正在浏览 ${selectedGroup.title} 技能组。`;
    }
    return "先从一个现成技能开始，不必先理解目录结构。";
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
  const serviceSkillCreationReplayPrefill = useMemo(() => {
    if (!selectedServiceSkill || !scaffoldCreationReplay) {
      return null;
    }

    return buildCreationReplaySlotPrefill(
      selectedServiceSkill,
      scaffoldCreationReplay,
    );
  }, [scaffoldCreationReplay, selectedServiceSkill]);

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
      const groupSkills = skillGroupMap.get(group.key) ?? [];
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
  }, [searchQuery, skillGroupMap, skillGroups]);

  const visibleGroupSkills = useMemo(() => {
    const scopedSkills = selectedGroup
      ? (skillGroupMap.get(selectedGroup.key) ?? [])
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
  }, [searchQuery, selectedGroup, skillGroupMap]);

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
      toast.success("技能目录已刷新");
    } catch (error) {
      toast.error(`刷新技能目录失败：${String(error)}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleServiceSkillSelect = (skill: ServiceSkillHomeItem) => {
    setSelectedServiceSkill(skill);
    setServiceSkillDialogOpen(true);
  };

  const handleServiceSkillLaunch = async (
    skill: ServiceSkillHomeItem,
    slotValues: ServiceSkillSlotValues,
  ) => {
    if (isServiceSkillSiteCapabilityBound(skill)) {
      const binding = skill.siteCapabilityBinding;
      onNavigate("browser-runtime", {
        initialAdapterName: binding.adapterName,
        initialArgs: buildServiceSkillSiteCapabilityArgs(skill, slotValues),
        initialAutoRun: binding.autoRun ?? false,
        initialRequireAttachedSession: binding.requireAttachedSession ?? false,
        initialSaveTitle: buildServiceSkillSiteCapabilitySaveTitle(
          skill,
          slotValues,
        ),
      });
      recordUsage({
        skillId: skill.id,
        runnerType: skill.runnerType,
      });
      toast.success(`已打开 ${skill.title} 的浏览器工作台`);
      setServiceSkillDialogOpen(false);
      setSelectedServiceSkill(null);
      return;
    }

    const prompt = composeServiceSkillPrompt({
      skill,
      slotValues,
    });

    if (skill.executionLocation === "cloud_required") {
      const toastId = toast.loading(`正在开始 ${skill.title} 的云端执行...`);

      try {
        setServiceSkillDialogOpen(false);
        setSelectedServiceSkill(null);

        let run = await createServiceSkillRun(skill.id, prompt);
        recordServiceSkillCloudRun(skill.id, run);
        recordUsage({
          skillId: skill.id,
          runnerType: skill.runnerType,
        });

        for (let attempt = 0; attempt < 8; attempt += 1) {
          if (isTerminalServiceSkillRunStatus(run.status)) {
            break;
          }
          await wait(1_500);
          run = await getServiceSkillRun(run.id);
          recordServiceSkillCloudRun(skill.id, run);
        }

        if (run.status === "success") {
          toast.success(buildCloudRunSuccessMessage(skill, run), {
            id: toastId,
          });
          return;
        }

        if (isTerminalServiceSkillRunStatus(run.status)) {
          throw new Error(
            run.errorMessage ||
              `${skill.title} ${getCloudRunStatusLabel(run.status)}`,
          );
        }

        toast.info(
          `${skill.title} 已开始云端执行，当前${getCloudRunStatusLabel(run.status)}。`,
          {
            id: toastId,
          },
        );
      } catch (error) {
        toast.error(`云端执行失败：${String(error)}`, {
          id: toastId,
        });
      }
      return;
    }

    onNavigate("agent", {
      agentEntry: "claw",
      initialUserPrompt: prompt,
      initialSessionName: skill.title,
      theme: skill.themeTarget,
      lockTheme: Boolean(skill.themeTarget),
      newChatAt: Date.now(),
    });
    recordUsage({
      skillId: skill.id,
      runnerType: skill.runnerType,
    });
    toast.success(`已进入 ${skill.title} 工作模式`);
    setServiceSkillDialogOpen(false);
    setSelectedServiceSkill(null);
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
                    技能 · 直接开工
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
                        技能
                      </h1>
                      <WorkbenchInfoTip
                        ariaLabel="技能主入口说明"
                        content="技能中心现在先展示技能组，再进入具体技能项。适配器继续留在后台做治理，前台不再暴露 adapter、runtime 或 YAML 等技术细节。"
                        tone="mint"
                      />
                    </div>
                    <p className="max-w-3xl text-sm leading-7 text-slate-600">
                      先找能直接开工的做法，再进入具体技能。
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
                    刷新目录
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl border-slate-200"
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    <FolderOpen className="mr-2 h-4 w-4" />
                    导入与维护
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>查找技能组 / 技能项</span>
                    <WorkbenchInfoTip
                      ariaLabel="技能搜索说明"
                      content="先从能直接开工的技能组找起；本地导入、仓库维护和远程安装统一收进导入与维护。"
                      tone="slate"
                    />
                  </div>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="搜索站点、技能标题或业务关键词"
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
                        技能 {serviceSkills.length}
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
                      正在读取当前技能目录
                    </span>
                  )}
                </div>
              </div>
            </div>
          </header>

          {(serviceSkillsError || localSkillsError) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {serviceSkillsError
                ? `云目录加载失败：${serviceSkillsError}`
                : null}
              {serviceSkillsError && localSkillsError ? "；" : null}
              {localSkillsError
                ? `本地技能加载失败：${localSkillsError}`
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
                          技能组 · {selectedGroup.title}
                        </span>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-2xl font-semibold text-slate-950">
                              {selectedGroup.title}
                            </h2>
                            <WorkbenchInfoTip
                              ariaLabel={`${selectedGroup.title}技能组说明`}
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
                            先在这个技能组里选一个具体做法，再决定是否继续扩展到更多技能。
                          </p>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl border-slate-200"
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        返回推荐技能组
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
                        当前技能组下暂无匹配技能
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        可以调整搜索词，或先返回推荐技能组切换到其他方向。
                      </p>
                    </div>
                  )}
                </>
              ) : visibleGroups.length > 0 ? (
                <section className="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                        推荐技能组
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="技能组说明"
                        content="站点能力先按 GitHub、知乎、Linux.do 等技能组进入，通用创作技能也统一收进同一份技能目录。"
                        tone="mint"
                      />
                    </div>
                    <p className="text-sm leading-6 text-slate-500">
                      先从一个现成技能开始，不必先理解目录结构。
                    </p>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleGroups.map((group) => {
                      const groupSkills = skillGroupMap.get(group.key) ?? [];

                      return (
                        <article
                          key={group.key}
                          className="flex h-full flex-col rounded-[28px] border border-slate-200/80 bg-slate-50 p-5 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm hover:shadow-slate-950/5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              技能组
                            </span>
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                              {group.itemCount} 项技能
                            </span>
                          </div>

                          <div className="mt-4 space-y-3">
                            <div>
                              <h3 className="text-xl font-semibold text-slate-950">
                                {group.title}
                              </h3>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <WorkbenchInfoTip
                                  ariaLabel={`${group.title}技能组摘要`}
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
                              <div>
                                <span className="font-medium text-slate-700">
                                  覆盖技能：
                                </span>
                                {groupSkills
                                  .slice(0, 3)
                                  .map((skill) => skill.title)
                                  .join("、")}
                                {groupSkills.length > 3 ? " 等" : ""}
                              </div>
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
                              进入后再选择具体技能项
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-auto rounded-2xl px-0 text-sm font-medium text-slate-900 hover:bg-transparent hover:text-slate-950"
                              onClick={() => setSelectedGroupKey(group.key)}
                            >
                              打开技能组
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
                    当前搜索下暂无技能组
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
                    最近使用
                  </h2>
                  <WorkbenchInfoTip
                    ariaLabel="最近使用技能说明"
                    content="最近执行过的技能会沉淀在这里，方便再次启动。"
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
                            最近使用
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
                    当前还没有最近使用记录。先从一个现成技能开始，后续会自动收敛到这里。
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">
                      我的技能
                    </h2>
                    <WorkbenchInfoTip
                      ariaLabel="本地已安装技能区说明"
                      content="项目级、本地补充和内置技能仍然可用，但高阶仓库、导入和标准检查收纳在高级管理中。"
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
                    导入与维护
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
                    当前还没有自己的技能。先从一个现成技能开始，后续再沉淀成自己的做法也很自然。
                  </div>
                )}
              </section>
            </aside>
          </section>
        </div>
      </div>

      <ServiceSkillLaunchDialog
        skill={selectedServiceSkill}
        open={serviceSkillDialogOpen}
        initialSlotValues={serviceSkillCreationReplayPrefill?.slotValues}
        prefillHint={serviceSkillCreationReplayPrefill?.hint}
        onOpenChange={(open) => {
          setServiceSkillDialogOpen(open);
          if (!open) {
            setSelectedServiceSkill(null);
          }
        }}
        onLaunch={handleServiceSkillLaunch}
      />

      <Dialog open={advancedManagerOpen} onOpenChange={setAdvancedManagerOpen}>
        <DialogContent className="max-h-[calc(100vh-40px)] w-[min(1240px,calc(100vw-32px))] max-w-none overflow-hidden border-slate-200 p-0">
          <div className="flex h-[calc(100vh-88px)] min-h-[680px] flex-col bg-white">
            <DialogHeader className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>导入与维护</DialogTitle>
                <WorkbenchInfoTip
                  ariaLabel="导入与维护弹窗说明"
                  content="首页先服务直接开工；这里保留本地导入、仓库管理、标准检查和远程技能安装能力。"
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
