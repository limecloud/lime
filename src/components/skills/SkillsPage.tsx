import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  ChevronDown,
  Cloud,
  FolderOpen,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { useSkills } from "@/hooks/useSkills";
import { SkillCard } from "./SkillCard";
import { RepoManagerPanel } from "./RepoManagerPanel";
import { SkillExecutionDialog } from "./SkillExecutionDialog";
import { SkillContentDialog } from "./SkillContentDialog";
import { SkillScaffoldDialog } from "./SkillScaffoldDialog";
import {
  filterSkillsByQueryAndStatus,
  groupSkillsBySourceKind,
} from "./skillsUtils";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  skillsApi,
  type AppType,
  type CreateSkillScaffoldRequest,
  type LocalSkillInspection,
  type Skill,
} from "@/lib/api/skills";
import type { SkillScaffoldDraft } from "@/types/page";

interface SkillsPageProps {
  initialApp?: AppType;
  hideHeader?: boolean;
  initialScaffoldDraft?: SkillScaffoldDraft | null;
  initialScaffoldRequestKey?: number | null;
  onBringScaffoldToCreation?: (draft: SkillScaffoldDraft) => void;
  onScaffoldCreated?: (skill: Skill) => void;
}

export interface SkillsPageRef {
  refresh: () => void;
  openRepoManager: () => void;
}

const actionButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-50";

const secondaryActionButtonClassName = `${actionButtonClassName} border border-slate-200 bg-white/85 text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white`;
const primaryActionButtonClassName = `${actionButtonClassName} border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] text-white shadow-sm shadow-emerald-950/15 hover:opacity-95`;

const sectionStyleMap = {
  builtin: {
    icon: Package,
    displayTitle: "内置技能",
    summaryClassName:
      "bg-[linear-gradient(135deg,rgba(255,247,237,0.9),rgba(255,255,255,0.98))]",
    iconClassName: "border-orange-200 bg-orange-100/80 text-orange-700",
    countClassName: "bg-orange-100 text-orange-700",
    hint: "随应用提供，默认可用",
  },
  local: {
    icon: FolderOpen,
    displayTitle: "本地技能",
    summaryClassName:
      "bg-[linear-gradient(135deg,rgba(241,245,249,0.92),rgba(255,255,255,0.98))]",
    iconClassName: "border-slate-200 bg-slate-100/90 text-slate-700",
    countClassName: "bg-slate-100 text-slate-700",
    hint: "项目与本地技能可直接查看",
  },
  remote: {
    icon: Cloud,
    displayTitle: "远程技能",
    summaryClassName:
      "bg-[linear-gradient(135deg,rgba(236,253,245,0.9),rgba(255,255,255,0.98))]",
    iconClassName: "border-emerald-200 bg-emerald-100/80 text-emerald-700",
    countClassName: "bg-emerald-100 text-emerald-700",
    hint: "缓存展示，支持安装前预检",
  },
} as const;

