import { type ComponentType } from "react";
import {
  FolderOpen,
  Plus,
  Sparkles,
  PenTool,
  Boxes,
  Send,
  Settings,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Page, PageParams, WorkspaceTheme, WorkspaceViewMode } from "@/types/page";
import type {
  NovelQuickCreateOptions,
  NovelQuickCreateResult,
  OpenProjectWritingOptions,
  ThemeWorkspaceNotice,
  ThemeWorkspaceNavigationItem,
  ThemeWorkspaceRendererProps,
  ThemeWorkspaceView,
} from "@/features/themes/types";
import { getProjectTypeLabel, type Project } from "@/lib/api/project";
import { AgentChatPage } from "@/components/agent";
import type { WorkflowProgressSnapshot } from "@/components/agent/chat";
import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import {
  buildCreateConfirmationA2UI,
  type PendingCreateConfirmation,
} from "@/components/workspace/utils/createConfirmationPolicy";
import { WorkbenchCreateEntryHome } from "./WorkbenchCreateEntryHome";

const NAV_META: Record<
  string,
  { icon: any; description: string; colorClass: string; bgClass: string }
> = {
  create: {
    icon: PenTool,
    description: "AI 辅助内容撰写与多轮迭代",
    colorClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/30",
  },
  material: {
    icon: Boxes,
    description: "管理参考素材、图片与知识库",
    colorClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/30",
  },
  publish: {
    icon: Send,
    description: "预览、分发与一键发布内容",
    colorClass: "text-rose-600 dark:text-rose-400",
    bgClass: "bg-rose-50 dark:bg-rose-950/30",
  },
  settings: {
    icon: Settings,
    description: "配置参数、模型与流程阈值",
    colorClass: "text-slate-600 dark:text-slate-400",
    bgClass: "bg-slate-50 dark:bg-slate-900/50",
  },
  workflow: {
    icon: Workflow,
    description: "图形化统筹与编排工作流",
    colorClass: "text-violet-600 dark:text-violet-400",
    bgClass: "bg-violet-50 dark:bg-violet-950/30",
  },
};

function getProjectHeroDescription(project: Project | null): string {
  if (!project) {
    return "欢迎来到您的灵感控制台。在这里，您可以高效统筹所有素材、构思文稿、规划视觉排版，并将创意一键分发至全域社媒网络。";
  }

  const projectTypeLabel = getProjectTypeLabel(project.workspaceType);
  const tagSummary =
    project.tags.length > 0 ? `当前聚焦 ${project.tags.slice(0, 3).join(" / ")}。` : "";
  const contentSummary =
    project.stats?.content_count && project.stats.content_count > 0
      ? `已沉淀 ${project.stats.content_count} 份内容，适合继续串联创作、排版与发布。`
      : "可以从素材整理、内容创作到预览发布，逐步搭建完整的项目工作流。";

  return `${projectTypeLabel}项目已就绪。${tagSummary}${contentSummary}`;
}

type ThemeWorkspaceRenderer = ComponentType<ThemeWorkspaceRendererProps> | null | undefined;

export interface WorkbenchMainContentProps {
  workspaceMode: WorkspaceViewMode;
  selectedProjectId: string | null;
  selectedProject: Project | null;
  navigationItems: ThemeWorkspaceNavigationItem[];
  workspaceNotice?: ThemeWorkspaceNotice;
  onOpenCreateProjectDialog: () => void;
  onOpenCreateContentDialog: () => void;
  onEnterWorkspaceView: (view: ThemeWorkspaceView) => void;
  onQuickCreateNovelEntry?: (
    options: NovelQuickCreateOptions,
  ) => Promise<NovelQuickCreateResult>;
  onOpenProjectWriting?: (
    projectId: string,
    options?: OpenProjectWritingOptions,
  ) => Promise<string>;
  activeWorkspaceView: ThemeWorkspaceView;
  primaryWorkspaceRenderer?: ThemeWorkspaceRenderer;
  selectedContentId: string | null;
  resetAt?: number;
  onBackHome?: () => void;
  onOpenWorkflowView: () => void;
  onNavigate?: (page: Page, params?: PageParams) => void;
  theme: WorkspaceTheme;
  pendingInitialPromptsByContentId: Record<string, string>;
  pendingCreateConfirmation?: PendingCreateConfirmation;
  onSubmitCreateConfirmation?: (formData: A2UIFormData) => Promise<void> | void;
  onCancelCreateConfirmation?: () => void;
  onConsumePendingInitialPrompt: (contentId: string) => void;
  contentCreationModes: Record<string, CreationMode>;
  showChatPanel: boolean;
  showCreateContentEntryHome: boolean;
  onWorkflowProgressChange: (progress: WorkflowProgressSnapshot | null) => void;
  onChatSessionChange?: (sessionId: string | null) => void;
  activePanelRenderer?: ThemeWorkspaceRenderer;
}

