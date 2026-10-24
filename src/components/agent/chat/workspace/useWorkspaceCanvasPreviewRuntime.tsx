import {
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ArtifactCanvasOverlay, ArtifactToolbar } from "@/components/artifact";
import { CanvasFactory } from "@/components/workspace/canvas/CanvasFactory";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
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
import { ImageTaskViewer } from "../components/ImageTaskViewer";
import type { CanvasWorkbenchDefaultPreview } from "../components/CanvasWorkbenchLayout";
import { type FilePreviewTarget } from "./filePreviewTarget";

import type { TaskFile } from "../components/TaskFiles";
import type { AgentThreadItem } from "../types";
import {
  ArtifactWorkbenchPreview,
  WorkspaceLiveCanvasPreview,
} from "./workbenchPreview";
import { wrapPreviewWithWorkbenchTrigger } from "./workbenchPreviewHelpers";
import { buildCanvasWorkbenchDefaultPreview } from "./canvasWorkbenchDefaultPreview";
import { resolveAbsoluteWorkspacePath } from "./workspacePath";
import { buildGeneralCanvasStateFromWorkspaceFile } from "./workspaceFilePreview";

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
  selectedTaskId: ImageWorkbenchCanvasProps["selectedTaskId"];
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
  onStopGeneration: ImageWorkbenchCanvasProps["onStopGeneration"];
  onViewportChange: ImageWorkbenchCanvasProps["onViewportChange"];
  onSelectOutput: ImageWorkbenchCanvasProps["onSelectOutput"];
  onOpenArtifact: ImageWorkbenchCanvasProps["onOpenArtifact"];
  applySelectedOutputLabel: ImageWorkbenchCanvasProps["applySelectedOutputLabel"];
  onApplySelectedOutput?: ImageWorkbenchCanvasProps["onApplySelectedOutput"];
  onRetryTask: ImageWorkbenchCanvasProps["onRetryTask"];
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
  imageGenerationProviderId: ComponentProps<
    typeof CanvasFactory
  >["imageGenerationProviderId"];
  imageGenerationModelId: ComponentProps<
    typeof CanvasFactory
  >["imageGenerationModelId"];
  imageGenerationSelectionReady: ComponentProps<
    typeof CanvasFactory
  >["imageGenerationSelectionReady"];
  imageGenerationSelectionWarning: ComponentProps<
    typeof CanvasFactory
  >["imageGenerationSelectionWarning"];
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

export interface UseWorkspaceCanvasPreviewRuntimeParams {
  defaultPreview: WorkspaceCanvasDefaultPreviewParams;
  artifactPreview: WorkspaceCanvasPreviewArtifactParams;
  imageWorkbench: WorkspaceCanvasPreviewImageWorkbenchParams;
  generalCanvas: WorkspaceCanvasPreviewGeneralCanvasParams;
  loading: WorkspaceCanvasPreviewLoadingParams;
  canvasFactory: WorkspaceCanvasPreviewFactoryParams;
}

export interface WorkspaceCanvasPreviewRuntimeResult {
  canvasWorkbenchDefaultPreview: CanvasWorkbenchDefaultPreview | null;
  handleOpenCanvasWorkbenchPath: (path: string) => Promise<void>;
  handleRevealCanvasWorkbenchPath: (path: string) => Promise<void>;
  handleCloseCanvasWorkbench: () => void;
  liveCanvasPreview: ReactNode;
  hasLiveCanvasPreviewContent: boolean;
  renderCanvasWorkbenchPreview: (
    target: FilePreviewTarget,
    options?: { stackedWorkbenchTrigger?: ReactNode },
  ) => ReactNode;
}

