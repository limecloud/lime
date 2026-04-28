import React from "react";
import {
  Box,
  ChevronDown,
  FolderOpen,
  Home,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { cn } from "@/lib/utils";
import { Navbar } from "../styles";
import {
  TASK_CENTER_CHROME_ACTIVE_TAB,
  TASK_CENTER_CHROME_RAIL_SURFACE,
} from "../workspace/taskCenterChromeTokens";

interface ChatNavbarProps {
  isRunning: boolean;
  chrome?: "full" | "workspace-compact";
  collapseChrome?: boolean;
  contextVariant?: "default" | "task-center";
  entryContextLabel?: string;
  entryContextHint?: string;
  onToggleHistory: () => void;
  showHistoryToggle?: boolean;
  onToggleFullscreen: () => void;
  onBackToProjectManagement?: () => void;
  onBackToResources?: () => void;
  onToggleSettings?: () => void;
  onBackHome?: () => void;
  showCanvasToggle?: boolean;
  isCanvasOpen?: boolean;
  onToggleCanvas?: () => void;
  projectId?: string | null;
  onProjectChange?: (projectId: string) => void;
  workspaceType?: string;
  deferWorkspaceListLoad?: boolean;
  workspaceHintMessage?: string;
  workspaceHintVisible?: boolean;
  onDismissWorkspaceHint?: () => void;
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

const toolbarGroupClassName =
  "flex items-center rounded-[20px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-subtle)] p-1.5 shadow-sm shadow-slate-950/5 backdrop-blur-sm";

const toolbarDividerClassName =
  "mx-1.5 h-6 w-px shrink-0 bg-[color:var(--lime-surface-border)]";

const toolbarEmbeddedButtonClassName =
  "h-9 rounded-2xl border border-transparent px-3.5 text-xs shadow-none";

const toolbarGhostIconButtonClassName =
  "h-9 w-9 rounded-2xl text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text)]";

const toolbarTextButtonClassName =
  "gap-1.5 text-[color:var(--lime-text)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]";

const taskCenterTopRailClassName =
  "relative flex h-[42px] w-full items-end overflow-visible bg-[color:var(--lime-chrome-rail)] px-4 pt-1";

const taskCenterWorkspaceTabClassName =
  "relative z-20 flex h-9 min-w-[148px] max-w-[224px] items-center rounded-t-[18px] rounded-b-none border border-b-0 border-[color:var(--lime-chrome-border)] bg-[color:var(--lime-chrome-tab-active-surface)] px-2 text-sm font-medium text-[color:var(--lime-chrome-text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] dark:border-white/10 dark:bg-slate-900 dark:text-slate-300";

const taskCenterWorkspaceTabCurveClassName =
  "pointer-events-none absolute bottom-0 h-[18px] w-[18px] bg-transparent";

const taskCenterIconButtonClassName =
  "h-7 w-7 rounded-[12px] border border-transparent bg-transparent text-[color:var(--lime-chrome-muted)] shadow-none transition-[background-color,color] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]";

const taskCenterPillButtonClassName =
  "h-7 rounded-[12px] border border-transparent bg-transparent px-2 text-[11px] font-medium text-[color:var(--lime-chrome-text)] shadow-none transition-[background-color,color] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)]";

export const ChatNavbar: React.FC<ChatNavbarProps> = ({
  isRunning: _isRunning,
  chrome = "full",
  collapseChrome = false,
  contextVariant = "default",
  entryContextLabel,
  entryContextHint,
  onToggleHistory,
  showHistoryToggle = true,
  onToggleFullscreen: _onToggleFullscreen,
  onBackToProjectManagement,
  onBackToResources,
  onToggleSettings,
  onBackHome,
  showCanvasToggle = false,
  isCanvasOpen = false,
  onToggleCanvas,
  projectId = null,
  onProjectChange,
  workspaceType,
  deferWorkspaceListLoad,
  workspaceHintMessage,
  workspaceHintVisible = false,
  onDismissWorkspaceHint,
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
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] =
    React.useState(false);
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
    (Boolean(onBackHome) ||
      Boolean(onBackToResources) ||
      Boolean(onBackToProjectManagement));
  const showWorkspaceTools =
    !effectiveCollapseChrome && (showHistoryToggle || showCanvasToggle);
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

  if (isTaskCenterChrome) {
    return (
      <Navbar
        $compact
        $collapsed={false}
        $taskCenter
        data-testid="task-center-workspace-bar"
        style={{
          padding: 0,
          gap: 0,
          alignItems: "stretch",
          overflow: "visible",
          zIndex: 8,
        }}
      >
        <div
          className={taskCenterTopRailClassName}
          style={{ background: TASK_CENTER_CHROME_RAIL_SURFACE }}
        >
          <div className="flex items-center">
            <div
              className={taskCenterWorkspaceTabClassName}
              data-testid="task-center-workspace-shell"
            >
              <span
                aria-hidden="true"
                className={cn(taskCenterWorkspaceTabCurveClassName, "-left-4")}
                style={{
                  borderBottomRightRadius: 18,
                  boxShadow: `5px 5px 0 5px ${TASK_CENTER_CHROME_ACTIVE_TAB}`,
                }}
              />
              <span
                aria-hidden="true"
                className={cn(taskCenterWorkspaceTabCurveClassName, "-right-4")}
                style={{
                  borderBottomLeftRadius: 18,
                  boxShadow: `-5px 5px 0 5px ${TASK_CENTER_CHROME_ACTIVE_TAB}`,
                }}
              />
              <ProjectSelector
                value={projectId}
                onChange={(nextProjectId) => onProjectChange?.(nextProjectId)}
                open={workspaceSelectorOpen}
                onOpenChange={setWorkspaceSelectorOpen}
                passiveTrigger
                workspaceType={workspaceType}
                placeholder="选择工作区"
                dropdownSide="bottom"
                dropdownAlign="start"
                enableManagement={workspaceType === "general"}
                density="compact"
                chrome="workspace-tab"
                deferProjectListLoad={shouldDeferWorkspaceListLoad}
                skipDefaultWorkspaceReadyCheck={isTaskCenterChrome}
                className="w-auto max-w-[224px]"
              />
            </div>
            <div className="relative ml-2 flex h-9 items-center pb-1">
              {workspaceHintVisible && workspaceHintMessage ? (
                <div
                  className="absolute bottom-full left-1/2 z-40 mb-2 flex w-max max-w-[220px] -translate-x-1/2 items-center gap-2 rounded-2xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 py-2 text-xs font-medium text-[color:var(--lime-text)] shadow-lg shadow-slate-950/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  data-testid="task-center-workspace-hint"
                  role="status"
                >
                  <span>{workspaceHintMessage}</span>
                  <button
                    type="button"
                    className="rounded-full px-1 text-[color:var(--lime-text-muted)] transition hover:bg-[color:var(--lime-surface-hover)] hover:text-[color:var(--lime-text)] dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label="关闭工作区提示"
                    onClick={onDismissWorkspaceHint}
                  >
                    ×
                  </button>
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] dark:border-slate-700 dark:bg-slate-900"
                  />
                </div>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-[14px] bg-transparent text-[color:var(--lime-chrome-muted)] shadow-none hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)] dark:text-slate-300 dark:hover:text-white"
                onClick={() => {
                  onDismissWorkspaceHint?.();
                  setWorkspaceSelectorOpen((current) => !current);
                }}
                aria-label={
                  workspaceSelectorOpen ? "收起工作区菜单" : "展开工作区菜单"
                }
                aria-expanded={workspaceSelectorOpen}
                title={
                  workspaceSelectorOpen ? "收起工作区菜单" : "展开工作区菜单"
                }
                data-testid="task-center-workspace-menu-trigger"
              >
                <Plus size={17} strokeWidth={1.7} />
              </Button>
            </div>
          </div>

          <div className="ml-auto flex h-9 shrink-0 items-center gap-1 pb-1">
            {showContextCompactionAction ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={taskCenterIconButtonClassName}
                onClick={onCompactContext}
                disabled={contextCompactionRunning}
                aria-label={
                  contextCompactionRunning ? "正在压缩上下文" : "压缩上下文"
                }
                title={
                  contextCompactionRunning ? "正在压缩上下文" : "压缩上下文"
                }
              >
                <Box size={15} />
              </Button>
            ) : null}

            {showHarnessToggle ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  taskCenterPillButtonClassName,
                  "gap-1 px-2.5",
                  harnessPanelVisible &&
                    "bg-[color:var(--lime-chrome-tab-active-surface)] text-[color:var(--lime-text)]",
                  harnessAttentionLevel === "warning" &&
                    !harnessPanelVisible &&
                    "bg-[color:var(--lime-warning-soft)] text-[color:var(--lime-warning)] hover:bg-[color:var(--lime-warning-soft)] hover:text-[color:var(--lime-warning)]",
                )}
                onClick={onToggleHarnessPanel}
                aria-label={
                  harnessPanelVisible
                    ? `关闭${harnessToggleLabel}`
                    : `打开${harnessToggleLabel}`
                }
                aria-expanded={harnessPanelVisible}
                title={harnessToggleLabel}
              >
                <Sparkles size={12} />
                <span>{harnessToggleLabel}</span>
                {harnessPendingCount > 0 ? (
                  <span className="rounded-full border border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-surface)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-[color:var(--lime-brand-strong)]">
                    {harnessPendingCount > 99 ? "99+" : harnessPendingCount}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform",
                    harnessPanelVisible && "rotate-180",
                  )}
                />
              </Button>
            ) : null}

            {onToggleSettings ? (
              <Button
                variant="ghost"
                size="icon"
                className={taskCenterIconButtonClassName}
                onClick={onToggleSettings}
                aria-label="打开设置"
                title="打开设置"
              >
                <Settings size={16} />
              </Button>
            ) : null}
          </div>
        </div>
      </Navbar>
    );
  }

  return (
    <Navbar $compact={isWorkspaceCompact} $collapsed={effectiveCollapseChrome}>
      <div className="flex items-center gap-2">
        {showNavigationTools ? (
          <div className={groupClassName}>
            {onBackHome && (
              <Button
                variant="ghost"
                size="icon"
                className={ghostIconButtonClassName}
                onClick={onBackHome}
                title="返回新建任务"
                aria-label="返回新建任务"
              >
                <Home size={18} />
              </Button>
            )}
            {onBackHome && (onBackToResources || onBackToProjectManagement) ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}
            {onBackToResources && (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  embeddedButtonClassName,
                  toolbarTextButtonClassName,
                )}
                onClick={onBackToResources}
              >
                <FolderOpen size={16} className="mr-0.5" />
                返回资源
              </Button>
            )}
            {onBackToResources && onBackToProjectManagement ? (
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
                项目管理
              </Button>
            )}
          </div>
        ) : null}

        {showWorkspaceTools ? (
          <div className={groupClassName}>
            {showHistoryToggle && (
              <Button
                variant="ghost"
                size="icon"
                className={ghostIconButtonClassName}
                onClick={onToggleHistory}
                aria-label="切换历史"
                title="切换历史"
              >
                <Box size={18} />
              </Button>
            )}
            {showHistoryToggle && showCanvasToggle ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}
            {showCanvasToggle ? (
              <Button
                variant="ghost"
                size="icon"
                className={ghostIconButtonClassName}
                onClick={onToggleCanvas}
                aria-label={isCanvasOpen ? "折叠画布" : "展开画布"}
                title={isCanvasOpen ? "折叠画布" : "展开画布"}
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

      <div className="flex items-center gap-2">
        {showProjectSelector ? (
          <div className={groupClassName}>
            <ProjectSelector
              value={projectId}
              onChange={(nextProjectId) => onProjectChange?.(nextProjectId)}
              workspaceType={workspaceType}
              placeholder="选择项目"
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
                  aria-label="打开设置"
                  title="打开设置"
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
              aria-label="打开设置"
              title="打开设置"
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
                aria-label="压缩上下文"
                title="压缩上下文"
              >
                <Box size={14} />
                <span>
                  {contextCompactionRunning ? "压缩中..." : "压缩上下文"}
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
                    ? `关闭${harnessToggleLabel}`
                    : `打开${harnessToggleLabel}`
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
