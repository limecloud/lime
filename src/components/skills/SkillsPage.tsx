import { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { RefreshCw, Search, Settings } from "lucide-react";
import { useSkills } from "@/hooks/useSkills";
import { SkillCard } from "./SkillCard";
import { RepoManagerPanel } from "./RepoManagerPanel";
import { SkillExecutionDialog } from "./SkillExecutionDialog";
import { SkillContentDialog } from "./SkillContentDialog";
import {
  filterSkillsByQueryAndStatus,
  groupSkillsBySourceKind,
} from "./skillsUtils";
import { HelpTip } from "@/components/HelpTip";
import { skillsApi, type AppType, type Skill } from "@/lib/api/skills";

interface SkillsPageProps {
  initialApp?: AppType;
  hideHeader?: boolean;
}

export interface SkillsPageRef {
  refresh: () => void;
  openRepoManager: () => void;
}

export const SkillsPage = forwardRef<SkillsPageRef, SkillsPageProps>(
  ({ initialApp = "proxycast", hideHeader = false }, ref) => {
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
    const [skillContent, setSkillContent] = useState("");
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);
    const contentRequestIdRef = useRef(0);

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
     * 处理查看内容按钮点击
     * 读取本地 SKILL.md 并打开预览弹窗
     */
    const handleViewContent = async (skill: Skill) => {
      const requestId = ++contentRequestIdRef.current;

      setSelectedSkillForContent(skill);
      setContentDialogOpen(true);
      setSkillContent("");
      setContentError(null);
      setContentLoading(true);

      try {
        const content = await skillsApi.getLocalSkillContent(
          skill.directory,
          app,
        );
        if (requestId !== contentRequestIdRef.current) {
          return;
        }
        setSkillContent(content);
      } catch (e) {
        if (requestId !== contentRequestIdRef.current) {
          return;
        }
        setContentError(
          `读取失败: ${e instanceof Error ? e.message : String(e)}`,
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
        setSkillContent("");
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

    return (
      <div className="space-y-6">
        {!hideHeader && (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">技能</h2>
              <p className="text-muted-foreground">
                管理技能可用性和 API 能力注入。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={refresh}
                disabled={loading}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                刷新
              </button>
              <button
                onClick={() => setRepoManagerOpen(true)}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
              >
                <Settings className="h-4 w-4" />
                仓库管理
              </button>
            </div>
          </div>
        )}

        {hideHeader && (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              刷新
            </button>
            <button
              onClick={() => setRepoManagerOpen(true)}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings className="h-4 w-4" />
              仓库管理
            </button>
          </div>
        )}

        <HelpTip title="什么是 Skills？" variant="green">
          <ul className="list-disc list-inside space-y-1 text-sm text-green-700 dark:text-green-400">
            <li>Built-in Skills 为应用内置技能，默认可用且不可卸载</li>
            <li>Local Skills 直接从本地目录加载，不依赖远程仓库</li>
            <li>Remote Skills 使用缓存展示，点击"刷新"才同步远程仓库</li>
          </ul>
        </HelpTip>

        {error && (
          <div className="rounded-lg border border-red-500 bg-red-50 p-4 text-red-700 dark:bg-red-950/30">
            {error}
          </div>
        )}

        {/* 搜索和过滤 */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="搜索技能..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border bg-background pl-10 pr-4 py-2 text-sm"
            />
          </div>
        </div>

        {/* 过滤标签 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilterStatus("all")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filterStatus === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            全部 ({skills.length})
          </button>
          <button
            onClick={() => setFilterStatus("installed")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filterStatus === "installed"
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            已安装 ({installedCount})
          </button>
          <button
            onClick={() => setFilterStatus("uninstalled")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filterStatus === "uninstalled"
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            未安装 ({uninstalledCount})
          </button>
        </div>

        {/* Skills 列表 */}
        {!hasVisibleSkills && !loading && isFiltering ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p>没有找到匹配的技能</p>
          </div>
        ) : (
          <div className="space-y-4">
            {skillSections.map((section) => {
              const isSectionLoading =
                section.key === "remote" ? remoteLoading || loading : loading;
              return (
                <details
                  key={section.key}
                  open={section.key !== "builtin"}
                  className="group rounded-lg border"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold tracking-[0.24em] text-muted-foreground">
                        {section.title}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {section.skills.length}
                      </span>
                      {isSectionLoading && (
                        <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground transition-transform group-open:rotate-90">
                      ▶
                    </span>
                  </summary>
                  <div className="px-4 pb-4">
                    <p className="mb-3 text-sm text-muted-foreground">
                      {section.description}
                    </p>
                    {section.skills.length === 0 ? (
                      <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                        {isSectionLoading
                          ? "正在加载..."
                          : section.key === "remote"
                            ? '暂无远程缓存，点击"刷新"同步已启用仓库。'
                            : "暂无技能。"}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
            open={contentDialogOpen}
            onOpenChange={handleContentDialogClose}
            content={skillContent}
            loading={contentLoading}
            error={contentError}
          />
        )}
      </div>
    );
  },
);

SkillsPage.displayName = "SkillsPage";
