import React from "react";
import {
  Box,
  ChevronDown,
  FolderOpen,
  Home,
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
  onToggleHistory: () => void;
  showHistoryToggle?: boolean;
  onToggleFullscreen: () => void;
  onBackToProjectManagement?: () => void;
  onBackToResources?: () => void;
  onToggleSettings?: () => void;
  onBackHome?: () => void;
  projectId?: string | null;
  onProjectChange?: (projectId: string) => void;
  workspaceType?: string;
  showHarnessToggle?: boolean;
  harnessPanelVisible?: boolean;
  onToggleHarnessPanel?: () => void;
  harnessPendingCount?: number;
  harnessAttentionLevel?: "idle" | "active" | "warning";
  novelCanvasControls?: {
    chapterListCollapsed: boolean;
    onToggleChapterList: () => void;
    onAddChapter: () => void;
    onCloseCanvas: () => void;
  } | null;
}

export const ChatNavbar: React.FC<ChatNavbarProps> = ({
  isRunning: _isRunning,
  onToggleHistory,
  showHistoryToggle = true,
  onToggleFullscreen: _onToggleFullscreen,
  onBackToProjectManagement,
  onBackToResources,
  onToggleSettings,
  onBackHome,
  projectId = null,
  onProjectChange,
  workspaceType,
  showHarnessToggle = false,
  harnessPanelVisible = false,
  onToggleHarnessPanel,
  harnessPendingCount = 0,
  harnessAttentionLevel = "idle",
  novelCanvasControls = null,
}) => {
  return (
    <Navbar>
      <div className="flex items-center gap-2">
        {onBackHome && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onBackHome}
            title="返回首页"
          >
            <Home size={18} />
          </Button>
        )}
        {onBackToResources && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onBackToResources}
          >
            <FolderOpen size={16} className="mr-1.5" />
            返回资源
          </Button>
        )}
        {showHistoryToggle && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={onToggleHistory}
          >
            <Box size={18} />
          </Button>
        )}
        {onBackToProjectManagement && (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={onBackToProjectManagement}
          >
            项目管理
          </Button>
        )}
        {novelCanvasControls && (
          <>
            <div className="h-5 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
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
              className="h-8 w-8 text-muted-foreground"
              onClick={novelCanvasControls.onAddChapter}
              title="新建章节"
            >
              <Plus size={18} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={novelCanvasControls.onCloseCanvas}
              title="关闭画布"
            >
              <X size={18} />
            </Button>
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <ProjectSelector
          value={projectId}
          onChange={(nextProjectId) => onProjectChange?.(nextProjectId)}
          workspaceType={workspaceType}
          placeholder="选择项目"
          dropdownSide="bottom"
          dropdownAlign="end"
          className="h-8 text-xs min-w-[160px] max-w-[220px]"
        />

        {showHarnessToggle ? (
          <Button
            type="button"
            variant={harnessPanelVisible ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "h-8 gap-1.5 px-3 text-xs",
              harnessAttentionLevel === "warning" &&
                !harnessPanelVisible &&
                "border-amber-300 text-amber-700 hover:text-amber-800",
            )}
            onClick={onToggleHarnessPanel}
            aria-label={
              harnessPanelVisible ? "收起 Harness 面板" : "展开 Harness 面板"
            }
            aria-expanded={harnessPanelVisible}
            title={
              harnessPanelVisible ? "收起 Harness 面板" : "展开 Harness 面板"
            }
          >
            <Sparkles size={14} />
            <span>Harness</span>
            {harnessPendingCount > 0 ? (
              <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive-foreground">
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

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground"
          onClick={onToggleSettings}
        >
          <Settings2 size={18} />
        </Button>
      </div>
    </Navbar>
  );
};