export const SkillsPage = forwardRef<SkillsPageRef, SkillsPageProps>(
  (
    {
      initialApp = "lime",
      hideHeader = false,
      initialScaffoldDraft = null,
      initialScaffoldRequestKey = null,
      onBringScaffoldToCreation,
      onScaffoldCreated,
    },
    ref,
  ) => {
    const [app] = useState<AppType>(initialApp);
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<
      "all" | "installed" | "uninstalled"
    >("all");
    const [repoManagerOpen, setRepoManagerOpen] = useState(false);
    const [installingSkills, setInstallingSkills] = useState<Set<string>>(
      new Set(),
    );
    // 执行对话框状态
    const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
    const [selectedSkillForExecution, setSelectedSkillForExecution] =
      useState<Skill | null>(null);
    // 内容查看对话框状态
    const [contentDialogOpen, setContentDialogOpen] = useState(false);
    const [selectedSkillForContent, setSelectedSkillForContent] =
      useState<Skill | null>(null);
    const [skillInspection, setSkillInspection] =
      useState<LocalSkillInspection | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);
    const contentRequestIdRef = useRef(0);
    const [scaffoldDialogOpen, setScaffoldDialogOpen] = useState(false);
    const [scaffoldDialogDraft, setScaffoldDialogDraft] =
      useState<SkillScaffoldDraft | null>(null);
    const [scaffoldCreating, setScaffoldCreating] = useState(false);
    const [importingLocalSkill, setImportingLocalSkill] = useState(false);
    const lastHandledScaffoldRequestKeyRef = useRef<number | null>(null);

    const {
      skills,
      repos,
      loading,
      remoteLoading,
      error,
      refresh,
      install,
      uninstall,
      addRepo,
      removeRepo,
    } = useSkills(app);

    useImperativeHandle(ref, () => ({
      refresh,
      openRepoManager: () => setRepoManagerOpen(true),
    }));

    useEffect(() => {
      if (
        !initialScaffoldDraft ||
        initialScaffoldRequestKey === null ||
        lastHandledScaffoldRequestKeyRef.current === initialScaffoldRequestKey
      ) {
        return;
      }

      lastHandledScaffoldRequestKeyRef.current = initialScaffoldRequestKey;
      setScaffoldDialogDraft(initialScaffoldDraft);
      setScaffoldDialogOpen(true);
    }, [initialScaffoldDraft, initialScaffoldRequestKey]);

    const handleInstall = async (directory: string) => {
      setInstallingSkills((prev) => new Set(prev).add(directory));
      try {
        await install(directory);
      } catch (e) {
        alert(`安装失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setInstallingSkills((prev) => {
          const next = new Set(prev);
          next.delete(directory);
          return next;
        });
      }
    };

    const handleUninstall = async (directory: string) => {
      setInstallingSkills((prev) => new Set(prev).add(directory));
      try {
        await uninstall(directory);
      } catch (e) {
        alert(`卸载失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setInstallingSkills((prev) => {
          const next = new Set(prev);
          next.delete(directory);
          return next;
        });
      }
    };

    const handleCreateScaffold = async (
      request: CreateSkillScaffoldRequest,
    ) => {
      setScaffoldCreating(true);
      try {
        const inspection = await skillsApi.createSkillScaffold(request, app);
        const createdSkill: Skill = {
          key: `local:${request.directory}`,
          name: request.name,
          description: request.description,
          directory: request.directory,
          installed: true,
          sourceKind: "other",
          catalogSource: request.target,
          license: inspection.license,
          metadata: inspection.metadata,
          allowedTools: inspection.allowedTools,
          resourceSummary: inspection.resourceSummary,
          standardCompliance: inspection.standardCompliance,
        };
        try {
          await refresh();
        } catch (refreshError) {
          console.error("刷新 Skills 列表失败:", refreshError);
        }
        onScaffoldCreated?.(createdSkill);

        contentRequestIdRef.current += 1;
        setSelectedSkillForContent(createdSkill);
        setSkillInspection(inspection);
        setContentError(null);
        setContentLoading(false);
        setContentDialogOpen(true);
      } finally {
        setScaffoldCreating(false);
      }
    };

    const handleImportLocalSkill = async () => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择一个包含 SKILL.md 的技能目录",
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setImportingLocalSkill(true);
      try {
        await skillsApi.importLocalSkill(selected, app);
        await refresh();
      } catch (e) {
        alert(`导入失败: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setImportingLocalSkill(false);
      }
    };

    /**
     * 处理执行按钮点击
     * 打开执行对话框并设置选中的 Skill
     *
     * @param skill - 要执行的 Skill
     * @requirements 6.3
     */
    const handleExecute = (skill: Skill) => {
      setSelectedSkillForExecution(skill);
      setExecutionDialogOpen(true);
    };

    /**
     * 处理执行对话框关闭
     */
    const handleExecutionDialogClose = (open: boolean) => {
      setExecutionDialogOpen(open);
      if (!open) {
        setSelectedSkillForExecution(null);
      }
    };

    /**
     * 处理检查详情按钮点击
     * 本地 Skill 直接检查本地包，远程 Skill 执行安装前预检
     */
    const handleViewContent = async (skill: Skill) => {
      const requestId = ++contentRequestIdRef.current;

      setSelectedSkillForContent(skill);
      setContentDialogOpen(true);
      setSkillInspection(null);
      setContentError(null);
      setContentLoading(true);

      try {
        const inspection =
          skill.catalogSource === "remote" &&
          skill.repoOwner &&
          skill.repoName &&
          skill.repoBranch
            ? await skillsApi.inspectRemoteSkill({
                owner: skill.repoOwner,
                name: skill.repoName,
                branch: skill.repoBranch,
                directory: skill.directory,
              })
            : await skillsApi.inspectLocalSkill(skill.directory, app);
        if (requestId !== contentRequestIdRef.current) {
          return;
        }
        setSkillInspection(inspection);
      } catch (e) {
        if (requestId !== contentRequestIdRef.current) {
          return;
        }
        setContentError(
          `检查失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        if (requestId === contentRequestIdRef.current) {
          setContentLoading(false);
        }
      }
    };

    /**
     * 处理内容查看对话框关闭
     */
    const handleContentDialogClose = (open: boolean) => {
      setContentDialogOpen(open);
      if (!open) {
        contentRequestIdRef.current += 1;
        setSelectedSkillForContent(null);
        setSkillInspection(null);
        setContentError(null);
        setContentLoading(false);
      }
    };

    const filteredSkills = filterSkillsByQueryAndStatus(
      skills,
      searchQuery,
      filterStatus,
    );
    const groupedSkillSections = groupSkillsBySourceKind(filteredSkills);
    const isFiltering = searchQuery.trim().length > 0 || filterStatus !== "all";
    const hasVisibleSkills = groupedSkillSections.some(
      (section) => section.skills.length > 0,
    );
    const skillSections = groupedSkillSections.filter(
      (section) =>
        section.skills.length > 0 ||
        loading ||
        remoteLoading ||
        (!isFiltering && section.key === "remote"),
    );

    const installedCount = skills.filter((s) => s.installed).length;
    const uninstalledCount = skills.length - installedCount;
    const visibleCount = filteredSkills.length;
    const stats = [
      {
        label: "总技能",
        value: skills.length,
        hint: "当前工作台可见",
        icon: Package,
        iconClassName: "bg-sky-100 text-sky-700",
      },
      {
        label: "可用技能",
        value: installedCount,
        hint: "已安装、内置、本地",
        icon: CheckCircle2,
        iconClassName: "bg-emerald-100 text-emerald-700",
      },
      {
        label: "待安装",
        value: uninstalledCount,
        hint: "远程候选技能",
        icon: Cloud,
        iconClassName: "bg-sky-100 text-sky-700",
      },
      {
        label: "已启用仓库",
        value: repos.filter((repo) => repo.enabled).length,
        hint: "远程同步来源",
        icon: Settings,
        iconClassName: "bg-amber-100 text-amber-700",
      },
    ] as const;
    const filterOptions = [
      { key: "all", label: "全部", count: skills.length },
      { key: "installed", label: "已安装", count: installedCount },
      { key: "uninstalled", label: "未安装", count: uninstalledCount },
    ] as const;

    return (
      <div className="space-y-8 pb-4">
        <section className="relative overflow-hidden rounded-[28px] border border-emerald-200/70 bg-[linear-gradient(135deg,rgba(243,250,247,0.96)_0%,rgba(248,250,252,0.98)_34%,rgba(255,255,255,0.98)_62%,rgba(241,247,255,0.96)_100%)] shadow-sm shadow-slate-950/5">
          <div className="pointer-events-none absolute -left-16 top-[-72px] h-52 w-52 rounded-full bg-emerald-200/30 blur-3xl" />
          <div className="pointer-events-none absolute right-[-72px] top-[-48px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-88px] left-1/3 h-48 w-48 rounded-full bg-teal-100/24 blur-3xl" />
          <div className="relative flex flex-col gap-6 p-6 lg:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="space-y-2">
                  <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-emerald-700 shadow-sm">
                    SKILLS WORKSPACE
                  </span>
                  {!hideHeader ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-slate-900">
                          在一个工作台里管理内置、本地与远程 Skill
                        </p>
                        <WorkbenchInfoTip
                          ariaLabel="技能工作台说明"
                          content={
                            <div className="space-y-1">
                              <p>
                                统一查看安装状态、仓库来源与可读内容，减少在不同入口之间来回切换。
                              </p>
                              <p>
                                内置 Skill 默认可用；本地 Skill
                                支持直接查看；远程 Skill 通过缓存展示。
                              </p>
                            </div>
                          }
                          tone="mint"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-900">
                        高级技能管理
                      </p>
                      <WorkbenchInfoTip
                        ariaLabel="高级技能管理说明"
                        content="为当前应用编排可用技能、仓库来源与安装状态。"
                        tone="mint"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 lg:justify-end">
                <button
                  onClick={refresh}
                  disabled={loading}
                  className={secondaryActionButtonClassName}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  刷新
                </button>
                <button
                  onClick={() => void handleImportLocalSkill()}
                  disabled={loading || importingLocalSkill}
                  className={secondaryActionButtonClassName}
                >
                  <FolderOpen
                    className={`h-4 w-4 ${importingLocalSkill ? "animate-pulse" : ""}`}
                  />
                  {importingLocalSkill ? "导入中..." : "导入 Skill"}
                </button>
                <button
                  onClick={() => {
                    setScaffoldDialogDraft(null);
                    setScaffoldDialogOpen(true);
                  }}
                  className={primaryActionButtonClassName}
                >
                  <Plus className="h-4 w-4" />
                  新建 Skill
                </button>
                <button
                  onClick={() => setRepoManagerOpen(true)}
                  className={secondaryActionButtonClassName}
                >
                  <Settings className="h-4 w-4" />
                  仓库管理
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => {
                const StatIcon = stat.icon;
                return (
                  <div
                    key={stat.label}
                    className="rounded-[22px] border border-white/90 bg-white/88 p-5 shadow-sm backdrop-blur"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${stat.iconClassName}`}
                      >
                        <StatIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-800 whitespace-nowrap">
                            {stat.label}
                          </p>
                          <WorkbenchInfoTip
                            ariaLabel={`${stat.label}说明`}
                            content={stat.hint}
                            tone="mint"
                          />
                        </div>
                      </div>
                    </div>

                    <p className="mt-5 text-3xl font-semibold tracking-tight text-slate-900">
                      {stat.value}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <WorkbenchInfoTip
                ariaLabel="技能使用规则"
                label="使用规则"
                variant="pill"
                tone="mint"
                content={
                  <ul className="list-disc pl-4">
                    <li>
                      Built-in Skills 为应用内置技能，默认可用且不可卸载。
                    </li>
                    <li>Local Skills 直接从本地目录加载，不依赖远程仓库。</li>
                    <li>
                      Remote Skills 使用缓存展示，点击“刷新”才同步远程仓库。
                    </li>
                  </ul>
                }
              />
              {remoteLoading && (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 shadow-sm">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  正在同步远程仓库缓存
                </span>
              )}
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-[22px] border border-red-200 bg-red-50/90 p-4 text-red-700 shadow-sm">
            {error}
          </div>
        )}

        <section className="rounded-[24px] border border-slate-200/80 bg-white/90 p-4 shadow-sm shadow-slate-950/5 backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <label className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索技能名称、描述或仓库..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/80 pl-11 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {filterOptions.map((option) => {
                const active = filterStatus === option.key;
                return (
                  <button
                    key={option.key}
                    onClick={() =>
                      setFilterStatus(
                        option.key as "all" | "installed" | "uninstalled",
                      )
                    }
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                      active
                        ? "border border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <span>{option.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        active
                          ? "border border-emerald-200 bg-white/90 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {option.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-3 py-1">
              当前显示 {visibleCount} / {skills.length}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1">
              {isFiltering ? "筛选已生效" : "浏览全部技能"}
            </span>
            {searchQuery.trim() && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                关键词: {searchQuery.trim()}
              </span>
            )}
          </div>
        </section>

        {/* Skills 列表 */}
        {!hasVisibleSkills && !loading && isFiltering ? (
          <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-6 py-12 text-center text-slate-500">
            <p className="text-base font-medium text-slate-700">
              没有找到匹配的技能
            </p>
            <p className="mt-2 text-sm">
              可以尝试调整搜索关键词，或切换安装状态筛选。
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {skillSections.map((section) => {
              const isSectionLoading =
                section.key === "remote" ? remoteLoading || loading : loading;
              const sectionStyle = sectionStyleMap[section.key];
              const SectionIcon = sectionStyle.icon;
              return (
                <details
                  key={section.key}
                  open={section.key !== "builtin"}
                  className="group overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/95 shadow-sm shadow-slate-950/5"
                >
                  <summary
                    className={`list-none cursor-pointer px-5 py-5 transition [&::-webkit-details-marker]:hidden ${sectionStyle.summaryClassName}`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${sectionStyle.iconClassName}`}
                        >
                          <SectionIcon className="h-5 w-5" />
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-lg font-semibold tracking-tight text-slate-900">
                              {sectionStyle.displayTitle}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sectionStyle.countClassName}`}
                            >
                              {section.skills.length} 个
                            </span>
                            {isSectionLoading && (
                              <span className="inline-flex items-center gap-2 rounded-full bg-white/80 px-2.5 py-1 text-xs text-slate-600 shadow-sm">
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                同步中
                              </span>
                            )}
                            <WorkbenchInfoTip
                              ariaLabel={`${sectionStyle.displayTitle}说明`}
                              content={
                                <div className="space-y-1">
                                  <p>{section.description}</p>
                                  <p>{sectionStyle.hint}</p>
                                </div>
                              }
                              tone="slate"
                            />
                          </div>
                          <div className="text-[11px] font-semibold tracking-[0.22em] text-slate-400">
                            {section.title}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
                      </div>
                    </div>
                  </summary>
                  <div className="border-t border-slate-200/70 px-5 pb-5 pt-5">
                    {section.skills.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50/80 px-5 py-6 text-sm text-slate-500">
                        {isSectionLoading
                          ? "正在加载..."
                          : section.key === "remote"
                            ? '暂无远程缓存，点击"刷新"同步已启用仓库。'
                            : "暂无技能。"}
                      </div>
                    ) : (
                      <div className="grid auto-rows-fr grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {section.skills.map((skill) => (
                          <SkillCard
                            key={skill.key}
                            skill={skill}
                            onInstall={handleInstall}
                            onUninstall={handleUninstall}
                            onExecute={handleExecute}
                            onViewContent={handleViewContent}
                            installing={installingSkills.has(skill.directory)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}

        {/* 仓库管理面板 */}
        {repoManagerOpen && (
          <RepoManagerPanel
            repos={repos}
            onClose={() => setRepoManagerOpen(false)}
            onAddRepo={addRepo}
            onRemoveRepo={removeRepo}
            onRefresh={refresh}
          />
        )}

        <SkillScaffoldDialog
          open={scaffoldDialogOpen}
          onOpenChange={(open) => {
            setScaffoldDialogOpen(open);
            if (!open) {
              setScaffoldDialogDraft(null);
            }
          }}
          onCreate={handleCreateScaffold}
          creating={scaffoldCreating}
          allowProjectTarget={app === "lime"}
          initialValues={scaffoldDialogDraft}
          sourceHint={scaffoldDialogDraft?.sourceExcerpt ?? null}
          onBringBackToCreation={onBringScaffoldToCreation}
        />

        {/* Skill 执行对话框 */}
        {selectedSkillForExecution && (
          <SkillExecutionDialog
            skillName={selectedSkillForExecution.name}
            open={executionDialogOpen}
            onOpenChange={handleExecutionDialogClose}
          />
        )}

        {/* Skill 内容查看对话框 */}
        {selectedSkillForContent && (
          <SkillContentDialog
            skillName={selectedSkillForContent.name}
            skillDescription={selectedSkillForContent.description}
            open={contentDialogOpen}
            onOpenChange={handleContentDialogClose}
            inspection={skillInspection}
            loading={contentLoading}
            error={contentError}
          />
        )}
      </div>
    );
  },
);

SkillsPage.displayName = "SkillsPage";
