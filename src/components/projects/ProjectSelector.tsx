/**
 * @file ProjectSelector.tsx
 * @description 项目选择器组件，用于在聊天入口和侧边栏选择项目
 * @module components/projects/ProjectSelector
 * @requirements 4.1, 4.2, 4.3, 4.5
 */

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  FolderIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useProjects } from "@/hooks/useProjects";
import type { ProjectType } from "@/lib/api/project";
import {
  getDefaultProject,
  getProject,
  USER_PROJECT_TYPES,
} from "@/lib/api/project";
import { toProjectView } from "@/lib/projectView";
import type { Project } from "@/types/project";
import { WorkspaceTypeLabels } from "@/types/workspace";
import { cn } from "@/lib/utils";
import { CreateProjectDialog } from "./CreateProjectDialog";
import {
  canDeleteProject,
  canRenameProject,
  getAvailableProjects,
  resolveProjectDeletionFallback,
  resolveSelectedProject,
} from "./projectSelectorUtils";

export interface ProjectSelectorProps {
  /** 当前选中的项目 ID */
  value: string | null;
  /** 选择变化回调 */
  onChange: (projectId: string) => void;
  /** 受控展开状态 */
  open?: boolean;
  /** 展开状态变化回调 */
  onOpenChange?: (open: boolean) => void;
  /** 是否仅作被动展示，不响应点击 */
  passiveTrigger?: boolean;
  /** 按主题类型筛选（可选，不传则显示所有项目） */
  workspaceType?: string;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 下拉方向 */
  dropdownSide?: "top" | "bottom";
  /** 下拉对齐 */
  dropdownAlign?: "start" | "end";
  /** 是否启用项目管理 */
  enableManagement?: boolean;
  /** 显示密度 */
  density?: "default" | "compact";
  /** 外观表面 */
  chrome?: "default" | "embedded" | "workspace-tab";
  /** 是否跳过默认项目目录健康检查 */
  skipDefaultWorkspaceReadyCheck?: boolean;
  /** 是否延后完整项目列表加载到展开时 */
  deferProjectListLoad?: boolean;
}

function isProjectSelectableForWorkspace(
  project: Project | null | undefined,
  workspaceType?: string,
): project is Project {
  if (!project || project.isArchived) {
    return false;
  }

  if (!workspaceType) {
    return true;
  }

  return project.isDefault || project.workspaceType === workspaceType;
}

function resolveDefaultProjectType(workspaceType?: string): ProjectType {
  if (
    workspaceType &&
    USER_PROJECT_TYPES.includes(
      workspaceType as (typeof USER_PROJECT_TYPES)[number],
    )
  ) {
    return workspaceType as ProjectType;
  }

  return "general";
}

function formatProjectPathPreview(rootPath?: string): string {
  if (!rootPath) {
    return "未设置目录";
  }

  const segments = rootPath.split(/[\\/]+/).filter(Boolean);
  if (segments.length <= 1) {
    return rootPath;
  }

  if (segments.length === 2) {
    return segments.join("/");
  }

  return `…/${segments.slice(-2).join("/")}`;
}

function getProjectMetaText(project: Project | null | undefined): string {
  if (!project) {
    return "待选择项目";
  }

  const meta = [WorkspaceTypeLabels[project.workspaceType]];
  if (project.isDefault) {
    meta.unshift("默认项目");
  }

  return meta.join(" · ");
}

function getProjectSummaryText(
  project: Project | null | undefined,
): string | null {
  if (!project) {
    return null;
  }

  return `${project.name} · ${getProjectMetaText(project)} · ${formatProjectPathPreview(project.rootPath)}`;
}

/**
 * 项目选择器组件
 *
 * 通用对话默认会启用搜索和轻量项目管理。
 */