export function WorkbenchMainContent({
  workspaceMode,
  selectedProjectId,
  selectedProject,
  navigationItems,
  workspaceNotice,
  onOpenCreateProjectDialog,
  onOpenCreateContentDialog,
  onEnterWorkspaceView,
  onQuickCreateNovelEntry,
  onOpenProjectWriting,
  activeWorkspaceView,
  primaryWorkspaceRenderer: PrimaryWorkspaceRenderer,
  selectedContentId,
  resetAt,
  onBackHome,
  onOpenWorkflowView,
  onNavigate,
  theme,
  pendingInitialPromptsByContentId,
  pendingCreateConfirmation,
  onSubmitCreateConfirmation,
  onCancelCreateConfirmation,
  onConsumePendingInitialPrompt,
  contentCreationModes,
  showChatPanel,
  showCreateContentEntryHome,
  onWorkflowProgressChange,
  onChatSessionChange,
  activePanelRenderer: ActivePanelRenderer,
}: WorkbenchMainContentProps) {
  const createConfirmationResponse = pendingCreateConfirmation
    ? buildCreateConfirmationA2UI(pendingCreateConfirmation)
    : null;

  if (workspaceMode === "project-management") {
    return (
      <div className="h-full min-h-0 flex flex-col bg-slate-50/30 dark:bg-[#0a0a0a] relative overflow-hidden">
        {/* Absolute Background Elements for the entire page */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-400/10 dark:bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-sky-400/10 dark:bg-sky-500/10 rounded-full blur-[120px] pointer-events-none" />

        {/* Top Header - Ultra clean glassmorphic */}
        <div className="relative z-20 px-8 py-6 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/40 bg-white/40 dark:bg-background/40 backdrop-blur-xl">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              统一创作工作区
            </h2>
            <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400 mt-1.5">
              一站式统筹创意、素材、排版与多矩阵分发
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="h-10 px-5 rounded-full bg-white/60 dark:bg-card/60 backdrop-blur-md border-border/80 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all font-medium"
              onClick={onOpenCreateProjectDialog}
            >
              <FolderOpen className="h-4 w-4 mr-2 text-slate-500 dark:text-slate-400" />
              <span className="text-sm">新建项目</span>
            </Button>
            <Button
              className="h-10 px-6 rounded-full bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/10 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 dark:shadow-white/10 transition-all font-semibold"
              onClick={onOpenCreateContentDialog}
              disabled={!selectedProjectId}
            >
              <Plus className="h-4 w-4 mr-2" />
              <span className="text-sm">新建文稿</span>
            </Button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-6 py-8 md:px-12 md:py-12 scroll-smooth">
          <div className="max-w-[1280px] mx-auto">
            {!selectedProjectId ? (
              <div className="rounded-[32px] border border-dashed border-border/60 bg-white/20 dark:bg-card/20 backdrop-blur-md flex flex-col items-center justify-center text-slate-500 gap-6 min-h-[500px] shadow-sm">
                <div className="relative flex items-center justify-center">
                  <div className="absolute inset-0 bg-emerald-400/20 dark:bg-emerald-500/20 blur-2xl rounded-full" />
                  <div className="relative h-20 w-20 rounded-2xl bg-gradient-to-br from-white to-slate-50 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center border border-border/50 shadow-xl">
                    <Sparkles className="h-10 w-10 text-emerald-500 dark:text-emerald-400" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-xl font-bold text-slate-800 dark:text-slate-200">
                    等待唤醒创作引擎
                  </h3>
                  <p className="text-[15px] font-medium text-slate-500 dark:text-slate-400 max-w-[300px]">
                    在左侧选择已有项目，或新建一个项目以开启全新的创作旅程
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-10">
                {/* Stunning Hero Project Overview Card */}
                <div className="group relative rounded-[32px] border border-border/40 bg-white/60 dark:bg-[#111111]/80 p-8 md:p-12 shadow-2xl shadow-slate-200/50 dark:shadow-black/50 overflow-hidden transition-all duration-500 hover:border-border/60 backdrop-blur-xl">
                  {/* Highly Dynamic Animated Meshes */}
                  <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-gradient-to-bl from-emerald-400/20 via-cyan-400/10 to-transparent dark:from-emerald-500/15 dark:via-cyan-600/10 rounded-full blur-[80px] pointer-events-none transition-transform duration-1000 group-hover:scale-110 group-hover:rotate-12" />
                  <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-gradient-to-tr from-violet-400/15 via-pink-400/5 to-transparent dark:from-violet-600/15 dark:via-pink-800/5 rounded-full blur-[80px] pointer-events-none transition-transform duration-1000 group-hover:scale-110 group-hover:-rotate-12" />
                  
                  {/* Subtle Grid Noise Texture (Optional, adds premium feel) */}
                  <div className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] pointer-events-none mix-blend-overlay" />

                  <div className="relative z-10 flex flex-col items-start max-w-3xl">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/50 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold tracking-widest uppercase mb-6 shadow-sm backdrop-blur-md">
                      <FolderOpen className="h-3.5 w-3.5" />
                      {theme === "social-media" ? "社媒矩阵引擎" : "核心项目枢纽"}
                    </div>
                    
                    <h3 className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-500 dark:from-white dark:via-slate-200 dark:to-slate-500 tracking-tight leading-tight mb-5">
                      {selectedProject?.name || "未命名项目"}
                    </h3>
                    
                    <p className="text-base md:text-lg text-slate-600 dark:text-slate-400/90 font-medium leading-relaxed max-w-2xl">
                      {getProjectHeroDescription(selectedProject)}
                    </p>
                  </div>
                </div>

                {/* Highly Polished Modules Grid */}
                <div>
                  <div className="flex items-center gap-3 mb-6 px-2">
                    <div className="h-6 w-1.5 rounded-full bg-gradient-to-b from-emerald-400 to-cyan-500" />
                    <h4 className="text-[17px] font-bold text-slate-900 dark:text-white tracking-wide">
                      创作链路模块
                    </h4>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {navigationItems.map((item) => {
                      const meta = NAV_META[item.key] || {
                        icon: Sparkles,
                        description: `进入 ${item.label} 管理与配置`,
                        colorClass: "text-slate-600 dark:text-slate-400",
                        bgClass: "bg-slate-100 dark:bg-slate-800/60",
                      };
                      const Icon = meta.icon;

                      return (
                        <button
                          key={item.key}
                          onClick={() => onEnterWorkspaceView(item.key)}
                          className="group relative flex flex-col text-left rounded-[28px] bg-white/60 dark:bg-[#151515]/60 border border-border/50 p-6 md:p-7 shadow-sm backdrop-blur-xl transition-all duration-300 hover:shadow-xl hover:shadow-slate-200/50 dark:hover:shadow-black/50 hover:border-slate-300 dark:hover:border-slate-700 hover:-translate-y-1.5 overflow-hidden"
                        >
                          {/* Inner soft glow on hover */}
                          <div className="absolute inset-0 bg-gradient-to-br from-white/60 to-transparent dark:from-white/5 dark:to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                          
                          <div
                            className={`relative h-14 w-14 rounded-[18px] flex items-center justify-center mb-6 transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-inner ${meta.bgClass}`}
                          >
                            <Icon className={`h-6 w-6 ${meta.colorClass}`} />
                          </div>
                          
                          <div className="relative font-bold text-slate-900 dark:text-white text-[19px] mb-2 transition-colors">
                            {item.label}
                          </div>
                          
                          <div className="relative text-[14px] font-medium text-slate-500 dark:text-slate-400/80 leading-relaxed">
                            {meta.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 如果有 PrimaryWorkspaceRenderer 且在 create 视图，优先渲染自定义首页
  const isNovelHomeRenderer =
    Boolean(onQuickCreateNovelEntry) || Boolean(onOpenProjectWriting);
  const shouldRenderPrimaryWorkspace =
    activeWorkspaceView === "create" &&
    PrimaryWorkspaceRenderer &&
    (!isNovelHomeRenderer || !selectedContentId);

  if (shouldRenderPrimaryWorkspace) {
    return (
      <PrimaryWorkspaceRenderer
        projectId={selectedProjectId}
        projectName={selectedProject?.name}
        workspaceType={selectedProject?.workspaceType}
        resetAt={resetAt}
        onBackHome={onBackHome}
        onOpenCreateProjectDialog={onOpenCreateProjectDialog}
        onProjectSelect={(projectId) => {
          // 通过导航更新 URL 参数来选中项目
          if (onNavigate) {
            const url = new URL(window.location.href);
            url.searchParams.set("projectId", projectId);
            onNavigate(theme as any, Object.fromEntries(url.searchParams));
          }
        }}
        onQuickCreateNovelEntry={onQuickCreateNovelEntry}
        onOpenProjectWriting={onOpenProjectWriting}
      />
    );
  }

  if (!selectedProjectId) {
    return (
      <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
        <Sparkles className="h-8 w-8 opacity-60" />
        <p className="text-sm">请先在左侧选择项目</p>
      </div>
    );
  }

  if (activeWorkspaceView === "create" && showCreateContentEntryHome) {
    return (
      <WorkbenchCreateEntryHome
        projectName={selectedProject?.name}
        pendingCreateConfirmation={pendingCreateConfirmation}
        createConfirmationResponse={createConfirmationResponse}
        onOpenCreateContentDialog={onOpenCreateContentDialog}
        onSubmitCreateConfirmation={onSubmitCreateConfirmation}
        onCancelCreateConfirmation={onCancelCreateConfirmation}
      />
    );
  }

  if (activeWorkspaceView === "create" && !selectedContentId) {
    return (
      <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
        <Sparkles className="h-8 w-8 opacity-60" />
        <p className="text-sm">正在打开最近文稿...</p>
      </div>
    );
  }

  if (activeWorkspaceView === "create") {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {workspaceNotice && (
          <div className="border-b px-3 py-2 bg-muted/20 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">{workspaceNotice.message}</div>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenWorkflowView}
              disabled={!selectedProjectId}
            >
              {workspaceNotice.actionLabel || "打开流程视图"}
            </Button>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <AgentChatPage
            key={`${selectedProjectId || ""}:${selectedContentId || ""}:${theme || ""}:workspace`}
            onNavigate={onNavigate}
            projectId={selectedProjectId ?? undefined}
            contentId={selectedContentId ?? undefined}
            theme={theme}
            initialUserPrompt={
              selectedContentId
                ? pendingInitialPromptsByContentId[selectedContentId]
                : undefined
            }
            onInitialUserPromptConsumed={() => {
              if (!selectedContentId) {
                return;
              }
              onConsumePendingInitialPrompt(selectedContentId);
            }}
            initialCreationMode={
              (selectedContentId && contentCreationModes[selectedContentId]) || undefined
            }
            lockTheme={true}
            topBarChrome="workspace-compact"
            showChatPanel={showChatPanel}
            hideInlineStepProgress={true}
            onWorkflowProgressChange={onWorkflowProgressChange}
            onSessionChange={onChatSessionChange}
            preferContentReviewInRightRail={true}
          />
        </div>
      </div>
    );
  }

  if (ActivePanelRenderer) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ActivePanelRenderer
          projectId={selectedProjectId}
          projectName={selectedProject?.name}
          workspaceType={selectedProject?.workspaceType}
          resetAt={resetAt}
          onBackHome={onBackHome}
        />
      </div>
    );
  }

  return (
    <div className="h-full rounded-lg border bg-card flex flex-col items-center justify-center gap-3 text-muted-foreground m-4">
      <Sparkles className="h-8 w-8 opacity-60" />
      <p className="text-sm">当前视图暂未配置</p>
    </div>
  );
}

export default WorkbenchMainContent;
