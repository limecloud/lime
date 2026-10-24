import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  FolderX,
  GitBranch,
  Loader2,
  Monitor,
  Plus,
  Search,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getProject } from "@/lib/api/project";
import {
  useComposerMode,
  type ComposerModeState,
} from "../../../workspace/ComposerModeContext";
import { useComposerUtilityActions } from "./useComposerUtilityActions";
import { WorktreeEnvironmentDropdown } from "../../WorktreeEnvironmentDropdown";
import type {
  ComposerProject,
  ComposerUtilityBarCopy,
} from "./composerUtilityBarTypes";

interface ComposerUtilityBarProps extends Partial<ComposerModeState> {
  projectId?: string | null;
  openedProjects?: ComposerProject[];
  onProjectChange?: (projectId: string | null) => void;
  modeLabel?: string;
  branchLabel?: string;
  projectOpen?: boolean;
  onProjectOpenChange?: (open: boolean) => void;
  showModeControls?: boolean;
  className?: string;
  projectTriggerClassName?: string;
  projectTriggerContentClassName?: string;
  projectMenuAlign?: "start" | "center" | "end";
  projectMenuSide?: "top" | "right" | "bottom" | "left";
  projectMenuSideOffset?: number;
  copy: ComposerUtilityBarCopy;
}

function normalizeProjectId(projectId?: string | null): string {
  return projectId?.trim() ?? "";
}

function isUuidLike(value?: string | null): boolean {
  const normalized = value?.trim();
  if (!normalized) {
    return false;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    normalized,
  );
}

function isDisplayableProject(project?: ComposerProject | null) {
  if (!project) {
    return false;
  }
  const projectId = normalizeProjectId(project.id);
  const projectName = project.name.trim();
  const projectRootPath = project.rootPath?.trim();
  if (!projectId || !projectName) {
    return false;
  }
  if (projectRootPath) {
    return true;
  }
  return !(isUuidLike(projectId) && projectName === projectId);
}

function formatProjectPath(path?: string | null): string | null {
  const normalized = path?.trim();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) {
    return normalized;
  }

  return `.../${parts.slice(-2).join("/")}`;
}

export function ComposerUtilityBar(props: ComposerUtilityBarProps) {
  const projectId = normalizeProjectId(props.projectId);
  return (
    <ComposerProjectContext key={projectId} {...props} projectId={projectId} />
  );
}