export function ProjectSelector({
  value,
  onChange,
  open: openProp,
  onOpenChange,
  passiveTrigger = false,
  workspaceType,
  placeholder = "选择项目",
  disabled = false,
  className,
  dropdownSide = "top",
  dropdownAlign = "start",
  enableManagement = false,
  density = "default",
  chrome = "default",
  skipDefaultWorkspaceReadyCheck = false,
  deferProjectListLoad = false,
}: ProjectSelectorProps) {
  const {
    projects,
    generalProjects,
    defaultProject,
    loading,
    refresh,
    create,
    rename,
    remove,
    getOrCreateDefault,
  } = useProjects({
    skipDefaultWorkspaceReadyCheck,
    autoLoad: !deferProjectListLoad,
  });
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [summaryProject, setSummaryProject] = useState<Project | null>(null);
  const [projectListHydrating, setProjectListHydrating] = useState(false);
  const [hasLoadedProjectList, setHasLoadedProjectList] =
    useState(!deferProjectListLoad);
  const compact = density === "compact";
  const embedded = chrome === "embedded";
  const workspaceTab = chrome === "workspace-tab";
  const compactLikeTrigger = compact || embedded || workspaceTab;
  const compactPanel = compact || workspaceTab;
  const open = openProp ?? internalOpen;
  const entityLabel = workspaceTab ? "工作区" : "项目";
  const createEntityLabel = workspaceTab ? "新建工作区" : "新建项目";
  const managementTitle = workspaceTab ? "工作区管理" : "项目管理";
  const managementDescription = workspaceTab
    ? "当前只管理可见工作区，不影响本地目录与已有文件。"
    : "当前只管理可见项目，不影响本地目录与已有文件。";

  const projectSource =
    workspaceType === "general" ? generalProjects : projects;

  const availableProjects = useMemo(
    () => getAvailableProjects(projectSource, workspaceType),
    [projectSource, workspaceType],
  );

  const selectedProject = useMemo(() => {
    if (!deferProjectListLoad || hasLoadedProjectList) {
      return resolveSelectedProject(availableProjects, value, defaultProject);
    }

    return summaryProject;
  }, [
    availableProjects,
    defaultProject,
    deferProjectListLoad,
    hasLoadedProjectList,
    summaryProject,
    value,
  ]);

  const renameTarget = useMemo(
    () =>
      renameTargetId
        ? availableProjects.find((project) => project.id === renameTargetId) ||
          null
        : null,
    [availableProjects, renameTargetId],
  );

  const deleteTarget = useMemo(
    () =>
      deleteTargetId
        ? availableProjects.find((project) => project.id === deleteTargetId) ||
          null
        : null,
    [availableProjects, deleteTargetId],
  );

  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return availableProjects;
    }

    return availableProjects.filter(
      (project) =>
        project.name.toLowerCase().includes(normalizedQuery) ||
        project.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
    );
  }, [availableProjects, searchQuery]);

  const defaultProjectType = useMemo(
    () => resolveDefaultProjectType(workspaceType),
    [workspaceType],
  );

  useEffect(() => {
    if (open) {
      return;
    }

    setSearchQuery("");
  }, [open]);

  useEffect(() => {
    if (!deferProjectListLoad) {
      setHasLoadedProjectList(true);
      setSummaryProject(null);
      setProjectListHydrating(false);
      return;
    }

    let cancelled = false;

    const loadProjectSummary = async () => {
      try {
        const selectedProjectSummaryRaw = value
          ? await getProject(value)
          : null;
        const selectedProjectSummary = selectedProjectSummaryRaw
          ? toProjectView(selectedProjectSummaryRaw)
          : null;
        const resolvedSelectedProject = isProjectSelectableForWorkspace(
          selectedProjectSummary,
          workspaceType,
        )
          ? selectedProjectSummary
          : null;
        const fallbackDefaultProjectRaw = !resolvedSelectedProject
          ? await getDefaultProject()
          : null;
        const fallbackDefaultProject = fallbackDefaultProjectRaw
          ? toProjectView(fallbackDefaultProjectRaw)
          : null;
        const resolvedProject = resolvedSelectedProject
          ? resolvedSelectedProject
          : isProjectSelectableForWorkspace(
                fallbackDefaultProject,
                workspaceType,
              )
            ? fallbackDefaultProject
            : null;

        if (cancelled) {
          return;
        }

        setSummaryProject(resolvedProject);
        if (!value && resolvedProject?.id) {
          onChange(resolvedProject.id);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("加载项目摘要失败:", error);
        setSummaryProject(null);
      }
    };

    void loadProjectSummary();

    return () => {
      cancelled = true;
    };
  }, [deferProjectListLoad, onChange, value, workspaceType]);

  useEffect(() => {
    if (deferProjectListLoad && !hasLoadedProjectList) {
      return;
    }

    if (loading) {
      return;
    }

    if (value && availableProjects.some((project) => project.id === value)) {
      return;
    }

    let cancelled = false;

    const ensureSelection = async () => {
      const fallbackProjectId = resolveProjectDeletionFallback(
        availableProjects,
        defaultProject,
        null,
      );

      if (fallbackProjectId) {
        if (!cancelled && fallbackProjectId !== value) {
          onChange(fallbackProjectId);
        }
        return;
      }

      try {
        const createdDefault = await getOrCreateDefault();
        if (!cancelled && createdDefault.id && createdDefault.id !== value) {
          onChange(createdDefault.id);
        }
      } catch (error) {
        console.error("创建默认项目失败:", error);
      }
    };

    void ensureSelection();

    return () => {
      cancelled = true;
    };
  }, [
    availableProjects,
    defaultProject,
    deferProjectListLoad,
    getOrCreateDefault,
    hasLoadedProjectList,
    loading,
    onChange,
    value,
  ]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (openProp === undefined) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);

    if (!nextOpen || !deferProjectListLoad || hasLoadedProjectList || loading) {
      return;
    }

    setProjectListHydrating(true);
    void refresh()
      .then(() => {
        setHasLoadedProjectList(true);
      })
      .finally(() => {
        setProjectListHydrating(false);
      });
  };

  const handleSelect = (projectId: string) => {
    if (projectId !== value) {
      onChange(projectId);
    }
    handleOpenChange(false);
  };

  const handleCreateProject = async (name: string, type: ProjectType) => {
    const project = await create({
      name,
      workspaceType: type,
    });
    onChange(project.id);
    handleOpenChange(false);
    toast.success(`${entityLabel}已创建`);
  };

  const handleOpenRename = () => {
    const currentSelectedProject = selectedProject;
    if (!currentSelectedProject || !canRenameProject(currentSelectedProject)) {
      return;
    }

    setRenameTargetId(currentSelectedProject.id);
    setRenameName(currentSelectedProject.name);
    handleOpenChange(false);
    setRenameDialogOpen(true);
  };

  const handleConfirmRename = async () => {
    if (!renameTarget || !canRenameProject(renameTarget)) {
      return;
    }

    const nextName = renameName.trim();
    if (!nextName) {
      toast.error(`${entityLabel}名称不能为空`);
      return;
    }

    setIsRenaming(true);
    try {
      await rename(renameTarget.id, nextName);
      setRenameDialogOpen(false);
      setRenameTargetId(null);
      toast.success(`${entityLabel}名称已更新`);
    } catch (error) {
      toast.error(
        `重命名失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsRenaming(false);
    }
  };

  const handleOpenDelete = () => {
    const currentSelectedProject = selectedProject;
    if (!currentSelectedProject || !canDeleteProject(currentSelectedProject)) {
      return;
    }

    setDeleteTargetId(currentSelectedProject.id);
    handleOpenChange(false);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canDeleteProject(deleteTarget)) {
      return;
    }

    setIsDeleting(true);
    try {
      const deletedProjectId = deleteTarget.id;
      await remove(deletedProjectId);

      if (value === deletedProjectId) {
        const fallbackProjectId =
          resolveProjectDeletionFallback(
            availableProjects,
            defaultProject,
            deletedProjectId,
          ) || (await getOrCreateDefault()).id;

        if (fallbackProjectId) {
          onChange(fallbackProjectId);
        }
      }

      setDeleteDialogOpen(false);
      setDeleteTargetId(null);
      toast.success(`${entityLabel}已删除，本地目录未删除`);
    } catch (error) {
      toast.error(
        `删除失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const managementHint =
    selectedProject && !canRenameProject(selectedProject)
      ? `默认${entityLabel}不可重命名或删除`
      : null;
  const projectSummaryText = getProjectSummaryText(selectedProject);
  const popoverWidthClass = compactPanel ? "w-[392px]" : "w-[420px]";
  const headerPaddingClass = compactPanel ? "px-4 py-3" : "px-4 py-4";
  const bodyPaddingClass = compactPanel ? "px-4 py-3" : "px-4 py-4";
  const managementPaddingClass = compactPanel ? "px-4 py-3" : "px-4 py-4";
  const displayLoading = loading || projectListHydrating;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              workspaceTab
                ? "h-7 min-w-[128px] max-w-[196px] justify-start gap-2 rounded-none border-transparent bg-transparent px-0.5 py-0 text-left shadow-none transition-colors hover:bg-transparent focus-visible:ring-0 dark:hover:bg-transparent"
                : embedded
                  ? "h-10 min-w-[180px] max-w-[280px] justify-between gap-2 rounded-full border-transparent bg-transparent px-1.5 py-0 text-left shadow-none hover:bg-slate-50/80 focus-visible:ring-1 focus-visible:ring-slate-300 focus-visible:ring-offset-0"
                  : compact
                    ? "h-10 min-w-[180px] max-w-[280px] justify-between gap-2 rounded-full border-slate-200/80 bg-white/94 px-2.5 py-0 text-left shadow-sm shadow-slate-950/5 transition-[border-color,box-shadow,background-color] hover:border-slate-300/80 hover:bg-white"
                    : "h-11 min-w-[220px] max-w-[320px] justify-between gap-3 rounded-2xl border-slate-200/80 bg-white/92 px-3 py-0 text-left shadow-sm shadow-slate-950/5 transition-[border-color,box-shadow,background-color] hover:border-slate-300/80 hover:bg-white hover:shadow-md hover:shadow-slate-950/8",
              className,
              passiveTrigger &&
                "pointer-events-none cursor-default select-none focus-visible:ring-0",
            )}
            disabled={disabled || displayLoading}
            tabIndex={passiveTrigger ? -1 : undefined}
            title={
              selectedProject
                ? `${selectedProject.name}\n${selectedProject.rootPath}`
                : placeholder
            }
          >
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center",
                compactLikeTrigger ? "gap-2.5" : "gap-3",
              )}
            >
              {workspaceTab ? (
                <>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[color:var(--lime-chrome-text)] dark:text-slate-100">
                    <FolderIcon className="h-4 w-4 shrink-0" />
                  </span>
                  <span className="min-w-0 flex flex-1 items-center gap-1.5">
                    <span className="truncate text-[12px] font-semibold leading-none text-[color:var(--lime-chrome-text)] dark:text-slate-100">
                      {selectedProject?.name || placeholder}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center text-slate-600",
                      "rounded-[14px] border border-slate-200/80 bg-slate-50",
                    )}
                  >
                    {selectedProject?.icon ? (
                      <span
                        className={compactLikeTrigger ? "text-sm" : "text-base"}
                      >
                        {selectedProject.icon}
                      </span>
                    ) : (
                      <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </span>
                  {compactLikeTrigger ? (
                    <span className="min-w-0 flex flex-1 items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {selectedProject?.name || placeholder}
                      </span>
                      {selectedProject?.isDefault ? (
                        <span className="shrink-0 rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-medium leading-none text-amber-700">
                          默认
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900">
                          {selectedProject?.name || placeholder}
                        </span>
                        {selectedProject?.isDefault ? (
                          <span className="shrink-0 rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[10px] font-medium leading-none text-amber-700">
                            默认
                          </span>
                        ) : null}
                      </span>
                    </span>
                  )}
                </>
              )}
            </span>
            {!workspaceTab ? (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100/90 text-slate-500">
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side={dropdownSide}
          align={dropdownAlign}
          className={cn(
            popoverWidthClass,
            "overflow-hidden rounded-[28px] border border-[color:var(--lime-surface-border)] bg-[image:var(--lime-home-card-surface-strong)] p-0 shadow-lg shadow-slate-950/10",
          )}
        >
          <div className="flex flex-col">
            <div
              className={cn(
                "relative border-b border-white/80",
                headerPaddingClass,
              )}
            >
              <div className="pointer-events-none absolute -left-10 top-[-24px] h-24 w-24 rounded-full bg-[color:var(--lime-home-glow-secondary)] blur-3xl" />
              <div className="pointer-events-none absolute right-[-20px] top-0 h-20 w-20 rounded-full bg-[color:var(--lime-home-glow-primary)] blur-3xl" />
              <div
                className={cn(
                  "relative",
                  compact ? "space-y-2.5" : "space-y-3",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      选择{entityLabel}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">
                      在这里切换{entityLabel}、搜索{entityLabel}，并管理当前可见
                      {entityLabel}列表。
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="border-slate-200/80 bg-white/85 text-slate-600"
                  >
                    {filteredProjects.length} 个{entityLabel}
                  </Badge>
                </div>

                {!compactPanel && projectSummaryText ? (
                  <div className="rounded-[18px] border border-white/90 bg-white/85 px-3 py-2 text-[11px] leading-5 text-slate-600 shadow-sm">
                    <span className="font-medium text-slate-800">
                      当前{entityLabel}：
                    </span>
                    <span>{projectSummaryText}</span>
                  </div>
                ) : null}

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={`搜索${entityLabel}`}
                    className={cn(
                      compactPanel ? "h-9" : "h-10",
                      "border-slate-200/80 bg-white/85 pl-9 focus-visible:border-slate-300 focus-visible:ring-1 focus-visible:ring-slate-300 focus-visible:ring-offset-0",
                    )}
                  />
                </div>
              </div>
            </div>

            <div className={bodyPaddingClass}>
              <ScrollArea
                className={cn(compactPanel ? "max-h-[280px]" : "max-h-[320px]")}
              >
                <div
                  className={cn(
                    "pr-2",
                    compactPanel ? "space-y-2" : "space-y-3",
                  )}
                >
                  {displayLoading ? (
                    <div className="rounded-[22px] border border-dashed border-slate-300/80 bg-white/80 px-4 py-8 text-center text-sm text-slate-500">
                      加载中...
                    </div>
                  ) : filteredProjects.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-slate-300/80 bg-white/80 px-4 py-8 text-center text-sm text-slate-500">
                      未找到匹配项目
                    </div>
                  ) : (
                    filteredProjects.map((project) => {
                      const isSelected = project.id === selectedProject?.id;
                      return (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => handleSelect(project.id)}
                          className={cn(
                            compact
                              ? "flex w-full items-center gap-2.5 rounded-[18px] border px-3 py-2.5 text-left transition"
                              : "flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition",
                            isSelected
                              ? "border-slate-300 bg-slate-50/85"
                              : "border-slate-200/80 bg-white/85 hover:border-slate-300 hover:bg-white",
                          )}
                        >
                          <div
                            className={cn(
                              "shrink-0 items-center justify-center border border-slate-200/80 bg-slate-50 text-slate-600",
                              compact
                                ? "flex h-9 w-9 rounded-[14px]"
                                : "flex h-11 w-11 rounded-[16px]",
                            )}
                          >
                            {project.icon ? (
                              <span
                                className={compact ? "text-sm" : "text-base"}
                              >
                                {project.icon}
                              </span>
                            ) : (
                              <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "truncate text-slate-900",
                                  compact
                                    ? "text-sm font-semibold"
                                    : "font-medium",
                                )}
                              >
                                {project.name}
                              </span>
                              {project.isDefault ? (
                                <Badge
                                  variant="outline"
                                  className="border-amber-200/80 bg-amber-50 text-[10px] font-medium text-amber-700"
                                >
                                  默认
                                </Badge>
                              ) : null}
                              <Badge
                                variant="outline"
                                className="border-slate-200/80 bg-white/80 text-[10px] text-slate-600"
                              >
                                {WorkspaceTypeLabels[project.workspaceType]}
                              </Badge>
                            </div>
                            <div
                              className="mt-1 truncate text-xs text-muted-foreground"
                              title={project.rootPath}
                            >
                              {compact
                                ? formatProjectPathPreview(project.rootPath)
                                : project.rootPath}
                            </div>
                            {project.tags.length > 0 ? (
                              <div
                                className={cn(
                                  "flex flex-wrap gap-1.5",
                                  compact ? "mt-1.5" : "mt-2",
                                )}
                              >
                                {project.tags.slice(0, 2).map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className="border-slate-200/80 bg-white/70 text-[10px] text-slate-500"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          {isSelected ? (
                            <Check className="h-4 w-4 shrink-0 text-slate-700" />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {enableManagement ? (
              <div
                className={cn(
                  "border-t border-white/80",
                  managementPaddingClass,
                )}
              >
                <div className={cn(compact ? "mb-2.5" : "mb-3")}>
                  <div className="text-sm font-semibold text-slate-900">
                    {managementTitle}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    {managementDescription}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={cn(
                      compact ? "h-8 px-3 text-xs" : "h-9",
                      "gap-1.5 rounded-full border border-[color:var(--lime-surface-border-strong)] bg-[image:var(--lime-primary-gradient)] text-white shadow-sm shadow-slate-950/10 hover:opacity-95",
                    )}
                    onClick={() => {
                      handleOpenChange(false);
                      setCreateDialogOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {createEntityLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      compact ? "h-8 px-3 text-xs" : "h-9",
                      "gap-1.5 rounded-full border-slate-200/80 bg-white",
                    )}
                    onClick={handleOpenRename}
                    disabled={!canRenameProject(selectedProject)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    重命名
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      compact ? "h-8 px-3 text-xs" : "h-9",
                      "gap-1.5 rounded-full border-rose-200/80 bg-rose-50/80 text-destructive hover:text-destructive",
                    )}
                    onClick={handleOpenDelete}
                    disabled={!canDeleteProject(selectedProject)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
                {managementHint ? (
                  <p className="mt-3 text-xs text-slate-500">
                    {managementHint}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreateProject}
        defaultType={defaultProjectType}
        allowedTypes={enableManagement ? [defaultProjectType] : undefined}
      />

      <Dialog
        open={renameDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isRenaming) {
            setRenameDialogOpen(nextOpen);
            if (!nextOpen) {
              setRenameTargetId(null);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[460px] overflow-hidden border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(255,255,255,0.98)_100%)] p-0">
          <DialogHeader className="border-b border-white/80 px-6 py-5">
            <DialogTitle>重命名{entityLabel}</DialogTitle>
            <DialogDescription>
              更新{entityLabel}名称，不会修改本地目录路径。
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            <Input
              value={renameName}
              onChange={(event) => setRenameName(event.target.value)}
              placeholder="输入新的项目名称"
              autoFocus
            />
          </div>
          <DialogFooter className="border-t border-white/80 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="border-slate-200/80 bg-white"
              onClick={() => {
                if (!isRenaming) {
                  setRenameDialogOpen(false);
                  setRenameTargetId(null);
                }
              }}
              disabled={isRenaming}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void handleConfirmRename()}
              disabled={isRenaming}
            >
              {isRenaming ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isDeleting) {
            setDeleteDialogOpen(nextOpen);
            if (!nextOpen) {
              setDeleteTargetId(null);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px] overflow-hidden border-rose-200/80 bg-[linear-gradient(180deg,rgba(255,241,242,0.96)_0%,rgba(255,255,255,0.98)_100%)] p-0">
          <DialogHeader className="border-b border-white/80 px-6 py-5">
            <DialogTitle className="text-destructive">
              删除{entityLabel}
            </DialogTitle>
            <DialogDescription>
              确定要删除{entityLabel}
              {deleteTarget ? `「${deleteTarget.name}」` : ""}
              吗？
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-5">
            <div className="rounded-[22px] border border-destructive/20 bg-destructive/5 px-4 py-4 text-sm">
              <p className="font-medium text-destructive">此操作不可恢复</p>
              <p className="mt-1 text-muted-foreground">
                仅删除项目记录，不删除本地目录和已有文件。
              </p>
            </div>
          </div>
          <DialogFooter className="border-t border-white/80 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="border-slate-200/80 bg-white"
              onClick={() => {
                if (!isDeleting) {
                  setDeleteDialogOpen(false);
                  setDeleteTargetId(null);
                }
              }}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? "删除中..." : `删除${entityLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
