import React from "react";
import {
  Box,
  ChevronDown,
  Home,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { cn } from "@/lib/utils";
import { ThreadProjectSelector } from "./ThreadProjectSelector";
import { Navbar } from "../styles";

interface ChatNavbarProps {
  isRunning: boolean;
  chrome?: "full" | "workspace-compact";
  collapseChrome?: boolean;
  contextVariant?: "default" | "task-center";
  entryContextLabel?: string;
  entryContextHint?: string;
  onToggleFullscreen: () => void;
  onBackToProjectManagement?: () => void;
  onToggleSettings?: () => void;
  onBackHome?: () => void;
  showCanvasToggle?: boolean;
  isCanvasOpen?: boolean;
  onToggleCanvas?: () => void;
  threadId?: string | null;
  projectId?: string | null;
  workspaceRootPath?: string | null;
  openedProjects?: ChatNavbarOpenedProject[];
  onProjectChange?: (projectId: string | null) => void;
  onCloseProject?: (projectId: string) => void;
  workspaceType?: string;
  deferWorkspaceListLoad?: boolean;
  showHarnessToggle?: boolean;
  harnessPanelVisible?: boolean;
  onToggleHarnessPanel?: () => void;
  harnessPendingCount?: number;
  harnessAttentionLevel?: "idle" | "active" | "warning";
  harnessToggleLabel?: string;
  showContextCompactionAction?: boolean;
  contextCompactionRunning?: boolean;
  onCompactContext?: () => void;
}

interface ChatNavbarOpenedProject {
  id: string;
  name: string;
  rootPath?: string | null;
}

const toolbarGroupClassName =
  "flex max-w-full flex-nowrap items-center overflow-hidden whitespace-nowrap rounded-[12px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 shadow-none";

const toolbarDividerClassName =
  "mx-1.5 h-6 w-px shrink-0 bg-[color:var(--lime-surface-border)]";

const toolbarEmbeddedButtonClassName =
  "h-8 shrink-0 whitespace-nowrap rounded-[9px] border border-transparent px-3 text-xs shadow-none";

const toolbarGhostIconButtonClassName =
  "h-8 w-8 shrink-0 rounded-[9px] text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text)]";

const toolbarTextButtonClassName =
  "gap-1.5 text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]";

function normalizeProjectId(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildOpenedProjectTabs(
  openedProjects: ChatNavbarOpenedProject[],
): ChatNavbarOpenedProject[] {
  const seen = new Set<string>();
  return openedProjects.filter((project) => {
    const projectId = normalizeProjectId(project.id);
    if (!projectId || seen.has(projectId)) {
      return false;
    }
    seen.add(projectId);
    return true;
  });
}

export const ChatNavbar: React.FC<ChatNavbarProps> = ({
  isRunning: _isRunning,
  chrome = "full",
  collapseChrome = false,
  contextVariant = "default",
  entryContextLabel,
  entryContextHint,
  onToggleFullscreen: _onToggleFullscreen,
  onBackToProjectManagement,
  onToggleSettings,
  onBackHome,
  showCanvasToggle = false,
  isCanvasOpen = false,
  onToggleCanvas,
  threadId = null,
  projectId = null,
  workspaceRootPath = null,
  openedProjects = [],
  onProjectChange,
  workspaceType,
  deferWorkspaceListLoad,
  showHarnessToggle = false,
  harnessPanelVisible = false,
  onToggleHarnessPanel,
  harnessPendingCount = 0,
  harnessAttentionLevel = "idle",
  harnessToggleLabel = "Harness",
  showContextCompactionAction = false,
  contextCompactionRunning = false,
  onCompactContext,
}) => {
  const { t } = useTranslation("agent");
  const navText = (
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ) =>
    String(
      t(
        key as never,
        {
          defaultValue,
          ...options,
        } as never,
      ),
    );
  const isTaskCenterChrome = contextVariant === "task-center";
  const isWorkspaceCompact = chrome === "workspace-compact";
  const effectiveCollapseChrome = collapseChrome && !isTaskCenterChrome;
  const groupClassName = cn(
    toolbarGroupClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "rounded-[18px] p-1",
    effectiveCollapseChrome &&
      "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] shadow-sm shadow-slate-950/5 backdrop-blur-0",
  );
  const dividerClassName = cn(
    toolbarDividerClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "mx-1 h-5",
  );
  const embeddedButtonClassName = cn(
    toolbarEmbeddedButtonClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) &&
      "h-8 rounded-[18px] px-3",
  );
  const ghostIconButtonClassName = cn(
    toolbarGhostIconButtonClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "h-8 w-8 rounded-[18px]",
  );
  const showStatusTools = showHarnessToggle || showContextCompactionAction;
  const showNavigationTools =
    !effectiveCollapseChrome &&
    !isWorkspaceCompact &&
    (Boolean(onBackHome) || Boolean(onBackToProjectManagement));
  const showWorkspaceTools = !effectiveCollapseChrome && showCanvasToggle;
  const showProjectSelector = !isWorkspaceCompact && !isTaskCenterChrome;
  const showCompactSettingsButton =
    isWorkspaceCompact && !isTaskCenterChrome && Boolean(onToggleSettings);
  const compactProjectSelectorClassName =
    isWorkspaceCompact || effectiveCollapseChrome
      ? "min-w-[184px] max-w-[248px]"
      : "min-w-[196px] max-w-[280px]";
  const showEntryContext = Boolean(entryContextLabel);
  const shouldDeferWorkspaceListLoad =
    deferWorkspaceListLoad ?? isTaskCenterChrome;
  const normalizedProjectId = normalizeProjectId(projectId);
  const openedProjectTabs = React.useMemo(
    () => buildOpenedProjectTabs(openedProjects),
    [openedProjects],
  );
  const orderedOpenedProjectTabs = React.useMemo(() => {
    if (!normalizedProjectId) {
      return [{ id: "", name: "" }, ...openedProjectTabs];
    }
    const hasCurrentProject = openedProjectTabs.some(
      (project) => normalizeProjectId(project.id) === normalizedProjectId,
    );
    return hasCurrentProject ? openedProjectTabs : [{ id: "", name: "" }];
  }, [normalizedProjectId, openedProjectTabs]);
  const activeWorkspace = orderedOpenedProjectTabs.find(
    (project) => normalizeProjectId(project.id) === normalizedProjectId,
  );
  const currentWorkspaceName = activeWorkspace?.name || null;

  if (isTaskCenterChrome) {
    // Codex shows a single thread title in the window chrome; project tabs
    // belong to the sidebar, not a second workspace tab strip.
    return null;
  }

  return (
    <Navbar $compact={isWorkspaceCompact} $collapsed={effectiveCollapseChrome}>
      <div
        className="flex min-w-0 items-center gap-2 overflow-hidden"
        data-testid="chat-navbar-leading-tools"
      >
        {showNavigationTools ? (
          <div className={groupClassName}>
            {onBackHome && (
              <Button
                variant="ghost"
                size="icon"
                className={ghostIconButtonClassName}
                onClick={onBackHome}
                title={navText("agentChat.navbar.backHome", "返回新建任务")}
                aria-label={navText(
                  "agentChat.navbar.backHome",
                  "返回新建任务",
                )}
              >
                <Home size={18} />
              </Button>
            )}
            {onBackHome && onBackToProjectManagement ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}
            {onBackToProjectManagement && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  embeddedButtonClassName,
                  toolbarTextButtonClassName,
                )}
                onClick={onBackToProjectManagement}
              >
                {navText("agentChat.navbar.projectManagement", "项目管理")}
              </Button>
            )}
          </div>
        ) : null}

        {showWorkspaceTools ? (
          <div className={groupClassName}>
            {showCanvasToggle ? (
              <Button
                variant="ghost"
                size="icon"
                className={ghostIconButtonClassName}
                onClick={onToggleCanvas}
                aria-label={
                  isCanvasOpen
                    ? navText("agentChat.navbar.collapseCanvas", "折叠画布")
                    : navText("agentChat.navbar.expandCanvas", "展开画布")
                }
                title={
                  isCanvasOpen
                    ? navText("agentChat.navbar.collapseCanvas", "折叠画布")
                    : navText("agentChat.navbar.expandCanvas", "展开画布")
                }
              >
                {isCanvasOpen ? (
                  <PanelRightClose size={18} />
                ) : (
                  <PanelRightOpen size={18} />
                )}
              </Button>
            ) : null}
          </div>
        ) : null}

        {showEntryContext ? (
          <div
            className={cn(
              "ml-1 min-w-0",
              isWorkspaceCompact ? "max-w-[180px]" : "max-w-[320px]",
            )}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="inline-flex w-fit items-center rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-muted)] px-3 py-1 text-[11px] font-medium text-[color:var(--lime-text-muted)]">
                {entryContextLabel}
              </span>
              {!isWorkspaceCompact && entryContextHint ? (
                <p className="truncate text-xs text-slate-500">
                  {entryContextHint}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex-1" />

      <div
        className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap"
        data-testid="chat-navbar-trailing-tools"
      >
        {threadId ? (
          <ThreadProjectSelector
            threadId={threadId}
            workspaceName={currentWorkspaceName}
            workspaceRootPath={workspaceRootPath}
          />
        ) : null}
        {showProjectSelector ? (
          <div className={groupClassName}>
            <ProjectSelector
              value={projectId}
              onChange={(nextProjectId) => onProjectChange?.(nextProjectId)}
              workspaceType={workspaceType}
              placeholder={navText(
                "agentChat.navbar.projectPlaceholder",
                "选择项目",
              )}
              dropdownSide="bottom"
              dropdownAlign="end"
              enableManagement={workspaceType === "general"}
              density="compact"
              chrome="embedded"
              deferProjectListLoad={shouldDeferWorkspaceListLoad}
              skipDefaultWorkspaceReadyCheck={shouldDeferWorkspaceListLoad}
              className={compactProjectSelectorClassName}
            />
            {onToggleSettings ? (
              <>
                <div className={dividerClassName} aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="icon"
                  className={ghostIconButtonClassName}
                  onClick={onToggleSettings}
                  aria-label={navText(
                    "agentChat.navbar.openSettings",
                    "打开设置",
                  )}
                  title={navText("agentChat.navbar.openSettings", "打开设置")}
                >
                  <Settings size={18} />
                </Button>
              </>
            ) : null}
          </div>
        ) : null}

        {showCompactSettingsButton ? (
          <div className={groupClassName}>
            <Button
              variant="ghost"
              size="icon"
              className={ghostIconButtonClassName}
              onClick={onToggleSettings}
              aria-label={navText("agentChat.navbar.openSettings", "打开设置")}
              title={navText("agentChat.navbar.openSettings", "打开设置")}
            >
              <Settings size={18} />
            </Button>
          </div>
        ) : null}

        {showStatusTools ? (
          <div className={groupClassName}>
            {showContextCompactionAction ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  embeddedButtonClassName,
                  toolbarTextButtonClassName,
                )}
                onClick={onCompactContext}
                disabled={contextCompactionRunning}
                aria-label={
                  contextCompactionRunning
                    ? navText(
                        "agentChat.navbar.compactContextRunning",
                        "正在压缩上下文",
                      )
                    : navText("agentChat.navbar.compactContext", "压缩上下文")
                }
                title={
                  contextCompactionRunning
                    ? navText(
                        "agentChat.navbar.compactContextRunning",
                        "正在压缩上下文",
                      )
                    : navText("agentChat.navbar.compactContext", "压缩上下文")
                }
              >
                <Box size={14} />
                <span>
                  {contextCompactionRunning
                    ? navText(
                        "agentChat.navbar.compactContextShortRunning",
                        "压缩中...",
                      )
                    : navText("agentChat.navbar.compactContext", "压缩上下文")}
                </span>
              </Button>
            ) : null}

            {showContextCompactionAction && showHarnessToggle ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}

            {showHarnessToggle ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  embeddedButtonClassName,
                  toolbarTextButtonClassName,
                  harnessPanelVisible &&
                    "bg-[color:var(--lime-surface-hover)] text-[color:var(--lime-text)]",
                  harnessAttentionLevel === "warning" &&
                    !harnessPanelVisible &&
                    "border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] text-[color:var(--lime-warning)] hover:bg-[color:var(--lime-warning-soft)] hover:text-[color:var(--lime-warning)]",
                )}
                onClick={onToggleHarnessPanel}
                aria-label={
                  harnessPanelVisible
                    ? navText(
                        "agentChat.navbar.closeHarness",
                        "关闭{{label}}",
                        { label: harnessToggleLabel },
                      )
                    : navText("agentChat.navbar.openHarness", "打开{{label}}", {
                        label: harnessToggleLabel,
                      })
                }
                aria-expanded={harnessPanelVisible}
                title={harnessToggleLabel}
              >
                <Sparkles size={14} />
                <span>{harnessToggleLabel}</span>
                {harnessPendingCount > 0 ? (
                  <span className="rounded-full border border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-surface)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[color:var(--lime-brand-strong)] shadow-sm shadow-slate-950/10">
                    {harnessPendingCount > 99 ? "99+" : harnessPendingCount}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    harnessPanelVisible && "rotate-180",
                  )}
                />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Navbar>
  );
};