function ComposerProjectContext(props: ComposerUtilityBarProps) {
  const normalizedProjectId = normalizeProjectId(props.projectId);
  const openedProjects = props.openedProjects;
  const [resolvedProject, setResolvedProject] =
    useState<ComposerProject | null>(null);
  const openedProjectsContainCurrent = Boolean(
    normalizedProjectId &&
    openedProjects?.some(
      (project) => normalizeProjectId(project.id) === normalizedProjectId,
    ),
  );

  useEffect(() => {
    if (!normalizedProjectId || openedProjectsContainCurrent) {
      setResolvedProject(null);
      return;
    }

    let cancelled = false;
    void getProject(normalizedProjectId)
      .then((project) => {
        if (cancelled) {
          return;
        }
        const projectSummary = project
          ? {
              id: project.id,
              name: project.name,
              rootPath: project.rootPath,
            }
          : null;
        setResolvedProject(
          isDisplayableProject(projectSummary) ? projectSummary : null,
        );
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setResolvedProject(null);
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedProjectId, openedProjectsContainCurrent]);

  const visibleOpenedProjects = useMemo(() => {
    const source: ComposerProject[] = [
      ...(openedProjects ?? []),
      ...(resolvedProject ? [resolvedProject] : []),
    ];
    const seen = new Set<string>();
    return source.filter((project) => {
      const id = normalizeProjectId(project.id);
      if (!id || seen.has(id) || !isDisplayableProject(project)) {
        return false;
      }
      seen.add(id);
      return true;
    });
  }, [openedProjects, resolvedProject]);
  const activeProject =
    visibleOpenedProjects.find(
      (project) => normalizeProjectId(project.id) === normalizedProjectId,
    ) ?? null;

  const workspaceKey = JSON.stringify([
    normalizedProjectId,
    activeProject?.rootPath?.trim() || "",
  ]);
  return (
    <ComposerUtilityBarWorkspace
      key={workspaceKey}
      {...props}
      normalizedProjectId={normalizedProjectId}
      visibleOpenedProjects={visibleOpenedProjects}
      activeProject={activeProject}
    />
  );
}

interface ComposerUtilityBarWorkspaceProps extends ComposerUtilityBarProps {
  normalizedProjectId: string;
  visibleOpenedProjects: ComposerProject[];
  activeProject: ComposerProject | null;
}

function ComposerUtilityBarWorkspace({
  normalizedProjectId,
  visibleOpenedProjects,
  activeProject,
  onProjectChange,
  modeLabel,
  composerMode: controlledMode,
  setComposerMode: setControlledMode,
  branchLabel,
  projectOpen,
  onProjectOpenChange,
  showModeControls = true,
  className,
  projectTriggerClassName,
  projectTriggerContentClassName,
  projectMenuAlign = "start",
  projectMenuSide = "bottom",
  projectMenuSideOffset = 8,
  copy,
}: ComposerUtilityBarWorkspaceProps) {
  const modeState = useComposerMode();
  const composerMode = controlledMode ?? modeState?.composerMode ?? "local";
  const setComposerMode = setControlledMode ?? modeState?.setComposerMode;
  const [searchQuery, setSearchQuery] = useState("");
  const [uncontrolledProjectOpen, setUncontrolledProjectOpen] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  const projectPopoverOpen = projectOpen ?? uncontrolledProjectOpen;
  const handleProjectPopoverOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (projectOpen === undefined) setUncontrolledProjectOpen(nextOpen);
      onProjectOpenChange?.(nextOpen);
    },
    [onProjectOpenChange, projectOpen],
  );
  const activeProjectRootPath = activeProject?.rootPath?.trim() || "";
  const {
    mutation,
    gitStatus: gitRepositoryState,
    gitReadState,
    retryGitStatus,
    selectProject: openEnsuredProject,
    createBlankProject: handleCreateBlankProject,
    useExistingFolder: handleUseExistingFolder,
    checkoutBranch: handleCheckoutBranch,
    createBranch,
  } = useComposerUtilityActions({
    rootPath: activeProjectRootPath,
    showModeControls,
    copy,
    onProjectChange,
    onProjectOpenChange: handleProjectPopoverOpenChange,
    onBranchOpenChange: setBranchPopoverOpen,
    onBranchSearchChange: setBranchSearchQuery,
  });

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredOpenedProjects = normalizedSearch
    ? visibleOpenedProjects.filter(
        (project) =>
          project.name.toLowerCase().includes(normalizedSearch) ||
          project.id.toLowerCase().includes(normalizedSearch),
      )
    : visibleOpenedProjects;
  const resolvedModeLabel =
    composerMode === "worktree"
      ? copy.newWorktree
      : modeLabel?.trim() || copy.localMode;
  const hasGitRepository = Boolean(gitRepositoryState?.hasGitRepository);
  const resolvedBranchLabel = hasGitRepository
    ? branchLabel?.trim() ||
      gitRepositoryState?.currentBranch ||
      copy.branchFallback
    : "";
  const branchOptions = useMemo(() => {
    if (!hasGitRepository) {
      return [];
    }
    const branches = [...(gitRepositoryState?.branches ?? [])];
    const currentBranch = gitRepositoryState?.currentBranch?.trim();
    if (currentBranch && !branches.includes(currentBranch)) {
      branches.unshift(currentBranch);
    }
    return branches;
  }, [gitRepositoryState, hasGitRepository]);
  const filteredBranchOptions = branchSearchQuery.trim()
    ? branchOptions.filter((branch) =>
        branch.toLowerCase().includes(branchSearchQuery.trim().toLowerCase()),
      )
    : branchOptions;
  const normalizedBranchCreateName = branchSearchQuery.trim();
  const canCreateBranch =
    hasGitRepository &&
    normalizedBranchCreateName.length > 0 &&
    !branchOptions.includes(normalizedBranchCreateName);

  const handleCreateBranch = () => createBranch(normalizedBranchCreateName);

  return (
    <div
      className={cn(
        "inline-flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-[color:var(--lime-text)]",
        className,
      )}
      data-testid="composer-utility-bar"
      data-project-id={normalizedProjectId}
      data-workspace-root={activeProjectRootPath}
      data-git-status={gitReadState}
      aria-busy={gitReadState === "loading" || Boolean(mutation)}
    >
      <Popover
        open={projectPopoverOpen}
        onOpenChange={handleProjectPopoverOpenChange}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition",
              "text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text-strong)] hover:shadow-[0_1px_2px_var(--lime-shadow-color)] ",
              projectTriggerClassName,
            )}
            aria-label={copy.projectAria}
            title={activeProject?.name || copy.noProjectLabel}
            data-testid="composer-utility-project-trigger"
            data-utility-action="project-picker"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-brand)]" />
            <span className={cn("truncate", projectTriggerContentClassName)}>
              {activeProject?.name || copy.noProjectLabel}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--lime-text-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align={projectMenuAlign}
          side={projectMenuSide}
          sideOffset={projectMenuSideOffset}
          className="z-[70] w-[292px] overflow-visible rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 text-[color:var(--lime-text-strong)] shadow-[0_24px_60px_-30px_var(--lime-shadow-color)]"
          data-testid="composer-utility-menu"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="flex h-8 items-center gap-2 rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] px-2">
            <Search className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[color:var(--lime-text-strong)] outline-none placeholder:text-[color:var(--lime-text-muted)]"
              value={searchQuery}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchPlaceholder}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-[color:var(--lime-text-muted)]">
            {copy.openedLabel}
          </div>

          <div className="max-h-[210px] overflow-auto">
            {filteredOpenedProjects.length > 0 ? (
              filteredOpenedProjects.map((project) => {
                const isActive =
                  normalizeProjectId(project.id) === normalizedProjectId;
                const pathPreview = formatProjectPath(project.rootPath);
                return (
                  <button
                    key={project.id}
                    type="button"
                    className={cn(
                      "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition",
                      isActive
                        ? "bg-[color:var(--lime-surface-hover)] text-[color:var(--lime-text-strong)]"
                        : "text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]",
                    )}
                    data-testid="composer-utility-opened-project"
                    data-project-id={normalizeProjectId(project.id)}
                    data-utility-action="select-project"
                    onClick={() => openEnsuredProject(project)}
                  >
                    <FolderOpen
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isActive
                          ? "text-[color:var(--lime-brand)]"
                          : "text-[color:var(--lime-text-muted)]",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {project.name}
                      </span>
                      {pathPreview ? (
                        <span className="block truncate text-[10.5px] font-medium text-[color:var(--lime-text-muted)]">
                          {pathPreview}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? (
                      <Check
                        aria-label={copy.currentBadge}
                        className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-brand)]"
                      />
                    ) : null}
                  </button>
                );
              })
            ) : (
              <div className="rounded-lg px-2 py-3 text-[13px] text-[color:var(--lime-text-muted)]">
                {visibleOpenedProjects.length > 0
                  ? copy.noOpenedProjects
                  : copy.noProjectDescription}
              </div>
            )}
          </div>

          <div className="my-1 h-px bg-[color:var(--lime-surface-hover)]" />

          <div
            className="relative"
            onMouseEnter={() => setSubmenuOpen(true)}
            onMouseLeave={() => setSubmenuOpen(false)}
          >
            <button
              type="button"
              className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)] focus:bg-[color:var(--lime-surface-subtle)] focus:outline-none"
              data-testid="composer-utility-add-project"
              onFocus={() => setSubmenuOpen(true)}
            >
              <Plus className="h-4 w-4 text-[color:var(--lime-text-muted)]" />
              <span className="min-w-0 flex-1 truncate">
                {copy.addNewProject}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
            </button>
            {submenuOpen ? (
              // Keep the hit area flush with the parent while preserving the visual gap.
              <div
                className="absolute left-full top-0 z-[80] w-[194px] pl-2"
                data-testid="composer-utility-add-submenu"
              >
                <div
                  className="rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 shadow-[0_24px_60px_-30px_var(--lime-shadow-color)]"
                  data-testid="composer-utility-add-submenu-panel"
                >
                  <button
                    type="button"
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
                    data-testid="composer-utility-create-blank"
                    data-utility-action="create-project"
                    disabled={Boolean(mutation)}
                    onClick={() => void handleCreateBlankProject()}
                  >
                    <FolderPlus className="h-4 w-4 text-[color:var(--lime-brand)]" />
                    <span className="truncate">{copy.createBlankProject}</span>
                  </button>
                  <button
                    type="button"
                    className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
                    data-testid="composer-utility-use-existing"
                    data-utility-action="open-folder"
                    disabled={Boolean(mutation)}
                    onClick={() => void handleUseExistingFolder()}
                  >
                    <FolderOpen className="h-4 w-4 text-[color:var(--lime-info)]" />
                    <span className="truncate">{copy.useExistingFolder}</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
            data-testid="composer-utility-no-project"
            data-utility-action="clear-project"
            onClick={() => {
              openEnsuredProject(null);
            }}
          >
            <FolderX className="h-4 w-4 text-[color:var(--lime-text-muted)]" />
            <span className="min-w-0 flex-1 truncate">
              {copy.noProjectAction}
            </span>
            {!normalizedProjectId ? (
              <Check
                aria-label={copy.currentBadge}
                className="h-3.5 w-3.5 text-[color:var(--lime-brand)]"
              />
            ) : null}
          </button>
        </PopoverContent>
      </Popover>

      {showModeControls ? (
        <>
          <span
            className="h-4 w-px bg-[color:var(--lime-surface-border)]"
            aria-hidden
          />
          {hasGitRepository ? (
            <Popover open={modePopoverOpen} onOpenChange={setModePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text-strong)]"
                  title={`${copy.modeLabel}: ${resolvedModeLabel}`}
                  data-testid="composer-utility-mode"
                  data-utility-action="mode-picker"
                >
                  <Monitor className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-info)]" />
                  <span className="truncate">{resolvedModeLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--lime-text-muted)]" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={8}
                className="z-[70] w-[216px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 text-[color:var(--lime-text-strong)] shadow-[0_24px_60px_-30px_var(--lime-shadow-color)]"
                data-testid="composer-utility-mode-menu"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-[color:var(--lime-text-muted)]">
                  {copy.modeMenuTitle}
                </div>
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text-strong)] transition hover:bg-[color:var(--lime-surface-subtle)]"
                  data-utility-action="select-local"
                  aria-pressed={composerMode === "local"}
                  onClick={() => {
                    setComposerMode?.("local");
                    setModePopoverOpen(false);
                  }}
                >
                  <Monitor className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
                  <span className="min-w-0 flex-1 truncate">
                    {copy.localProcessing}
                  </span>
                  {composerMode === "local" ? (
                    <Check className="h-3.5 w-3.5 text-[color:var(--lime-text)]" />
                  ) : null}
                </button>
                <button
                  type="button"
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
                  disabled={Boolean(mutation) || !setComposerMode}
                  data-utility-action="select-worktree"
                  aria-pressed={composerMode === "worktree"}
                  onClick={() => {
                    setComposerMode?.("worktree");
                    setModePopoverOpen(false);
                  }}
                >
                  <FolderPlus className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
                  <span className="min-w-0 flex-1 truncate">
                    {copy.newWorktree}
                  </span>
                  {composerMode === "worktree" ? (
                    <Check className="h-3.5 w-3.5 text-[color:var(--lime-text)]" />
                  ) : null}
                </button>
              </PopoverContent>
            </Popover>
          ) : (
            <span
              className="inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[color:var(--lime-text)]"
              title={`${copy.modeLabel}: ${resolvedModeLabel}`}
              data-testid="composer-utility-mode"
            >
              <Monitor className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-info)]" />
              <span className="truncate">{resolvedModeLabel}</span>
            </span>
          )}
          {hasGitRepository ? (
            <Popover
              open={branchPopoverOpen}
              onOpenChange={setBranchPopoverOpen}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-[color:var(--lime-text)] transition hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text-strong)]"
                  title={`${copy.branchLabel}: ${resolvedBranchLabel}`}
                  data-testid="composer-utility-branch"
                  data-utility-action="branch-picker"
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
                  <span className="truncate">{resolvedBranchLabel}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-[color:var(--lime-text-muted)]" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="bottom"
                sideOffset={8}
                className="z-[70] w-[300px] rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1.5 text-[color:var(--lime-text-strong)] shadow-[0_24px_60px_-30px_var(--lime-shadow-color)]"
                data-testid="composer-utility-branch-menu"
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <div className="flex h-8 items-center gap-2 rounded-lg border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-2">
                  <Search className="h-3.5 w-3.5 text-[color:var(--lime-text-muted)]" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-[color:var(--lime-text-strong)] outline-none placeholder:text-[color:var(--lime-text-muted)]"
                    value={branchSearchQuery}
                    placeholder={copy.branchSearchPlaceholder}
                    aria-label={copy.branchSearchPlaceholder}
                    onChange={(event) =>
                      setBranchSearchQuery(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && canCreateBranch) {
                        event.preventDefault();
                        void handleCreateBranch();
                      }
                    }}
                  />
                </div>
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold text-[color:var(--lime-text-muted)]">
                  {gitRepositoryState?.uncommittedFileCount
                    ? copy.uncommittedFiles(
                        gitRepositoryState.uncommittedFileCount,
                      )
                    : copy.branchLabel}
                </div>
                <div className="max-h-[190px] overflow-auto pb-1">
                  {filteredBranchOptions.map((branch) => (
                    <button
                      key={branch}
                      type="button"
                      className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium text-[color:var(--lime-text-strong)] transition hover:bg-[color:var(--lime-surface-subtle)]"
                      disabled={Boolean(mutation)}
                      data-utility-action="checkout-branch"
                      data-branch={branch}
                      onClick={() => void handleCheckoutBranch(branch)}
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-[color:var(--lime-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate">{branch}</span>
                      {branch === resolvedBranchLabel ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text)]" />
                      ) : null}
                    </button>
                  ))}
                </div>
                <div className="my-1 h-px bg-[color:var(--lime-surface-hover)]" />
                <button
                  type="button"
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium transition",
                    canCreateBranch
                      ? "text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
                      : "text-[color:var(--lime-text-muted)]",
                  )}
                  aria-disabled={!canCreateBranch || Boolean(mutation)}
                  disabled={!canCreateBranch || Boolean(mutation)}
                  data-utility-action="create-branch"
                  onClick={() => void handleCreateBranch()}
                >
                  <Plus className="h-4 w-4 text-[color:var(--lime-text-muted)]" />
                  <span className="min-w-0 flex-1 truncate">
                    {canCreateBranch
                      ? copy.branchCreateNamedAction(normalizedBranchCreateName)
                      : copy.branchCreateAction}
                  </span>
                </button>
              </PopoverContent>
            </Popover>
          ) : null}
          {composerMode === "worktree" && activeProjectRootPath ? (
            <WorktreeEnvironmentDropdown
              key={activeProjectRootPath}
              workspaceRoot={activeProjectRootPath}
              disabled={Boolean(mutation)}
            />
          ) : null}
          {gitReadState === "loading" ? (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 px-2 text-xs text-[color:var(--lime-text-muted)]"
              data-testid="composer-utility-git-status"
            >
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
              {copy.gitStatusLoading}
            </span>
          ) : gitReadState === "error" ? (
            <span
              role="alert"
              className="inline-flex items-center gap-1.5 px-2 text-xs text-[color:var(--lime-danger)]"
              data-testid="composer-utility-git-status"
            >
              {copy.gitStatusFailed}
              <button
                type="button"
                className="rounded px-1 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lime-info)] disabled:opacity-50"
                disabled={Boolean(mutation)}
                onClick={retryGitStatus}
                data-utility-action="retry-git-status"
              >
                {copy.retryGitStatus}
              </button>
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
