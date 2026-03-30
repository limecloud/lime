import React from "react";
import {
  Box,
  ChevronDown,
  FolderOpen,
  Globe,
  Home,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { cn } from "@/lib/utils";
import { Navbar } from "../styles";

interface ChatNavbarProps {
  isRunning: boolean;
  chrome?: "full" | "workspace-compact";
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
  novelCanvasControls?: {
    chapterListCollapsed: boolean;
    onToggleChapterList: () => void;
    onAddChapter: () => void;
    onCloseCanvas: () => void;
  } | null;
  showBrowserAssistEntry?: boolean;
  browserAssistActive?: boolean;
  browserAssistLoading?: boolean;
  browserAssistAttentionLevel?: "idle" | "info" | "warning";
  browserAssistLabel?: string;
  onOpenBrowserAssist?: () => void;
}

function resolveBrowserAssistTitle(
  attentionLevel: NonNullable<ChatNavbarProps["browserAssistAttentionLevel"]>,
): string {
  if (attentionLevel === "warning") {
    return "恢复浏览器工作台";
  }

  if (attentionLevel === "info") {
    return "查看浏览器工作台状态";
  }

  return "打开浏览器工作台";
}

const toolbarGroupClassName =
  "flex items-center rounded-[20px] border border-slate-200/80 bg-white/90 p-1.5 shadow-sm shadow-slate-950/5 backdrop-blur-sm";

const toolbarDividerClassName =
  "mx-1.5 h-6 w-px shrink-0 bg-slate-200/80";

const toolbarEmbeddedButtonClassName =
  "h-9 rounded-2xl border border-transparent px-3.5 text-xs shadow-none";

const toolbarGhostIconButtonClassName =
  "h-9 w-9 rounded-2xl text-slate-500 hover:bg-slate-100 hover:text-slate-900";

const toolbarTextButtonClassName =
  "gap-1.5 text-slate-700 hover:bg-white hover:text-slate-900";

export const ChatNavbar: React.FC<ChatNavbarProps> = ({
  isRunning: _isRunning,
  chrome = "full",
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
  novelCanvasControls = null,
  showBrowserAssistEntry = false,
  browserAssistActive = false,
  browserAssistLoading = false,
  browserAssistAttentionLevel = "idle",
  browserAssistLabel,
  onOpenBrowserAssist,
}) => {
  const isWorkspaceCompact = chrome === "workspace-compact";
  const browserAssistTitle = resolveBrowserAssistTitle(
    browserAssistAttentionLevel,
  );
  const groupClassName = cn(
    toolbarGroupClassName,
    isWorkspaceCompact && "rounded-[18px] p-1",
  );
  const dividerClassName = cn(
    toolbarDividerClassName,
    isWorkspaceCompact && "mx-1 h-5",
  );
  const embeddedButtonClassName = cn(
    toolbarEmbeddedButtonClassName,
    isWorkspaceCompact && "h-8 rounded-[18px] px-3",
  );
  const ghostIconButtonClassName = cn(
    toolbarGhostIconButtonClassName,
    isWorkspaceCompact && "h-8 w-8 rounded-[18px]",
  );
  const showStatusTools =
    showBrowserAssistEntry || showHarnessToggle || showContextCompactionAction;
  const showNavigationTools =
    !isWorkspaceCompact &&
    (Boolean(onBackHome) ||
      Boolean(onBackToResources) ||
      Boolean(onBackToProjectManagement));
  const showWorkspaceTools = showHistoryToggle || showCanvasToggle || Boolean(novelCanvasControls);
  const showProjectSelector = !isWorkspaceCompact;
  const showCompactSettingsButton = isWorkspaceCompact && Boolean(onToggleSettings);
  const compactProjectSelectorClassName = isWorkspaceCompact
    ? "min-w-[184px] max-w-[248px]"
    : "min-w-[196px] max-w-[280px]";

  return (
    <Navbar $compact={isWorkspaceCompact}>
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
                className={cn(embeddedButtonClassName, toolbarTextButtonClassName)}
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
                className={cn(embeddedButtonClassName, toolbarTextButtonClassName)}
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
            {showHistoryToggle && (showCanvasToggle || novelCanvasControls) ? (
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
            {showCanvasToggle && novelCanvasControls ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}
            {novelCanvasControls ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ghostIconButtonClassName}
                  onClick={novelCanvasControls.onToggleChapterList}
                  title={
                    novelCanvasControls.chapterListCollapsed
                      ? "展开章节栏"
                      : "收起章节栏"
                  }
                >
                  {novelCanvasControls.chapterListCollapsed ? (
                    <PanelLeftOpen size={18} />
                  ) : (
                    <PanelLeftClose size={18} />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ghostIconButtonClassName}
                  onClick={novelCanvasControls.onAddChapter}
                  title="新建章节"
                >
                  <Plus size={18} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={ghostIconButtonClassName}
                  onClick={novelCanvasControls.onCloseCanvas}
                  title="关闭画布"
                >
                  <X size={18} />
                </Button>
              </>
            ) : null}
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
            <div className={dividerClassName} aria-hidden="true" />
            <Button
              variant="ghost"
              size="icon"
              className={ghostIconButtonClassName}
              onClick={onToggleSettings}
              aria-label="打开设置"
              title="打开设置"
            >
              <Settings2 size={18} />
            </Button>
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
              <Settings2 size={18} />
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
                className={cn(embeddedButtonClassName, toolbarTextButtonClassName)}
                onClick={onCompactContext}
                disabled={contextCompactionRunning}
                aria-label="压缩上下文"
                title="压缩上下文"
              >
                <Box size={14} />
                <span>{contextCompactionRunning ? "压缩中..." : "压缩上下文"}</span>
              </Button>
            ) : null}

            {showContextCompactionAction &&
            (showBrowserAssistEntry || showHarnessToggle) ? (
              <div className={dividerClassName} aria-hidden="true" />
            ) : null}

            {showBrowserAssistEntry ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  embeddedButtonClassName,
                  toolbarTextButtonClassName,
                  browserAssistActive && "bg-slate-100 text-slate-900",
                  browserAssistAttentionLevel === "warning" &&
                    "border-amber-300 bg-amber-50/80 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/15 dark:hover:text-amber-100",
                  browserAssistAttentionLevel === "info" &&
                    "border-sky-300 bg-sky-50/80 text-sky-800 hover:bg-sky-100 hover:text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:bg-sky-500/15 dark:hover:text-sky-100",
                )}
                onClick={onOpenBrowserAssist}
                disabled={browserAssistLoading}
                aria-label={browserAssistTitle}
                title={browserAssistTitle}
              >
                <Globe size={14} />
                {browserAssistAttentionLevel !== "idle" ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 rounded-full shadow-sm shadow-slate-950/10",
                      browserAssistAttentionLevel === "warning"
                        ? "bg-amber-500"
                        : "bg-sky-500",
                    )}
                  />
                ) : null}
                <span>
                  {browserAssistLoading
                    ? "启动中..."
                    : browserAssistLabel?.trim() || "浏览器工作台"}
                </span>
              </Button>
            ) : null}

            {showBrowserAssistEntry && showHarnessToggle ? (
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
                    ? `收起${harnessToggleLabel}`
                    : `展开${harnessToggleLabel}`
                }
                aria-expanded={harnessPanelVisible}
                title={
                  harnessPanelVisible
                    ? `收起${harnessToggleLabel}`
                    : `展开${harnessToggleLabel}`
                }
              >
                <Sparkles size={14} />
                <span>{harnessToggleLabel}</span>
                {harnessPendingCount > 0 ? (
                  <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white">
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
