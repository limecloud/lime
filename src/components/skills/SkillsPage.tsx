import {
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
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
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { SkillCard } from "./SkillCard";
import { RepoManagerPanel } from "./RepoManagerPanel";
import { SkillExecutionDialog } from "./SkillExecutionDialog";
import { SkillContentDialog } from "./SkillContentDialog";
import { SkillScaffoldDialog } from "./SkillScaffoldDialog";
import {
  filterSkillsByQueryAndStatus,
  groupSkillsBySourceKind,
} from "./skillsUtils";
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
    displayTitle: "内置",
    iconClassName: "bg-orange-50 text-orange-600 border border-orange-200",
  },
  local: {
    icon: FolderOpen,
    displayTitle: "本地",
    iconClassName: "bg-slate-50 text-slate-600 border border-slate-200",
  },
  remote: {
    icon: Cloud,
    displayTitle: "远程",
    iconClassName: "bg-emerald-50 text-emerald-600 border border-emerald-200",
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
    const filterOptions = [
      { key: "all", label: "全部", count: skills.length },
      { key: "installed", label: "已安装", count: installedCount },
      { key: "uninstalled", label: "未安装", count: uninstalledCount },
    ] as const;

    return (
      <div className="space-y-6 pb-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {!hideHeader && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-semibold text-slate-900">
                    Skills
                  </h1>
                  <WorkbenchInfoTip
                    ariaLabel="技能工作台说明"
                    tone="sky"
                    content={
                      <span>
                        统一查看安装状态、仓库来源与可读内容，减少在不同入口之间来回切换。
                      </span>
                    }
                  />
                  <WorkbenchInfoTip
                    ariaLabel="技能使用规则"
                    tone="mint"
                    content={
                      <span>
                        Built-in Skills
                        为应用内置技能，默认可用且不可卸载。本地与远程技能可按来源安装、检查或导入。
                      </span>
                    }
                  />
                </div>
                <p className="text-sm text-slate-600">
                  管理和使用 AI 技能扩展
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => void refresh()}
                disabled={loading || remoteLoading}
                className={secondaryActionButtonClassName}
              >
                <RefreshCw
                  className={`h-4 w-4 ${
                    loading || remoteLoading ? "animate-spin" : ""
                  }`}
                />
                刷新
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
                onClick={() => setRepoManagerOpen(true)}
                className={secondaryActionButtonClassName}
              >
                <Settings className="h-4 w-4" />
                仓库
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-[22px] border border-red-200 bg-red-50/90 p-4 text-red-700 shadow-sm">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="搜索 Skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              />
            </label>

            <div className="flex gap-2">
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
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span>{option.label}</span>
                    <span
                      className={`text-xs ${
                        active ? "text-emerald-600" : "text-slate-500"
                      }`}
                    >
                      {option.count}
                    </span>
                  </button>
                );
              })}
            </div>
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
          <div className="space-y-4">
            {skillSections.map((section) => {
              const isSectionLoading =
                section.key === "remote" ? remoteLoading || loading : loading;
              const sectionStyle = sectionStyleMap[section.key];
              const SectionIcon = sectionStyle.icon;
              return (
                <details
                  key={section.key}
                  open={section.key !== "builtin"}
                  className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <summary
                    className="list-none cursor-pointer px-4 py-3 hover:bg-slate-50 transition [&::-webkit-details-marker]:hidden"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${sectionStyle.iconClassName}`}
                        >
                          <SectionIcon className="h-4 w-4" />
                        </div>
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {section.title}
                            </span>
                            <span className="text-xs text-slate-500">
                              {section.skills.length}
                            </span>
                            {isSectionLoading && (
                              <RefreshCw className="h-3.5 w-3.5 animate-spin text-slate-400" />
                            )}
                          </div>
                          <p className="text-xs text-slate-500">
                            {section.description}
                          </p>
                          <span className="sr-only">
                            {sectionStyle.displayTitle}
                          </span>
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-slate-400 transition-transform duration-200 group-open:rotate-180" />
                    </div>
                  </summary>
                  <div className="border-t border-slate-100 px-4 pb-4 pt-4">
                    {section.skills.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        {isSectionLoading
                          ? "正在加载..."
                          : section.key === "remote"
                            ? '暂无远程缓存，点击"刷新"同步已启用仓库。'
                            : "暂无 Skills"}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