export function useWorkspaceCanvasPreviewRuntime({
  defaultPreview,
  artifactPreview,
  imageWorkbench,
  generalCanvas,
  loading,
  canvasFactory,
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
      canvasFactoryProps: {
        projectRootPath: defaultPreview.workspaceRoot,
        projectId: canvasFactory.projectId,
        contentId: canvasFactory.contentId,
        imageGenerationProviderId: canvasFactory.imageGenerationProviderId,
        imageGenerationModelId: canvasFactory.imageGenerationModelId,
        imageGenerationSelectionReady:
          canvasFactory.imageGenerationSelectionReady,
        imageGenerationSelectionWarning:
          canvasFactory.imageGenerationSelectionWarning,
      },
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
      canvasFactory.contentId,
      canvasFactory.imageGenerationModelId,
      canvasFactory.imageGenerationProviderId,
      canvasFactory.imageGenerationSelectionReady,
      canvasFactory.imageGenerationSelectionWarning,
      canvasFactory.projectId,
      defaultPreview.workspaceRoot,
    ],
  );

  const imageWorkbenchCanvasProps = useMemo<ImageWorkbenchCanvasProps>(
    () => ({
      tasks: imageWorkbench.tasks,
      outputs: imageWorkbench.outputs,
      selectedTaskId: imageWorkbench.selectedTaskId,
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
      onStopGeneration: imageWorkbench.onStopGeneration,
      onViewportChange: imageWorkbench.onViewportChange,
      onSelectOutput: imageWorkbench.onSelectOutput,
      onOpenArtifact: imageWorkbench.onOpenArtifact,
      applySelectedOutputLabel: imageWorkbench.applySelectedOutputLabel,
      onApplySelectedOutput: imageWorkbench.onApplySelectedOutput,
      onRetryTask: imageWorkbench.onRetryTask,
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
      imageWorkbench.onRetryTask,
      imageWorkbench.onOpenArtifact,
      imageWorkbench.onSeedFollowUpCommand,
      imageWorkbench.onSelectOutput,
      imageWorkbench.onSizeChange,
      imageWorkbench.onStopGeneration,
      imageWorkbench.onViewportChange,
      imageWorkbench.outputs,
      imageWorkbench.preferenceSummary,
      imageWorkbench.preferenceWarning,
      imageWorkbench.sourceContentId,
      imageWorkbench.sourceProjectId,
      imageWorkbench.sourceThreadId,
      imageWorkbench.selectedTaskId,
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
        generalCanvas.state.sourcePath || generalCanvas.state.filename,
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
            projectRootPath: defaultPreview.workspaceRoot,
            imageGenerationProviderId: canvasFactory.imageGenerationProviderId,
            imageGenerationModelId: canvasFactory.imageGenerationModelId,
            imageGenerationSelectionReady:
              canvasFactory.imageGenerationSelectionReady,
            imageGenerationSelectionWarning:
              canvasFactory.imageGenerationSelectionWarning,
            autoContinueProviderType: canvasFactory.autoContinueProviderType,
            onAutoContinueProviderTypeChange:
              canvasFactory.onAutoContinueProviderTypeChange,
            autoContinueModel: canvasFactory.autoContinueModel,
            onAutoContinueModelChange: canvasFactory.onAutoContinueModelChange,
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
      canvasFactory.canvasRenderTheme,
      canvasFactory.contentId,
      canvasFactory.imageGenerationModelId,
      canvasFactory.imageGenerationProviderId,
      canvasFactory.imageGenerationSelectionReady,
      canvasFactory.imageGenerationSelectionWarning,
      canvasFactory.isStreaming,
      canvasFactory.onAddImage,
      canvasFactory.onAutoContinueModelChange,
      canvasFactory.onAutoContinueProviderTypeChange,
      canvasFactory.onAutoContinueRun,
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
      defaultPreview.workspaceRoot,
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
        defaultPreview.generalCanvasState.isOpen,
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
    defaultPreview.generalCanvasState.isOpen,
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
      target: Extract<FilePreviewTarget, { kind: "text" }>,
      stackedWorkbenchTrigger?: ReactNode,
    ) => (
      <GeneralCanvasPanel
        state={buildGeneralCanvasStateFromWorkspaceFile(
          target.filePath || target.title,
          target.content,
          {
            sourcePath:
              target.absolutePath ||
              resolveAbsoluteWorkspacePath(
                defaultPreview.workspaceRoot,
                target.filePath,
              ),
          },
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

  const renderCanvasWorkbenchPreview = useCallback(
    (
      target: FilePreviewTarget,
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
        case "text":
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
        default:
          return null;
      }
    },
    [renderArtifactWorkbenchPreview, renderGeneralCanvasPreviewTarget],
  );

  return {
    canvasWorkbenchDefaultPreview,
    handleOpenCanvasWorkbenchPath,
    handleRevealCanvasWorkbenchPath,
    handleCloseCanvasWorkbench: artifactPreview.onCloseCanvas,
    liveCanvasPreview: renderLiveCanvasPreview(),
    hasLiveCanvasPreviewContent,
    renderCanvasWorkbenchPreview,
  };
}
