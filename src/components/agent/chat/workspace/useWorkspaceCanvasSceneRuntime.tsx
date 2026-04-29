import {
  useCallback,
  useMemo,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { ArtifactCanvasOverlay, ArtifactToolbar } from "@/components/artifact";
import { useImageGen } from "@/components/image-gen/useImageGen";
import { CanvasFactory } from "@/lib/workspace/workbenchCanvas";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import {
  CanvasPanel as GeneralCanvasPanel,
  type CanvasState as GeneralCanvasState,
} from "@/components/general-chat/bridge";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import type { Artifact } from "@/lib/artifact/types";
import type { ArtifactDisplayState } from "../hooks/useArtifactDisplayState";
import { ImageTaskViewer } from "../components/ImageTaskViewer";
import { TeamWorkbenchSummaryPanel } from "../components/TeamWorkbenchSummaryPanel";
import { TeamWorkspaceBoard } from "../components/TeamWorkspaceBoard";
import type {
  CanvasWorkbenchHeaderBadge,
  CanvasWorkbenchDefaultPreview,
  CanvasWorkbenchPreviewTarget,
  CanvasWorkbenchSummaryStat,
  CanvasWorkbenchTeamView,
} from "../components/CanvasWorkbenchLayout";
import type { TaskFile } from "../components/TaskFiles";
import {
  ArtifactWorkbenchPreview,
  WorkspaceLiveCanvasPreview,
} from "./workbenchPreview";
import { wrapPreviewWithWorkbenchTrigger } from "./workbenchPreviewHelpers";
import { buildCanvasWorkbenchDefaultPreview } from "./canvasWorkbenchDefaultPreview";
import { resolveAbsoluteWorkspacePath } from "./workspacePath";
import { buildGeneralCanvasStateFromWorkspaceFile } from "./workspaceFilePreview";
import type { SessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import type { TeamWorkbenchSurfaceProps } from "./chatSurfaceProps";
import { hasRenderableGeneralCanvasPreview } from "./generalCanvasPreviewState";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceImageWorkbenchActionRuntime } from "./useWorkspaceImageWorkbenchActionRuntime";
import type { AgentThreadItem } from "../types";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import { summarizeTeamWorkspaceExecution } from "../teamWorkspaceRuntime";
import type {
  TeamWorkspaceActivityEntry,
  TeamWorkspaceControlSummary,
  TeamWorkspaceRuntimeFormationState,
  TeamWorkspaceWaitSummary,
} from "../teamWorkspaceRuntime";

type ArtifactPreviewBaseProps = Omit<
  ComponentProps<typeof ArtifactWorkbenchPreview>,
  "artifact" | "stackedWorkbenchTrigger" | "onArtifactDocumentControllerChange"
>;
type ImageWorkbenchCanvasProps = ComponentProps<typeof ImageTaskViewer>;
type GeneralCanvasPanelProps = Omit<
  ComponentProps<typeof GeneralCanvasPanel>,
  "toolbarActions"
>;
type RenderArtifactWorkbenchPreviewOptions = {
  stackedWorkbenchTrigger?: ReactNode;
  onArtifactDocumentControllerChange?: ComponentProps<
    typeof ArtifactWorkbenchPreview
  >["onArtifactDocumentControllerChange"];
};

interface WorkspaceCanvasDefaultPreviewParams {
  workspaceRoot: string | null;
  canvasRenderTheme: ThemeType;
  generalCanvasState: GeneralCanvasState;
  resolvedCanvasState: CanvasStateUnion | null;
  activeCanvasTaskFile: TaskFile | null;
}

interface WorkspaceCanvasPreviewArtifactParams {
  currentCanvasArtifact: Artifact | null;
  displayedCanvasArtifact: Artifact | null;
  artifactOverlay:
    | ComponentProps<typeof ArtifactCanvasOverlay>["overlay"]
    | null;
  showPreviousVersionBadge: boolean;
  artifactViewMode: ComponentProps<typeof ArtifactToolbar>["viewMode"];
  onArtifactViewModeChange: NonNullable<
    ComponentProps<typeof ArtifactToolbar>["onViewModeChange"]
  >;
  artifactPreviewSize: ComponentProps<typeof ArtifactToolbar>["previewSize"];
  onArtifactPreviewSizeChange: NonNullable<
    ComponentProps<typeof ArtifactToolbar>["onPreviewSizeChange"]
  >;
  onSaveArtifactDocument?: ComponentProps<
    typeof ArtifactWorkbenchPreview
  >["onSaveArtifactDocument"];
  onArtifactBlockRewriteRun?: ComponentProps<
    typeof ArtifactWorkbenchPreview
  >["onArtifactBlockRewriteRun"];
  threadItems?: AgentThreadItem[];
  focusedBlockId?: string | null;
  blockFocusRequestKey?: number;
  onJumpToTimelineItem?: (itemId: string) => void;
  onCloseCanvas: () => void;
  renderToolbarActions?: ComponentProps<
    typeof ArtifactWorkbenchPreview
  >["renderToolbarActions"];
}

interface WorkspaceCanvasPreviewImageWorkbenchParams {
  active: boolean;
  tasks: ImageWorkbenchCanvasProps["tasks"];
  outputs: ImageWorkbenchCanvasProps["outputs"];
  selectedOutputId: ImageWorkbenchCanvasProps["selectedOutputId"];
  sourceProjectId: ImageWorkbenchCanvasProps["sourceProjectId"];
  sourceContentId: ImageWorkbenchCanvasProps["sourceContentId"];
  sourceThreadId: ImageWorkbenchCanvasProps["sourceThreadId"];
  viewport: ImageWorkbenchCanvasProps["viewport"];
  preferenceSummary: ImageWorkbenchCanvasProps["preferenceSummary"];
  preferenceWarning: ImageWorkbenchCanvasProps["preferenceWarning"];
  availableProviders: ImageWorkbenchCanvasProps["availableProviders"];
  selectedProviderId: ImageWorkbenchCanvasProps["selectedProviderId"];
  onProviderChange: ImageWorkbenchCanvasProps["onProviderChange"];
  availableModels: ImageWorkbenchCanvasProps["availableModels"];
  selectedModelId: ImageWorkbenchCanvasProps["selectedModelId"];
  onModelChange: ImageWorkbenchCanvasProps["onModelChange"];
  selectedSize: ImageWorkbenchCanvasProps["selectedSize"];
  onSizeChange: ImageWorkbenchCanvasProps["onSizeChange"];
  generating: ImageWorkbenchCanvasProps["generating"];
  savingToResource: ImageWorkbenchCanvasProps["savingToResource"];
  onStopGeneration: ImageWorkbenchCanvasProps["onStopGeneration"];
  onViewportChange: ImageWorkbenchCanvasProps["onViewportChange"];
  onSelectOutput: ImageWorkbenchCanvasProps["onSelectOutput"];
  onSaveSelectedToLibrary: ImageWorkbenchCanvasProps["onSaveSelectedToLibrary"];
  applySelectedOutputLabel: ImageWorkbenchCanvasProps["applySelectedOutputLabel"];
  onApplySelectedOutput?: ImageWorkbenchCanvasProps["onApplySelectedOutput"];
  onSeedFollowUpCommand: ImageWorkbenchCanvasProps["onSeedFollowUpCommand"];
}

interface WorkspaceCanvasPreviewGeneralCanvasParams {
  state: GeneralCanvasState;
  onCloseCanvas: () => void;
  onContentChange: (content: string) => void;
}

interface WorkspaceCanvasPreviewLoadingParams {
  isInitialContentLoading: boolean;
  initialContentLoadError?: string | null;
  shouldShowCanvasLoadingState: boolean;
}

interface WorkspaceCanvasPreviewFactoryParams {
  canvasRenderTheme: ThemeType;
  resolvedCanvasState: CanvasStateUnion | null;
  onStateChange: ComponentProps<typeof CanvasFactory>["onStateChange"];
  onBackHome: NonNullable<ComponentProps<typeof CanvasFactory>["onBackHome"]>;
  onCloseCanvas: NonNullable<ComponentProps<typeof CanvasFactory>["onClose"]>;
  isStreaming: ComponentProps<typeof CanvasFactory>["isStreaming"];
  onSelectionTextChange: ComponentProps<
    typeof CanvasFactory
  >["onSelectionTextChange"];
  projectId: string | null;
  contentId: string | null;
  autoImageTopic?: string;
  autoContinueProviderType: ComponentProps<
    typeof CanvasFactory
  >["autoContinueProviderType"];
  onAutoContinueProviderTypeChange: ComponentProps<
    typeof CanvasFactory
  >["onAutoContinueProviderTypeChange"];
  autoContinueModel: ComponentProps<typeof CanvasFactory>["autoContinueModel"];
  onAutoContinueModelChange: ComponentProps<
    typeof CanvasFactory
  >["onAutoContinueModelChange"];
  autoContinueThinkingEnabled: boolean;
  onAutoContinueThinkingEnabledChange: NonNullable<
    ComponentProps<typeof CanvasFactory>["onAutoContinueThinkingEnabledChange"]
  >;
  onAutoContinueRun: NonNullable<
    ComponentProps<typeof CanvasFactory>["onAutoContinueRun"]
  >;
  onAddImage: ComponentProps<typeof CanvasFactory>["onAddImage"];
  onImportDocument: ComponentProps<typeof CanvasFactory>["onImportDocument"];
  onContentReviewRun: NonNullable<
    ComponentProps<typeof CanvasFactory>["onContentReviewRun"]
  >;
  onTextStylizeRun: NonNullable<
    ComponentProps<typeof CanvasFactory>["onTextStylizeRun"]
  >;
  preferContentReviewInRightRail: boolean;
}

interface WorkspaceCanvasPreviewTeamWorkbenchParams {
  enabled: boolean;
  surfaceProps: TeamWorkbenchSurfaceProps;
  autoFocusToken?: string | number | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  teamMemorySnapshot?: TeamMemorySnapshot | null;
}

interface UseWorkspaceCanvasPreviewRuntimeParams {
  defaultPreview: WorkspaceCanvasDefaultPreviewParams;
  artifactPreview: WorkspaceCanvasPreviewArtifactParams;
  imageWorkbench: WorkspaceCanvasPreviewImageWorkbenchParams;
  generalCanvas: WorkspaceCanvasPreviewGeneralCanvasParams;
  loading: WorkspaceCanvasPreviewLoadingParams;
  canvasFactory: WorkspaceCanvasPreviewFactoryParams;
  teamWorkbench: WorkspaceCanvasPreviewTeamWorkbenchParams;
}

interface WorkspaceCanvasPreviewRuntimeResult {
  canvasWorkbenchDefaultPreview: CanvasWorkbenchDefaultPreview | null;
  handleOpenCanvasWorkbenchPath: (path: string) => Promise<void>;
  handleRevealCanvasWorkbenchPath: (path: string) => Promise<void>;
  liveCanvasPreview: ReactNode;
  hasLiveCanvasPreviewContent: boolean;
  teamWorkbenchView: CanvasWorkbenchTeamView | null;
  renderCanvasWorkbenchPreview: (
    target: CanvasWorkbenchPreviewTarget,
    options?: { stackedWorkbenchTrigger?: ReactNode },
  ) => ReactNode;
}
interface UseWorkspaceCanvasScenePresentationRuntimeParams {
  shouldBootstrapCanvasOnEntry: boolean;
  normalizedEntryTheme: ThemeType;
  mappedTheme: ThemeType;
  canvasState: CanvasStateUnion | null;
  resolvedCanvasState: CanvasStateUnion | null;
  isInitialContentLoading: boolean;
  initialContentLoadError?: string | null;
  imageWorkbenchProviders: {
    id: string;
    name: string;
  }[];
  activeCanvasTaskFile: TaskFile | null;
  canvasPreviewPresentation: {
    defaultPreview: Omit<
      UseWorkspaceCanvasPreviewRuntimeParams["defaultPreview"],
      "canvasRenderTheme" | "resolvedCanvasState" | "activeCanvasTaskFile"
    >;
    artifactPreview: UseWorkspaceCanvasPreviewRuntimeParams["artifactPreview"];
    imageWorkbench: Omit<
      UseWorkspaceCanvasPreviewRuntimeParams["imageWorkbench"],
      "availableProviders"
    >;
    generalCanvas: UseWorkspaceCanvasPreviewRuntimeParams["generalCanvas"];
    loading: Omit<
      UseWorkspaceCanvasPreviewRuntimeParams["loading"],
      "shouldShowCanvasLoadingState"
    >;
    canvasFactory: Omit<
      UseWorkspaceCanvasPreviewRuntimeParams["canvasFactory"],
      "canvasRenderTheme" | "resolvedCanvasState"
    >;
    teamWorkbench: UseWorkspaceCanvasPreviewRuntimeParams["teamWorkbench"];
  };
}
interface WorkspaceCanvasScenePresentationRuntimeResult extends WorkspaceCanvasPreviewRuntimeResult {
  canvasRenderTheme: ThemeType;
  shouldShowCanvasLoadingState: boolean;
}
type CanvasScenePresentationParams =
  UseWorkspaceCanvasScenePresentationRuntimeParams;
type CanvasPreviewPresentationParams =
  CanvasScenePresentationParams["canvasPreviewPresentation"];
type ArtifactPreviewParams = CanvasPreviewPresentationParams["artifactPreview"];
type ImageWorkbenchParams = CanvasPreviewPresentationParams["imageWorkbench"];
type CanvasFactoryParams = CanvasPreviewPresentationParams["canvasFactory"];
type TeamWorkbenchParams = CanvasPreviewPresentationParams["teamWorkbench"];
type InputbarScene = Pick<
  ReturnType<typeof useWorkspaceInputbarSceneRuntime>,
  "activeCanvasTaskFile" | "teamWorkbenchSurfaceProps"
>;
type ImageWorkbenchGenerationRuntime = ReturnType<typeof useImageGen>;
type ImageWorkbenchActionRuntime = ReturnType<
  typeof useWorkspaceImageWorkbenchActionRuntime
>;

interface ResolveTeamWorkbenchTriggerStateParams {
  enabled: boolean;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  executionSummary: ReturnType<typeof summarizeTeamWorkspaceExecution>;
}

interface BuildCanvasTeamWorkbenchViewParams {
  enabled: boolean;
  surfaceProps: TeamWorkbenchSurfaceProps;
  autoFocusToken?: string | number | null;
  teamDispatchPreviewState?: TeamWorkspaceRuntimeFormationState | null;
  liveActivityBySessionId?: Record<string, TeamWorkspaceActivityEntry[]>;
  teamWaitSummary?: TeamWorkspaceWaitSummary | null;
  teamControlSummary?: TeamWorkspaceControlSummary | null;
  renderTeamWorkbenchPreview: (
    stackedWorkbenchTrigger?: ReactNode,
  ) => ReactNode;
  renderTeamWorkbenchPanel: () => ReactNode;
}

function resolveTeamWorkbenchTriggerState({
  enabled,
  teamDispatchPreviewState,
  liveActivityBySessionId = {},
  teamWaitSummary = null,
  teamControlSummary = null,
  executionSummary,
}: ResolveTeamWorkbenchTriggerStateParams): CanvasWorkbenchTeamView["triggerState"] {
  if (!enabled) {
    return null;
  }

  if (teamDispatchPreviewState?.status === "failed") {
    return { tone: "error", label: "失败" };
  }

  if (teamDispatchPreviewState?.status === "forming") {
    return { tone: "active", label: "组建中" };
  }

  if (executionSummary.runningSessionCount > 0) {
    return {
      tone: "active",
      label:
        executionSummary.runningSessionCount > 1
          ? `${executionSummary.runningSessionCount} 处理中`
          : "处理中",
    };
  }

  if (executionSummary.queuedSessionCount > 0) {
    return {
      tone: "active",
      label:
        executionSummary.queuedSessionCount > 1
          ? `${executionSummary.queuedSessionCount} 稍后开始`
          : "稍后开始",
    };
  }

  if (
    teamDispatchPreviewState?.status === "formed" &&
    executionSummary.totalSessionCount === 0
  ) {
    return { tone: "active", label: "已就绪" };
  }

  if (
    Object.values(liveActivityBySessionId).some(
      (entries) => (entries?.length ?? 0) > 0,
    ) ||
    Boolean(teamWaitSummary) ||
    Boolean(teamControlSummary)
  ) {
    return { tone: "active", label: "有更新" };
  }

  return { tone: "idle", label: null };
}

export function buildCanvasTeamWorkbenchView({
  enabled,
  surfaceProps,
  autoFocusToken,
  teamDispatchPreviewState = null,
  liveActivityBySessionId = {},
  teamWaitSummary = null,
  teamControlSummary = null,
  renderTeamWorkbenchPreview,
  renderTeamWorkbenchPanel,
}: BuildCanvasTeamWorkbenchViewParams): CanvasWorkbenchTeamView | null {
  if (!enabled) {
    return null;
  }

  const dispatchPreviewState =
    teamDispatchPreviewState ?? surfaceProps.teamDispatchPreviewState ?? null;
  const executionSummary = summarizeTeamWorkspaceExecution({
    currentSessionId: surfaceProps.currentSessionId,
    currentSessionRuntimeStatus: surfaceProps.currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus: surfaceProps.currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount: surfaceProps.currentSessionQueuedTurnCount,
    childSubagentSessions: surfaceProps.childSubagentSessions,
    subagentParentContext: surfaceProps.subagentParentContext,
    liveRuntimeBySessionId: surfaceProps.liveRuntimeBySessionId,
  });
  const triggerState = resolveTeamWorkbenchTriggerState({
    enabled,
    teamDispatchPreviewState: dispatchPreviewState,
    liveActivityBySessionId,
    teamWaitSummary,
    teamControlSummary,
    executionSummary,
  });
  const headerBadges: CanvasWorkbenchHeaderBadge[] = [
    {
      key: "team-runtime",
      label: "生成",
      tone: "accent",
    },
  ];

  if (triggerState?.label?.trim()) {
    headerBadges.push({
      key: "team-trigger-state",
      label: triggerState.label.trim(),
      tone: triggerState.tone === "active" ? "accent" : "default",
    });
  }

  if (teamWaitSummary?.awaitedSessionIds?.length) {
    headerBadges.push({
      key: "team-awaiting",
      label: `等待 ${teamWaitSummary.awaitedSessionIds.length}`,
      tone: "default",
    });
  }

  const leadStatus =
    triggerState?.label?.trim() || executionSummary.statusTitle || "待机";
  const leadDetail = executionSummary.statusTitle || "当前没有活跃的任务执行。";
  const summaryStats: CanvasWorkbenchSummaryStat[] = [
    {
      key: "team-status",
      label: "任务状态",
      value: leadStatus,
      detail: leadDetail,
      tone: triggerState?.tone === "active" ? "accent" : "default",
    },
    {
      key: "team-members",
      label: "活跃任务",
      value:
        executionSummary.totalSessionCount > 0
          ? `${executionSummary.activeSessionCount}/${executionSummary.totalSessionCount}`
          : "0",
      detail:
        executionSummary.totalSessionCount > 0
          ? `${executionSummary.runningSessionCount} 项处理中，${executionSummary.queuedSessionCount} 项排队中。`
          : "当前还没有可展示的任务。",
      tone: executionSummary.activeSessionCount > 0 ? "accent" : "default",
    },
  ];

  if (teamWaitSummary?.awaitedSessionIds?.length) {
    summaryStats.push({
      key: "team-awaiting",
      label: "等待确认",
      value: `${teamWaitSummary.awaitedSessionIds.length} 项`,
      detail: teamWaitSummary.timedOut
        ? "等待结果超时，建议重新检查任务状态。"
        : "正在等待任务完成或返回结果。",
      tone: "default",
    });
  } else if (teamControlSummary?.affectedSessionIds?.length) {
    summaryStats.push({
      key: "team-control",
      label: "最近控制",
      value:
        teamControlSummary.action === "resume"
          ? "继续处理"
          : teamControlSummary.action === "close_completed"
            ? "收起已完成"
            : "暂停处理",
      detail: `影响 ${teamControlSummary.affectedSessionIds.length} 个会话。`,
      tone: "default",
    });
  }

  return {
    enabled: true,
    title:
      dispatchPreviewState?.label?.trim() ||
      dispatchPreviewState?.blueprint?.label?.trim() ||
      surfaceProps.selectedTeamLabel ||
      "生成",
    tabLabel: surfaceProps.selectedTeamLabel?.trim() || undefined,
    tabBadge: triggerState?.label?.trim() || undefined,
    tabBadgeTone:
      triggerState?.tone === "error"
        ? "rose"
        : triggerState?.tone === "active"
          ? "sky"
          : "slate",
    subtitle: "主对话保留调度记录，画布按任务分别展示执行过程与结果。",
    autoFocusToken,
    preferFixedPanel: true,
    triggerState,
    badges: headerBadges,
    summaryStats,
    panelCopy: {
      emptyText: "当前没有可展示的生成结果。",
    },
    renderPreview: (options?: { stackedWorkbenchTrigger?: ReactNode }) =>
      renderTeamWorkbenchPreview(options?.stackedWorkbenchTrigger),
    renderPanel: renderTeamWorkbenchPanel,
  };
}

function useWorkspaceCanvasPreviewRuntime({
  defaultPreview,
  artifactPreview,
  imageWorkbench,
  generalCanvas,
  loading,
  canvasFactory,
  teamWorkbench,
}: UseWorkspaceCanvasPreviewRuntimeParams): WorkspaceCanvasPreviewRuntimeResult {
  const canvasWorkbenchDefaultPreview = useMemo(
    () =>
      buildCanvasWorkbenchDefaultPreview({
        workspaceRoot: defaultPreview.workspaceRoot,
        canvasRenderTheme: defaultPreview.canvasRenderTheme,
        generalCanvasState: defaultPreview.generalCanvasState,
        resolvedCanvasState: defaultPreview.resolvedCanvasState,
        activeCanvasTaskFile: defaultPreview.activeCanvasTaskFile,
      }),
    [
      defaultPreview.activeCanvasTaskFile,
      defaultPreview.canvasRenderTheme,
      defaultPreview.generalCanvasState,
      defaultPreview.resolvedCanvasState,
      defaultPreview.workspaceRoot,
    ],
  );

  const handleOpenCanvasWorkbenchPath = useCallback(async (path: string) => {
    try {
      await openPathWithDefaultApp(path);
    } catch (error) {
      toast.error(
        `打开文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const handleRevealCanvasWorkbenchPath = useCallback(async (path: string) => {
    try {
      await revealPathInFinder(path);
    } catch (error) {
      toast.error(
        `定位文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const artifactWorkbenchPreviewBaseProps = useMemo<ArtifactPreviewBaseProps>(
    () => ({
      currentCanvasArtifact: artifactPreview.currentCanvasArtifact,
      displayedCanvasArtifact: artifactPreview.displayedCanvasArtifact,
      artifactOverlay: artifactPreview.artifactOverlay,
      showPreviousVersionBadge: artifactPreview.showPreviousVersionBadge,
      artifactViewMode: artifactPreview.artifactViewMode,
      onArtifactViewModeChange: artifactPreview.onArtifactViewModeChange,
      artifactPreviewSize: artifactPreview.artifactPreviewSize,
      onArtifactPreviewSizeChange: artifactPreview.onArtifactPreviewSizeChange,
      onSaveArtifactDocument: artifactPreview.onSaveArtifactDocument,
      onArtifactBlockRewriteRun: artifactPreview.onArtifactBlockRewriteRun,
      threadItems: artifactPreview.threadItems,
      focusedBlockId: artifactPreview.focusedBlockId,
      blockFocusRequestKey: artifactPreview.blockFocusRequestKey,
      onJumpToTimelineItem: artifactPreview.onJumpToTimelineItem,
      onCloseCanvas: artifactPreview.onCloseCanvas,
      renderToolbarActions: artifactPreview.renderToolbarActions,
    }),
    [
      artifactPreview.artifactOverlay,
      artifactPreview.artifactPreviewSize,
      artifactPreview.artifactViewMode,
      artifactPreview.blockFocusRequestKey,
      artifactPreview.currentCanvasArtifact,
      artifactPreview.displayedCanvasArtifact,
      artifactPreview.focusedBlockId,
      artifactPreview.onArtifactBlockRewriteRun,
      artifactPreview.onArtifactPreviewSizeChange,
      artifactPreview.onArtifactViewModeChange,
      artifactPreview.onCloseCanvas,
      artifactPreview.onJumpToTimelineItem,
      artifactPreview.onSaveArtifactDocument,
      artifactPreview.renderToolbarActions,
      artifactPreview.showPreviousVersionBadge,
      artifactPreview.threadItems,
    ],
  );

  const imageWorkbenchCanvasProps = useMemo<ImageWorkbenchCanvasProps>(
    () => ({
      tasks: imageWorkbench.tasks,
      outputs: imageWorkbench.outputs,
      selectedOutputId: imageWorkbench.selectedOutputId,
      sourceProjectId: imageWorkbench.sourceProjectId,
      sourceContentId: imageWorkbench.sourceContentId,
      sourceThreadId: imageWorkbench.sourceThreadId,
      viewport: imageWorkbench.viewport,
      preferenceSummary: imageWorkbench.preferenceSummary,
      preferenceWarning: imageWorkbench.preferenceWarning,
      availableProviders: imageWorkbench.availableProviders,
      selectedProviderId: imageWorkbench.selectedProviderId,
      onProviderChange: imageWorkbench.onProviderChange,
      availableModels: imageWorkbench.availableModels,
      selectedModelId: imageWorkbench.selectedModelId,
      onModelChange: imageWorkbench.onModelChange,
      selectedSize: imageWorkbench.selectedSize,
      onSizeChange: imageWorkbench.onSizeChange,
      generating: imageWorkbench.generating,
      savingToResource: imageWorkbench.savingToResource,
      onStopGeneration: imageWorkbench.onStopGeneration,
      onViewportChange: imageWorkbench.onViewportChange,
      onSelectOutput: imageWorkbench.onSelectOutput,
      onSaveSelectedToLibrary: imageWorkbench.onSaveSelectedToLibrary,
      applySelectedOutputLabel: imageWorkbench.applySelectedOutputLabel,
      onApplySelectedOutput: imageWorkbench.onApplySelectedOutput,
      onSeedFollowUpCommand: imageWorkbench.onSeedFollowUpCommand,
    }),
    [
      imageWorkbench.applySelectedOutputLabel,
      imageWorkbench.availableModels,
      imageWorkbench.availableProviders,
      imageWorkbench.generating,
      imageWorkbench.onApplySelectedOutput,
      imageWorkbench.onModelChange,
      imageWorkbench.onProviderChange,
      imageWorkbench.onSaveSelectedToLibrary,
      imageWorkbench.onSeedFollowUpCommand,
      imageWorkbench.onSelectOutput,
      imageWorkbench.onSizeChange,
      imageWorkbench.onStopGeneration,
      imageWorkbench.onViewportChange,
      imageWorkbench.outputs,
      imageWorkbench.preferenceSummary,
      imageWorkbench.preferenceWarning,
      imageWorkbench.savingToResource,
      imageWorkbench.sourceContentId,
      imageWorkbench.sourceProjectId,
      imageWorkbench.sourceThreadId,
      imageWorkbench.selectedModelId,
      imageWorkbench.selectedOutputId,
      imageWorkbench.selectedProviderId,
      imageWorkbench.selectedSize,
      imageWorkbench.tasks,
      imageWorkbench.viewport,
    ],
  );

  const generalCanvasPanelProps = useMemo<GeneralCanvasPanelProps>(
    () => ({
      state: generalCanvas.state,
      baseFilePath: resolveAbsoluteWorkspacePath(
        defaultPreview.workspaceRoot,
        generalCanvas.state.filename,
      ),
      onClose: generalCanvas.onCloseCanvas,
      onContentChange: generalCanvas.onContentChange,
    }),
    [
      defaultPreview.workspaceRoot,
      generalCanvas.onCloseCanvas,
      generalCanvas.onContentChange,
      generalCanvas.state,
    ],
  );

  const canvasLoadingLabel = useMemo(
    () =>
      loading.isInitialContentLoading
        ? "正在加载文稿内容..."
        : loading.initialContentLoadError || "正在准备文稿画布...",
    [loading.initialContentLoadError, loading.isInitialContentLoading],
  );

  const canvasFactoryProps = useMemo<ComponentProps<
    typeof CanvasFactory
  > | null>(
    () =>
      canvasFactory.resolvedCanvasState
        ? {
            theme: canvasFactory.canvasRenderTheme,
            state: canvasFactory.resolvedCanvasState,
            onStateChange: canvasFactory.onStateChange,
            onBackHome: canvasFactory.onBackHome,
            onClose: canvasFactory.onCloseCanvas,
            isStreaming: canvasFactory.isStreaming,
            onSelectionTextChange: canvasFactory.onSelectionTextChange,
            projectId: canvasFactory.projectId,
            contentId: canvasFactory.contentId,
            autoImageTopic: canvasFactory.autoImageTopic,
            autoContinueProviderType: canvasFactory.autoContinueProviderType,
            onAutoContinueProviderTypeChange:
              canvasFactory.onAutoContinueProviderTypeChange,
            autoContinueModel: canvasFactory.autoContinueModel,
            onAutoContinueModelChange: canvasFactory.onAutoContinueModelChange,
            autoContinueThinkingEnabled:
              canvasFactory.autoContinueThinkingEnabled,
            onAutoContinueThinkingEnabledChange:
              canvasFactory.onAutoContinueThinkingEnabledChange,
            onAutoContinueRun: canvasFactory.onAutoContinueRun,
            onAddImage: canvasFactory.onAddImage,
            onImportDocument: canvasFactory.onImportDocument,
            onContentReviewRun: canvasFactory.onContentReviewRun,
            onTextStylizeRun: canvasFactory.onTextStylizeRun,
            documentContentReviewPlacement:
              canvasFactory.preferContentReviewInRightRail
                ? ("external-rail" as const)
                : ("inline" as const),
          }
        : null,
    [
      canvasFactory.autoContinueModel,
      canvasFactory.autoContinueProviderType,
      canvasFactory.autoContinueThinkingEnabled,
      canvasFactory.autoImageTopic,
      canvasFactory.canvasRenderTheme,
      canvasFactory.contentId,
      canvasFactory.isStreaming,
      canvasFactory.onAddImage,
      canvasFactory.onAutoContinueModelChange,
      canvasFactory.onAutoContinueProviderTypeChange,
      canvasFactory.onAutoContinueRun,
      canvasFactory.onAutoContinueThinkingEnabledChange,
      canvasFactory.onBackHome,
      canvasFactory.onCloseCanvas,
      canvasFactory.onContentReviewRun,
      canvasFactory.onImportDocument,
      canvasFactory.onSelectionTextChange,
      canvasFactory.onStateChange,
      canvasFactory.onTextStylizeRun,
      canvasFactory.preferContentReviewInRightRail,
      canvasFactory.projectId,
      canvasFactory.resolvedCanvasState,
    ],
  );

  const renderArtifactWorkbenchPreview = useCallback(
    (artifact: Artifact, options?: RenderArtifactWorkbenchPreviewOptions) => (
      <ArtifactWorkbenchPreview
        {...artifactWorkbenchPreviewBaseProps}
        artifact={artifact}
        stackedWorkbenchTrigger={options?.stackedWorkbenchTrigger}
        onArtifactDocumentControllerChange={
          options?.onArtifactDocumentControllerChange
        }
      />
    ),
    [artifactWorkbenchPreviewBaseProps],
  );

  const hasLiveCanvasPreviewContent = useMemo(() => {
    if (imageWorkbench.active) {
      return true;
    }

    if (defaultPreview.canvasRenderTheme === "general") {
      return Boolean(
        (artifactPreview.currentCanvasArtifact &&
          artifactPreview.displayedCanvasArtifact) ||
        hasRenderableGeneralCanvasPreview(defaultPreview.generalCanvasState),
      );
    }

    return Boolean(
      loading.shouldShowCanvasLoadingState ||
      defaultPreview.resolvedCanvasState,
    );
  }, [
    artifactPreview.currentCanvasArtifact,
    artifactPreview.displayedCanvasArtifact,
    defaultPreview.canvasRenderTheme,
    defaultPreview.generalCanvasState,
    defaultPreview.resolvedCanvasState,
    imageWorkbench.active,
    loading.shouldShowCanvasLoadingState,
  ]);

  const renderLiveCanvasPreview = useCallback(
    (stackedWorkbenchTrigger?: ReactNode) =>
      hasLiveCanvasPreviewContent ? (
        <WorkspaceLiveCanvasPreview
          currentImageWorkbenchActive={imageWorkbench.active}
          imageWorkbenchProps={imageWorkbenchCanvasProps}
          onCloseCanvas={artifactPreview.onCloseCanvas}
          canvasRenderTheme={defaultPreview.canvasRenderTheme}
          liveArtifact={artifactPreview.currentCanvasArtifact}
          hasDisplayedLiveArtifact={Boolean(
            artifactPreview.displayedCanvasArtifact,
          )}
          renderArtifactPreview={renderArtifactWorkbenchPreview}
          generalCanvasPanelProps={generalCanvasPanelProps}
          shouldShowCanvasLoadingState={loading.shouldShowCanvasLoadingState}
          canvasLoadingLabel={canvasLoadingLabel}
          canvasFactoryProps={canvasFactoryProps}
          stackedWorkbenchTrigger={stackedWorkbenchTrigger}
        />
      ) : null,
    [
      artifactPreview.currentCanvasArtifact,
      artifactPreview.displayedCanvasArtifact,
      artifactPreview.onCloseCanvas,
      canvasFactoryProps,
      canvasLoadingLabel,
      defaultPreview.canvasRenderTheme,
      generalCanvasPanelProps,
      hasLiveCanvasPreviewContent,
      imageWorkbench.active,
      imageWorkbenchCanvasProps,
      loading.shouldShowCanvasLoadingState,
      renderArtifactWorkbenchPreview,
    ],
  );

  const renderGeneralCanvasPreviewTarget = useCallback(
    (
      target: Extract<CanvasWorkbenchPreviewTarget, { kind: "default-canvas" }>,
      stackedWorkbenchTrigger?: ReactNode,
    ) => (
      <GeneralCanvasPanel
        state={buildGeneralCanvasStateFromWorkspaceFile(
          target.filePath || target.title,
          target.content,
        )}
        baseFilePath={
          target.absolutePath ||
          resolveAbsoluteWorkspacePath(
            defaultPreview.workspaceRoot,
            target.filePath,
          )
        }
        onClose={artifactPreview.onCloseCanvas}
        onContentChange={generalCanvas.onContentChange}
        chrome="embedded"
        toolbarActions={stackedWorkbenchTrigger}
      />
    ),
    [
      artifactPreview.onCloseCanvas,
      defaultPreview.workspaceRoot,
      generalCanvas.onContentChange,
    ],
  );

  const teamWorkbenchBoardProps = useMemo<
    ComponentProps<typeof TeamWorkspaceBoard>
  >(
    () => ({
      ...teamWorkbench.surfaceProps,
      embedded: true,
      defaultShellExpanded: true,
    }),
    [teamWorkbench.surfaceProps],
  );

  const renderTeamWorkbenchPreview = useCallback(
    (stackedWorkbenchTrigger?: ReactNode) =>
      wrapPreviewWithWorkbenchTrigger(
        <div className="flex h-full min-h-0 flex-col overflow-hidden pt-4">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <TeamWorkspaceBoard {...teamWorkbenchBoardProps} />
          </div>
        </div>,
        stackedWorkbenchTrigger,
      ),
    [teamWorkbenchBoardProps],
  );

  const teamWorkbenchSummaryPanelProps = useMemo<
    ComponentProps<typeof TeamWorkbenchSummaryPanel>
  >(
    () => ({
      currentSessionId: teamWorkbench.surfaceProps.currentSessionId,
      currentSessionRuntimeStatus:
        teamWorkbench.surfaceProps.currentSessionRuntimeStatus,
      currentSessionLatestTurnStatus:
        teamWorkbench.surfaceProps.currentSessionLatestTurnStatus,
      currentSessionQueuedTurnCount:
        teamWorkbench.surfaceProps.currentSessionQueuedTurnCount,
      childSubagentSessions: teamWorkbench.surfaceProps.childSubagentSessions,
      subagentParentContext: teamWorkbench.surfaceProps.subagentParentContext,
      liveRuntimeBySessionId: teamWorkbench.surfaceProps.liveRuntimeBySessionId,
      liveActivityBySessionId: teamWorkbench.liveActivityBySessionId,
      teamWaitSummary: teamWorkbench.teamWaitSummary,
      teamControlSummary: teamWorkbench.teamControlSummary,
      selectedTeamLabel: teamWorkbench.surfaceProps.selectedTeamLabel,
      selectedTeamSummary: teamWorkbench.surfaceProps.selectedTeamSummary,
      selectedTeamRoles: teamWorkbench.surfaceProps.selectedTeamRoles,
      teamDispatchPreviewState:
        teamWorkbench.teamDispatchPreviewState ??
        teamWorkbench.surfaceProps.teamDispatchPreviewState,
      teamMemorySnapshot: teamWorkbench.teamMemorySnapshot,
    }),
    [
      teamWorkbench.liveActivityBySessionId,
      teamWorkbench.surfaceProps.childSubagentSessions,
      teamWorkbench.surfaceProps.currentSessionId,
      teamWorkbench.surfaceProps.currentSessionLatestTurnStatus,
      teamWorkbench.surfaceProps.currentSessionQueuedTurnCount,
      teamWorkbench.surfaceProps.currentSessionRuntimeStatus,
      teamWorkbench.surfaceProps.liveRuntimeBySessionId,
      teamWorkbench.surfaceProps.selectedTeamLabel,
      teamWorkbench.surfaceProps.selectedTeamRoles,
      teamWorkbench.surfaceProps.selectedTeamSummary,
      teamWorkbench.surfaceProps.subagentParentContext,
      teamWorkbench.surfaceProps.teamDispatchPreviewState,
      teamWorkbench.teamControlSummary,
      teamWorkbench.teamDispatchPreviewState,
      teamWorkbench.teamMemorySnapshot,
      teamWorkbench.teamWaitSummary,
    ],
  );

  const teamWorkbenchSummaryPanel = useMemo(
    () => <TeamWorkbenchSummaryPanel {...teamWorkbenchSummaryPanelProps} />,
    [teamWorkbenchSummaryPanelProps],
  );

  const teamWorkbenchView = useMemo(
    () =>
      buildCanvasTeamWorkbenchView({
        enabled: teamWorkbench.enabled,
        surfaceProps: teamWorkbench.surfaceProps,
        autoFocusToken: teamWorkbench.autoFocusToken,
        teamDispatchPreviewState: teamWorkbench.teamDispatchPreviewState,
        liveActivityBySessionId: teamWorkbench.liveActivityBySessionId,
        teamWaitSummary: teamWorkbench.teamWaitSummary,
        teamControlSummary: teamWorkbench.teamControlSummary,
        renderTeamWorkbenchPreview,
        renderTeamWorkbenchPanel: () => teamWorkbenchSummaryPanel,
      }),
    [
      renderTeamWorkbenchPreview,
      teamWorkbench.autoFocusToken,
      teamWorkbench.enabled,
      teamWorkbench.liveActivityBySessionId,
      teamWorkbench.surfaceProps,
      teamWorkbench.teamControlSummary,
      teamWorkbench.teamDispatchPreviewState,
      teamWorkbench.teamWaitSummary,
      teamWorkbenchSummaryPanel,
    ],
  );

  const renderCanvasWorkbenchPreview = useCallback(
    (
      target: CanvasWorkbenchPreviewTarget,
      options?: {
        stackedWorkbenchTrigger?: ReactNode;
      },
    ) => {
      const stackedWorkbenchTrigger = options?.stackedWorkbenchTrigger;
      const renderWorkbenchStatePreview = (
        kind: "loading" | "unsupported" | "empty",
        text: string,
      ) =>
        wrapPreviewWithWorkbenchTrigger(
          <div
            data-testid={`canvas-workbench-preview-${kind}`}
            className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-6 text-sm text-slate-500"
          >
            {text}
          </div>,
          stackedWorkbenchTrigger,
        );

      switch (target.kind) {
        case "default-canvas":
          return renderGeneralCanvasPreviewTarget(
            target,
            stackedWorkbenchTrigger,
          );
        case "artifact":
        case "synthetic-artifact":
          return renderArtifactWorkbenchPreview(target.artifact, {
            stackedWorkbenchTrigger,
          });
        case "loading":
          return renderWorkbenchStatePreview("loading", "正在准备预览...");
        case "unsupported":
          return renderWorkbenchStatePreview("unsupported", target.reason);
        case "empty":
          return renderWorkbenchStatePreview("empty", "暂无可预览内容");
        case "team-workbench":
          return renderTeamWorkbenchPreview(stackedWorkbenchTrigger);
        default:
          return null;
      }
    },
    [
      renderArtifactWorkbenchPreview,
      renderGeneralCanvasPreviewTarget,
      renderTeamWorkbenchPreview,
    ],
  );

  return {
    canvasWorkbenchDefaultPreview,
    handleOpenCanvasWorkbenchPath,
    handleRevealCanvasWorkbenchPath,
    liveCanvasPreview: renderLiveCanvasPreview(),
    hasLiveCanvasPreviewContent,
    teamWorkbenchView,
    renderCanvasWorkbenchPreview,
  };
}

function useWorkspaceCanvasScenePresentationRuntime({
  shouldBootstrapCanvasOnEntry,
  normalizedEntryTheme,
  mappedTheme,
  canvasState,
  resolvedCanvasState,
  isInitialContentLoading,
  initialContentLoadError,
  imageWorkbenchProviders,
  activeCanvasTaskFile,
  canvasPreviewPresentation,
}: UseWorkspaceCanvasScenePresentationRuntimeParams): WorkspaceCanvasScenePresentationRuntimeResult {
  const canvasRenderTheme = useMemo(
    () =>
      (shouldBootstrapCanvasOnEntry
        ? normalizedEntryTheme
        : mappedTheme) as ThemeType,
    [mappedTheme, normalizedEntryTheme, shouldBootstrapCanvasOnEntry],
  );

  const shouldShowCanvasLoadingState = useMemo(
    () =>
      (!canvasState &&
        (shouldBootstrapCanvasOnEntry ||
          isInitialContentLoading ||
          Boolean(initialContentLoadError))) ||
      (resolvedCanvasState?.type === "document" &&
        !resolvedCanvasState.content.trim() &&
        (isInitialContentLoading || Boolean(initialContentLoadError))),
    [
      canvasState,
      initialContentLoadError,
      isInitialContentLoading,
      resolvedCanvasState,
      shouldBootstrapCanvasOnEntry,
    ],
  );

  const canvasPreviewImageWorkbenchProviders = useMemo(
    () =>
      imageWorkbenchProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
      })),
    [imageWorkbenchProviders],
  );

  const previewPresentation = useWorkspaceCanvasPreviewRuntime({
    defaultPreview: {
      ...canvasPreviewPresentation.defaultPreview,
      canvasRenderTheme,
      resolvedCanvasState,
      activeCanvasTaskFile,
    },
    artifactPreview: canvasPreviewPresentation.artifactPreview,
    imageWorkbench: {
      ...canvasPreviewPresentation.imageWorkbench,
      availableProviders: canvasPreviewImageWorkbenchProviders,
    },
    generalCanvas: canvasPreviewPresentation.generalCanvas,
    loading: {
      ...canvasPreviewPresentation.loading,
      shouldShowCanvasLoadingState,
    },
    canvasFactory: {
      ...canvasPreviewPresentation.canvasFactory,
      canvasRenderTheme,
      resolvedCanvasState,
    },
    teamWorkbench: canvasPreviewPresentation.teamWorkbench,
  });

  return {
    canvasRenderTheme,
    shouldShowCanvasLoadingState,
    ...previewPresentation,
  };
}

interface UseWorkspaceCanvasSceneRuntimeParams {
  shouldBootstrapCanvasOnEntry: CanvasScenePresentationParams["shouldBootstrapCanvasOnEntry"];
  normalizedEntryTheme: CanvasScenePresentationParams["normalizedEntryTheme"];
  mappedTheme: CanvasScenePresentationParams["mappedTheme"];
  canvasState: CanvasScenePresentationParams["canvasState"];
  resolvedCanvasState: CanvasScenePresentationParams["resolvedCanvasState"];
  isInitialContentLoading: CanvasScenePresentationParams["isInitialContentLoading"];
  initialContentLoadError: CanvasScenePresentationParams["initialContentLoadError"];
  imageWorkbenchGenerationRuntime: ImageWorkbenchGenerationRuntime;
  imageWorkbenchActionRuntime: ImageWorkbenchActionRuntime;
  inputbarScene: InputbarScene;
  projectRootPath: CanvasPreviewPresentationParams["defaultPreview"]["workspaceRoot"];
  generalCanvasState: CanvasPreviewPresentationParams["defaultPreview"]["generalCanvasState"];
  setGeneralCanvasState: Dispatch<
    SetStateAction<
      CanvasPreviewPresentationParams["defaultPreview"]["generalCanvasState"]
    >
  >;
  currentCanvasArtifact: ArtifactPreviewParams["currentCanvasArtifact"];
  displayedCanvasArtifact: ArtifactPreviewParams["displayedCanvasArtifact"];
  artifactDisplayState: Pick<
    ArtifactDisplayState,
    "overlay" | "showPreviousVersionBadge"
  >;
  artifactViewMode: ArtifactPreviewParams["artifactViewMode"];
  setArtifactViewMode: ArtifactPreviewParams["onArtifactViewModeChange"];
  artifactPreviewSize: ArtifactPreviewParams["artifactPreviewSize"];
  setArtifactPreviewSize: ArtifactPreviewParams["onArtifactPreviewSizeChange"];
  onSaveArtifactDocument: ArtifactPreviewParams["onSaveArtifactDocument"];
  onArtifactBlockRewriteRun: ArtifactPreviewParams["onArtifactBlockRewriteRun"];
  renderArtifactWorkbenchToolbarActions: ArtifactPreviewParams["renderToolbarActions"];
  threadItems: AgentThreadItem[];
  focusedBlockId: string | null;
  blockFocusRequestKey: number;
  onJumpToTimelineItem: (itemId: string) => void;
  handleCloseCanvas: ArtifactPreviewParams["onCloseCanvas"];
  currentImageWorkbenchState: SessionImageWorkbenchState;
  imageWorkbenchPreferenceSummary: ImageWorkbenchParams["preferenceSummary"];
  imageWorkbenchPreferenceWarning: ImageWorkbenchParams["preferenceWarning"];
  setCanvasState: CanvasFactoryParams["onStateChange"];
  handleBackHome: CanvasFactoryParams["onBackHome"];
  isSending: CanvasFactoryParams["isStreaming"];
  handleCanvasSelectionTextChange: CanvasFactoryParams["onSelectionTextChange"];
  projectId: CanvasFactoryParams["projectId"];
  contentId: CanvasFactoryParams["contentId"];
  sourceThreadId?: string | null;
  projectName?: CanvasFactoryParams["autoImageTopic"];
  providerType: CanvasFactoryParams["autoContinueProviderType"];
  setProviderType: CanvasFactoryParams["onAutoContinueProviderTypeChange"];
  model: CanvasFactoryParams["autoContinueModel"];
  setModel: CanvasFactoryParams["onAutoContinueModelChange"];
  documentThinkingEnabled: CanvasFactoryParams["autoContinueThinkingEnabled"];
  handleDocumentThinkingEnabledChange: CanvasFactoryParams["onAutoContinueThinkingEnabledChange"];
  handleDocumentAutoContinueRun: CanvasFactoryParams["onAutoContinueRun"];
  handleAddImage: CanvasFactoryParams["onAddImage"];
  handleImportDocument: CanvasFactoryParams["onImportDocument"];
  handleDocumentContentReviewRun: CanvasFactoryParams["onContentReviewRun"];
  handleDocumentTextStylizeRun: CanvasFactoryParams["onTextStylizeRun"];
  preferContentReviewInRightRail: CanvasFactoryParams["preferContentReviewInRightRail"];
  teamWorkspaceEnabled: TeamWorkbenchParams["enabled"];
  liveActivityBySessionId: NonNullable<
    TeamWorkbenchParams["liveActivityBySessionId"]
  >;
  teamWaitSummary: TeamWorkbenchParams["teamWaitSummary"];
  teamControlSummary: TeamWorkbenchParams["teamControlSummary"];
  teamWorkbenchAutoFocusToken: TeamWorkbenchParams["autoFocusToken"];
  teamDispatchPreviewState: TeamWorkbenchParams["teamDispatchPreviewState"];
  teamMemorySnapshot: TeamWorkbenchParams["teamMemorySnapshot"];
}

export function useWorkspaceCanvasSceneRuntime({
  shouldBootstrapCanvasOnEntry,
  normalizedEntryTheme,
  mappedTheme,
  canvasState,
  resolvedCanvasState,
  isInitialContentLoading,
  initialContentLoadError,
  imageWorkbenchGenerationRuntime,
  imageWorkbenchActionRuntime,
  inputbarScene,
  projectRootPath,
  generalCanvasState,
  setGeneralCanvasState,
  currentCanvasArtifact,
  displayedCanvasArtifact,
  artifactDisplayState,
  artifactViewMode,
  setArtifactViewMode,
  artifactPreviewSize,
  setArtifactPreviewSize,
  onSaveArtifactDocument,
  onArtifactBlockRewriteRun,
  renderArtifactWorkbenchToolbarActions,
  threadItems,
  focusedBlockId,
  blockFocusRequestKey,
  onJumpToTimelineItem,
  handleCloseCanvas,
  currentImageWorkbenchState,
  imageWorkbenchPreferenceSummary,
  imageWorkbenchPreferenceWarning,
  setCanvasState,
  handleBackHome,
  isSending,
  handleCanvasSelectionTextChange,
  projectId,
  contentId,
  sourceThreadId,
  projectName,
  providerType,
  setProviderType,
  model,
  setModel,
  documentThinkingEnabled,
  handleDocumentThinkingEnabledChange,
  handleDocumentAutoContinueRun,
  handleAddImage,
  handleImportDocument,
  handleDocumentContentReviewRun,
  handleDocumentTextStylizeRun,
  preferContentReviewInRightRail,
  teamWorkspaceEnabled,
  liveActivityBySessionId,
  teamWaitSummary,
  teamControlSummary,
  teamWorkbenchAutoFocusToken,
  teamDispatchPreviewState,
  teamMemorySnapshot,
}: UseWorkspaceCanvasSceneRuntimeParams) {
  const imageWorkbenchHasPendingTasks = currentImageWorkbenchState.tasks.some(
    (task) =>
      task.status === "queued" ||
      task.status === "routing" ||
      task.status === "running",
  );

  return useWorkspaceCanvasScenePresentationRuntime({
    shouldBootstrapCanvasOnEntry,
    normalizedEntryTheme,
    mappedTheme,
    canvasState,
    resolvedCanvasState,
    isInitialContentLoading,
    initialContentLoadError,
    imageWorkbenchProviders:
      imageWorkbenchGenerationRuntime.availableProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
      })),
    activeCanvasTaskFile: inputbarScene.activeCanvasTaskFile,
    canvasPreviewPresentation: {
      defaultPreview: {
        workspaceRoot: projectRootPath,
        generalCanvasState,
      },
      artifactPreview: {
        currentCanvasArtifact,
        displayedCanvasArtifact,
        artifactOverlay: artifactDisplayState.overlay,
        showPreviousVersionBadge: artifactDisplayState.showPreviousVersionBadge,
        artifactViewMode,
        onArtifactViewModeChange: setArtifactViewMode,
        artifactPreviewSize,
        onArtifactPreviewSizeChange: setArtifactPreviewSize,
        onSaveArtifactDocument,
        onArtifactBlockRewriteRun,
        renderToolbarActions: renderArtifactWorkbenchToolbarActions,
        threadItems,
        focusedBlockId,
        blockFocusRequestKey,
        onJumpToTimelineItem,
        onCloseCanvas: handleCloseCanvas,
      },
      imageWorkbench: {
        active: currentImageWorkbenchState.active,
        tasks: currentImageWorkbenchState.tasks,
        outputs: currentImageWorkbenchState.outputs,
        selectedOutputId: currentImageWorkbenchState.selectedOutputId,
        sourceProjectId: projectId,
        sourceContentId: contentId,
        sourceThreadId,
        viewport: currentImageWorkbenchState.viewport,
        preferenceSummary: imageWorkbenchPreferenceSummary,
        preferenceWarning: imageWorkbenchPreferenceWarning,
        selectedProviderId: imageWorkbenchGenerationRuntime.selectedProviderId,
        onProviderChange: imageWorkbenchGenerationRuntime.setSelectedProviderId,
        availableModels: imageWorkbenchGenerationRuntime.availableModels,
        selectedModelId: imageWorkbenchGenerationRuntime.selectedModelId,
        onModelChange: imageWorkbenchGenerationRuntime.setSelectedModelId,
        selectedSize: imageWorkbenchGenerationRuntime.selectedSize,
        onSizeChange: imageWorkbenchGenerationRuntime.setSelectedSize,
        generating: imageWorkbenchHasPendingTasks,
        savingToResource: imageWorkbenchGenerationRuntime.savingToResource,
        onStopGeneration: imageWorkbenchHasPendingTasks
          ? imageWorkbenchActionRuntime.handleStopImageWorkbenchGeneration
          : undefined,
        onViewportChange:
          imageWorkbenchActionRuntime.handleImageWorkbenchViewportChange,
        onSelectOutput:
          imageWorkbenchActionRuntime.handleSelectImageWorkbenchOutput,
        onSaveSelectedToLibrary:
          imageWorkbenchActionRuntime.handleSaveSelectedImageWorkbenchOutput,
        applySelectedOutputLabel:
          imageWorkbenchActionRuntime.imageWorkbenchPrimaryActionLabel,
        onApplySelectedOutput:
          currentImageWorkbenchState.outputs.length > 0
            ? imageWorkbenchActionRuntime.handleApplySelectedImageWorkbenchOutput
            : undefined,
        onSeedFollowUpCommand:
          imageWorkbenchActionRuntime.handleSeedImageWorkbenchFollowUp,
      },
      generalCanvas: {
        state: generalCanvasState,
        onCloseCanvas: handleCloseCanvas,
        onContentChange: (content: string) =>
          setGeneralCanvasState((previous) => ({ ...previous, content })),
      },
      loading: {
        isInitialContentLoading,
        initialContentLoadError,
      },
      canvasFactory: {
        onStateChange: setCanvasState,
        onBackHome: handleBackHome,
        onCloseCanvas: handleCloseCanvas,
        isStreaming: isSending,
        onSelectionTextChange: handleCanvasSelectionTextChange,
        projectId,
        contentId,
        autoImageTopic: projectName,
        autoContinueProviderType: providerType,
        onAutoContinueProviderTypeChange: setProviderType,
        autoContinueModel: model,
        onAutoContinueModelChange: setModel,
        autoContinueThinkingEnabled: documentThinkingEnabled,
        onAutoContinueThinkingEnabledChange:
          handleDocumentThinkingEnabledChange,
        onAutoContinueRun: handleDocumentAutoContinueRun,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        onContentReviewRun: handleDocumentContentReviewRun,
        onTextStylizeRun: handleDocumentTextStylizeRun,
        preferContentReviewInRightRail,
      },
      teamWorkbench: {
        enabled: teamWorkspaceEnabled,
        surfaceProps: inputbarScene.teamWorkbenchSurfaceProps,
        autoFocusToken: teamWorkbenchAutoFocusToken,
        teamDispatchPreviewState,
        liveActivityBySessionId,
        teamWaitSummary,
        teamControlSummary,
        teamMemorySnapshot,
      },
    },
  });
}
