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
import { TASK_CENTER_CHROME_SURFACE } from "../workspace/taskCenterChromeTokens";

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
  "flex items-center rounded-[20px] border border-slate-200/80 bg-white/90 p-1.5 shadow-sm shadow-slate-950/5 backdrop-blur-sm";

const toolbarDividerClassName = "mx-1.5 h-6 w-px shrink-0 bg-slate-200/80";

const toolbarEmbeddedButtonClassName =
  "h-9 rounded-2xl border border-transparent px-3.5 text-xs shadow-none";

const toolbarGhostIconButtonClassName =
  "h-9 w-9 rounded-2xl text-slate-500 hover:bg-slate-100 hover:text-slate-900";

const toolbarTextButtonClassName =
  "gap-1.5 text-slate-700 hover:bg-white hover:text-slate-900";

const taskCenterTopRailClassName =
  "relative flex h-7 w-full items-start overflow-visible bg-transparent pl-5 pr-3 pt-[3px]";

const taskCenterWorkspaceTabClassName =
  "relative z-20 flex h-6 min-w-[132px] max-w-[196px] items-start rounded-t-[10px] border border-b-0 border-slate-200/70 px-2 pt-px text-sm font-medium text-slate-700 shadow-[0_-1px_0_rgba(255,255,255,0.86)] dark:border-white/10 dark:bg-slate-900 dark:text-slate-300";

const taskCenterWorkspaceTabCurveClassName =
  "pointer-events-none absolute bottom-0 h-3.5 w-3.5 bg-transparent";

const taskCenterIconButtonClassName =
  "h-7 w-7 rounded-[10px] border border-transparent bg-transparent text-slate-500 shadow-none transition-[background-color,color] hover:bg-white/70 hover:text-slate-900";

const taskCenterPillButtonClassName =
  "h-7 rounded-[10px] border border-transparent bg-transparent px-2 text-[11px] font-medium text-slate-700 shadow-none transition-[background-color,color] hover:bg-white/70 hover:text-slate-900";

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
  const [workspaceSelectorOpen, setWorkspaceSelectorOpen] = React.useState(false);
  const isTaskCenterChrome = contextVariant === "task-center";
  const isWorkspaceCompact = chrome === "workspace-compact";
  const effectiveCollapseChrome = collapseChrome && !isTaskCenterChrome;
  const groupClassName = cn(
    toolbarGroupClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "rounded-[18px] p-1",
    effectiveCollapseChrome &&
      "border-slate-200/70 bg-white shadow-sm shadow-slate-950/4 backdrop-blur-0",
  );
  const dividerClassName = cn(
    toolbarDividerClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "mx-1 h-5",
  );
  const embeddedButtonClassName = cn(
    toolbarEmbeddedButtonClassName,
    (isWorkspaceCompact || effectiveCollapseChrome) && "h-8 rounded-[18px] px-3",
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
        <div className={taskCenterTopRailClassName}>
          <div className="flex items-center">
            <div
              className={taskCenterWorkspaceTabClassName}
              data-testid="task-center-workspace-shell"
              style={{ backgroundColor: TASK_CENTER_CHROME_SURFACE }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  taskCenterWorkspaceTabCurveClassName,
                  "-left-3.5",
                )}
                style={{
                  borderBottomRightRadius: 14,
                  boxShadow: `5px 5px 0 5px ${TASK_CENTER_CHROME_SURFACE}`,
                }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  taskCenterWorkspaceTabCurveClassName,
                  "-right-3.5",
                )}
                style={{
                  borderBottomLeftRadius: 14,
                  boxShadow: `-5px 5px 0 5px ${TASK_CENTER_CHROME_SURFACE}`,
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
                className="w-auto max-w-[196px]"
              />
            </div>
            <div className="ml-3 mt-[1px] flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-none bg-transparent text-slate-500 shadow-none hover:bg-transparent hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                onClick={() => {
                  setWorkspaceSelectorOpen((current) => !current);
                }}
                aria-label={workspaceSelectorOpen ? "收起工作区菜单" : "展开工作区菜单"}
                aria-expanded={workspaceSelectorOpen}
                title={workspaceSelectorOpen ? "收起工作区菜单" : "展开工作区菜单"}
                data-testid="task-center-workspace-menu-trigger"
              >
                <Plus size={17} strokeWidth={1.7} />
              </Button>
            </div>
          </div>

          <div className="ml-auto mt-[2px] flex shrink-0 items-center gap-1">
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
                title={contextCompactionRunning ? "正在压缩上下文" : "压缩上下文"}
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
                  harnessPanelVisible && "bg-white text-slate-900",
                  harnessAttentionLevel === "warning" &&
                    !harnessPanelVisible &&
                    "bg-amber-50/90 text-amber-800 hover:bg-amber-100 hover:text-amber-900",
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
                  <span className="rounded-full border border-emerald-200 bg-white px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-700">
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
              <span className="inline-flex w-fit items-center rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
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
                  harnessPanelVisible && "bg-slate-100 text-slate-900",
                  harnessAttentionLevel === "warning" &&
                    !harnessPanelVisible &&
                    "border-amber-300 bg-amber-50/75 text-amber-800 hover:bg-amber-100 hover:text-amber-900",
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
                  <span className="rounded-full border border-emerald-200 bg-white/90 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-700 shadow-sm shadow-emerald-950/10">
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
