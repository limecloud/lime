import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ArtifactCanvasOverlay, ArtifactToolbar } from "@/components/artifact";
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
import { ImageWorkbenchCanvas } from "../components/ImageWorkbenchCanvas";
import type {
  CanvasWorkbenchDefaultPreview,
  CanvasWorkbenchPreviewTarget,
  CanvasWorkbenchTeamView,
} from "../components/CanvasWorkbenchLayout";
import type { TaskFile } from "../components/TaskFiles";
import type { AgentThreadItem } from "../types";
import {
  ArtifactWorkbenchPreview,
  WorkspaceLiveCanvasPreview,
} from "./workbenchPreview";
import {
  renderCanvasWorkbenchPreviewTarget,
  type RenderArtifactWorkbenchPreviewOptions,
} from "./workbenchPreviewHelpers";
import { buildCanvasWorkbenchDefaultPreview } from "./canvasWorkbenchDefaultPreview";
import {
  useTeamWorkbenchPresentation,
  type TeamWorkbenchSurfaceProps,
  type UseTeamWorkbenchPresentationParams,
} from "./teamWorkbenchPresentation";
import { hasRenderableGeneralCanvasPreview } from "./generalCanvasPreviewState";

type ArtifactPreviewBaseProps = Omit<
  ComponentProps<typeof ArtifactWorkbenchPreview>,
  | "artifact"
  | "stackedWorkbenchTrigger"
  | "onArtifactDocumentControllerChange"
>;
type ImageWorkbenchCanvasProps = ComponentProps<typeof ImageWorkbenchCanvas>;
type GeneralCanvasPanelProps = Omit<
  ComponentProps<typeof GeneralCanvasPanel>,
  "toolbarActions"
>;

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
  onOpenImage: ImageWorkbenchCanvasProps["onOpenImage"];
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
  novelChapterListCollapsed: boolean;
  onNovelChapterListCollapsedChange: (collapsed: boolean) => void;
}

interface WorkspaceCanvasPreviewTeamWorkbenchParams extends Omit<
  UseTeamWorkbenchPresentationParams,
  "surfaceProps"
> {
  surfaceProps: TeamWorkbenchSurfaceProps;
}

interface UseWorkspaceCanvasPreviewPresentationParams {
  defaultPreview: WorkspaceCanvasDefaultPreviewParams;
  artifactPreview: WorkspaceCanvasPreviewArtifactParams;
  imageWorkbench: WorkspaceCanvasPreviewImageWorkbenchParams;
  generalCanvas: WorkspaceCanvasPreviewGeneralCanvasParams;
  loading: WorkspaceCanvasPreviewLoadingParams;
  canvasFactory: WorkspaceCanvasPreviewFactoryParams;
  teamWorkbench: WorkspaceCanvasPreviewTeamWorkbenchParams;
}

interface WorkspaceCanvasPreviewPresentationResult {
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

export function useWorkspaceCanvasPreviewPresentation({
  defaultPreview,
  artifactPreview,
  imageWorkbench,
  generalCanvas,
  loading,
  canvasFactory,
  teamWorkbench,
}: UseWorkspaceCanvasPreviewPresentationParams): WorkspaceCanvasPreviewPresentationResult {
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
      artifactPreview.onArtifactPreviewSizeChange,
      artifactPreview.onSaveArtifactDocument,
      artifactPreview.onArtifactViewModeChange,
      artifactPreview.onJumpToTimelineItem,
      artifactPreview.onCloseCanvas,
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
      onOpenImage: imageWorkbench.onOpenImage,
    }),
    [
      imageWorkbench.applySelectedOutputLabel,
      imageWorkbench.availableModels,
      imageWorkbench.availableProviders,
      imageWorkbench.generating,
      imageWorkbench.onApplySelectedOutput,
      imageWorkbench.onModelChange,
      imageWorkbench.onOpenImage,
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
      onClose: generalCanvas.onCloseCanvas,
      onContentChange: generalCanvas.onContentChange,
    }),
    [
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
            novelControls:
              canvasFactory.resolvedCanvasState.type === "novel"
                ? {
                    useExternalToolbar: true,
                    chapterListCollapsed:
                      canvasFactory.novelChapterListCollapsed,
                    onChapterListCollapsedChange:
                      canvasFactory.onNovelChapterListCollapsedChange,
                  }
                : null,
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
      canvasFactory.novelChapterListCollapsed,
      canvasFactory.onAddImage,
      canvasFactory.onAutoContinueModelChange,
      canvasFactory.onAutoContinueProviderTypeChange,
      canvasFactory.onAutoContinueRun,
      canvasFactory.onAutoContinueThinkingEnabledChange,
      canvasFactory.onBackHome,
      canvasFactory.onCloseCanvas,
      canvasFactory.onContentReviewRun,
      canvasFactory.onImportDocument,
      canvasFactory.onNovelChapterListCollapsedChange,
      canvasFactory.onSelectionTextChange,
      canvasFactory.onStateChange,
      canvasFactory.onTextStylizeRun,
      canvasFactory.preferContentReviewInRightRail,
      canvasFactory.projectId,
      canvasFactory.resolvedCanvasState,
    ],
  );

  const renderArtifactWorkbenchPreview = useCallback(
    (
      artifact: Artifact,
      options?: RenderArtifactWorkbenchPreviewOptions,
    ) => (
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

  const { renderTeamWorkbenchPreview, teamWorkbenchView } =
    useTeamWorkbenchPresentation({
      enabled: teamWorkbench.enabled,
      surfaceProps: teamWorkbench.surfaceProps,
      hasRealTeamGraph: teamWorkbench.hasRealTeamGraph,
      autoFocusToken: teamWorkbench.autoFocusToken,
      teamDispatchPreviewState: teamWorkbench.teamDispatchPreviewState,
      liveActivityBySessionId: teamWorkbench.liveActivityBySessionId,
      teamWaitSummary: teamWorkbench.teamWaitSummary,
      teamControlSummary: teamWorkbench.teamControlSummary,
    });

  const renderCanvasWorkbenchPreview = useCallback(
    (
      target: CanvasWorkbenchPreviewTarget,
      options?: {
        stackedWorkbenchTrigger?: ReactNode;
      },
    ) =>
      renderCanvasWorkbenchPreviewTarget({
        target,
        stackedWorkbenchTrigger: options?.stackedWorkbenchTrigger,
        renderDefaultCanvasPreview: renderLiveCanvasPreview,
        renderArtifactPreview: renderArtifactWorkbenchPreview,
        renderTeamWorkbenchPreview,
      }),
    [
      renderArtifactWorkbenchPreview,
      renderLiveCanvasPreview,
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
