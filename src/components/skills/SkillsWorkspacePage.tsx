import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  FolderOpen,
  Globe,
  RefreshCw,
  Search,
  Sparkles,
  Workflow,
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
import type { Page, PageParams } from "@/types/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ServiceSkillLaunchDialog } from "@/components/agent/chat/service-skills/ServiceSkillLaunchDialog";
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

interface SkillsWorkspacePageProps {
  onNavigate: (page: Page, params?: PageParams) => void;
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

function matchesText(query: string, ...values: Array<string | undefined>): boolean {
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

function buildCloudRunSuccessMessage(skill: ServiceSkillHomeItem, run: ServiceSkillRun): string {
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
  return (skill as ServiceSkillHomeItem & { groupKey?: string }).groupKey ?? "general";
}

export function SkillsWorkspacePage({
  onNavigate,
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

  const [activeTab, setActiveTab] = useState("market");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedServiceSkill, setSelectedServiceSkill] =
    useState<ServiceSkillHomeItem | null>(null);
  const [serviceSkillDialogOpen, setServiceSkillDialogOpen] = useState(false);
  const [advancedManagerOpen, setAdvancedManagerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  useEffect(() => {
    if (selectedGroupKey && !selectedGroup) {
      setSelectedGroupKey(null);
    }
  }, [selectedGroup, selectedGroupKey]);

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
      toast.success(`已打开 ${skill.title} 的浏览器协助入口`);
      setServiceSkillDialogOpen(false);
      setSelectedServiceSkill(null);
      return;
    }

    const prompt = composeServiceSkillPrompt({
      skill,
      slotValues,
    });

    if (skill.executionLocation === "cloud_required") {
      const toastId = toast.loading(`正在提交 ${skill.title} 到云端...`);

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
          `${skill.title} 已提交云端，当前${getCloudRunStatusLabel(run.status)}。`,
          {
            id: toastId,
          },
        );
      } catch (error) {
        toast.error(`提交云端运行失败：${String(error)}`, {
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
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(244,247,250,0.98)_100%)]">
        <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col gap-6 overflow-auto px-6 py-6">
          <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
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
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] leading-5 text-slate-500">
                {catalogMeta ? (
                  <>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                      技能 {serviceSkills.length}
                    </span>
                    {catalogMeta.groupCount ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        分组 {catalogMeta.groupCount}
                      </span>
                    ) : null}
                    {syncedAtLabel ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        同步于 {syncedAtLabel}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    正在读取当前技能目录
                  </span>
                )}
              </div>
            </div>

            <div className="w-full max-w-[420px] rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                <span>查找技能组 / 技能项</span>
                <WorkbenchInfoTip
                  ariaLabel="技能搜索说明"
                  content="先从能直接开工的技能组找起；本地导入、仓库维护和远程安装统一收进导入与维护。"
                  tone="slate"
                />
              </div>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="搜索站点、技能标题或业务关键词"
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
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
          </header>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.95fr)]">
            <div className="rounded-[30px] border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-950/5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700">
                    从现成做法开始
                  </span>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                        先找能直接开工的做法
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="技能组说明"
                        content="站点能力先按 GitHub、知乎、Linux.do 等技能组进入，通用业务技能也统一收进同一份技能目录。"
                        tone="mint"
                      />
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-2xl border-slate-200"
                  onClick={() => onNavigate("agent", { agentEntry: "claw" })}
                >
                  回到任务中心
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400">
                    <span>技能分组</span>
                    <WorkbenchInfoTip
                      ariaLabel="技能分组说明"
                      content="先按站点或能力组进入，再选择具体技能项。"
                      tone="slate"
                    />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">
                    {skillGroups.length}
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400">
                    <span>可用技能</span>
                    <WorkbenchInfoTip
                      ariaLabel="可用技能说明"
                      content="已进入统一技能目录并可直接启动的技能数量。"
                      tone="slate"
                    />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">
                    {serviceSkills.length}
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-slate-400">
                    <span>本地已安装</span>
                    <WorkbenchInfoTip
                      ariaLabel="本地已安装技能说明"
                      content="本地和项目级补充技能仍保留在导入与维护里。"
                      tone="slate"
                    />
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">
                    {installedLocalSkills.length}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
              {[
                {
                  icon: Sparkles,
                  title: "站点组技能",
                  description:
                    "先按站点组进入，再选择具体技能项，不再把技术配置直接暴露给用户。",
                },
                {
                  icon: Globe,
                  title: "浏览器协助",
                  description:
                    "需要站点登录态时，直接从技能项进入真实浏览器执行。",
                },
                {
                  icon: Workflow,
                  title: "任务持续化",
                  description:
                    "计划任务与持续跟踪技能会把首轮结果回流到当前工作区。",
                },
                {
                  icon: Boxes,
                  title: "我的补充",
                  description:
                    "本地和项目级技能仍然可用，但不再作为默认主入口承载。",
                },
              ].map((item) => {
                const Icon = item.icon;

                return (
                  <div
                    key={item.title}
                    className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700">
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-500">
                        能力层
                      </span>
                    </div>
                    <div className="mt-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">
                          {item.title}
                        </h3>
                        <WorkbenchInfoTip
                          ariaLabel={`${item.title}说明`}
                          content={item.description}
                          tone="slate"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {(serviceSkillsError || localSkillsError) && (
            <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
              {serviceSkillsError ? `云目录加载失败：${serviceSkillsError}` : null}
              {serviceSkillsError && localSkillsError ? "；" : null}
              {localSkillsError ? `本地技能加载失败：${localSkillsError}` : null}
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <TabsList className="h-auto rounded-2xl bg-slate-100 p-1">
                  <TabsTrigger value="market" className="rounded-2xl px-4 py-2">
                    技能广场 {skillGroups.length > 0 ? skillGroups.length : ""}
                  </TabsTrigger>
                  <TabsTrigger value="installed" className="rounded-2xl px-4 py-2">
                    我的技能 {recentServiceSkills.length + installedLocalSkills.length}
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="text-xs leading-5 text-slate-500">
                {serviceSkillsLoading || localSkillsLoading || localSkillsRemoteLoading
                  ? "正在同步当前目录..."
                  : selectedGroup
                    ? `当前正在浏览 ${selectedGroup.title} 技能组。`
                    : "首页先展示能直接启动的技能；本地仓库与导入能力收纳在导入与维护。"}
              </div>
            </div>

            <TabsContent value="market" className="mt-0">
              {selectedGroup ? (
                <div className="space-y-4">
                  <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-3">
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
                          技能组 · {selectedGroup.title}
                        </span>
                        <div>
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
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl border-slate-200"
                        onClick={() => setSelectedGroupKey(null)}
                      >
                        返回技能组
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
                        可以调整搜索词，或先返回技能组切换到其他站点组。
                      </p>
                    </div>
                  )}
                </div>
              ) : visibleGroups.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {visibleGroups.map((group) => {
                    const groupSkills = skillGroupMap.get(group.key) ?? [];

                    return (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => setSelectedGroupKey(group.key)}
                        className="flex h-full flex-col rounded-[28px] border border-slate-200/80 bg-white p-5 text-left shadow-sm shadow-slate-950/5 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
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
                          <span className="inline-flex items-center text-sm font-medium text-slate-900">
                            打开技能组
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
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
            </TabsContent>

            <TabsContent value="installed" className="mt-0 space-y-4">
              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">
                        最近使用
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="最近使用技能说明"
                        content="最近执行过的技能会沉淀在这里，方便再次启动。"
                        tone="slate"
                      />
                    </div>
                  </div>
                </div>

                {visibleRecentSkills.length > 0 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibleRecentSkills.map((skill) => (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => handleServiceSkillSelect(skill)}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
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
                    当前还没有最近使用记录。先从“技能广场”启动一个技能，后续会自动收敛到这里。
                  </div>
                )}
              </section>

              <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">
                        本地已安装技能
                      </h2>
                      <WorkbenchInfoTip
                        ariaLabel="本地已安装技能区说明"
                        content="项目级、本地补充和内置技能仍然可用，但高阶仓库、导入和标准检查收纳在高级管理中。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-2xl border-slate-200"
                    onClick={() => setAdvancedManagerOpen(true)}
                  >
                    打开高级管理
                  </Button>
                </div>

                {visibleInstalledLocalSkills.length > 0 ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibleInstalledLocalSkills.map((skill) => (
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
                    当前没有本地已安装技能。你仍然可以在导入与维护里导入本地技能或查看远程仓库目录。
                  </div>
                )}
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ServiceSkillLaunchDialog
        skill={selectedServiceSkill}
        open={serviceSkillDialogOpen}
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
              <SkillsPage hideHeader />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SkillsWorkspacePage;
