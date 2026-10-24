import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useImageGen } from "@/components/image-gen/useImageGen";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { ArtifactDisplayState } from "../hooks/useArtifactDisplayState";
import type { TaskFile } from "../components/TaskFiles";
import type { AgentThreadItem } from "../types";
import type { SessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceImageWorkbenchActionRuntime } from "./useWorkspaceImageWorkbenchActionRuntime";
import {
  useWorkspaceCanvasPreviewRuntime,
  type UseWorkspaceCanvasPreviewRuntimeParams,
  type WorkspaceCanvasPreviewRuntimeResult,
} from "./useWorkspaceCanvasPreviewRuntime";

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
type InputbarScene = Pick<
  ReturnType<typeof useWorkspaceInputbarSceneRuntime>,
  "activeCanvasTaskFile"
>;
type ImageWorkbenchGenerationRuntime = ReturnType<typeof useImageGen>;
type ImageWorkbenchActionRuntime = ReturnType<
  typeof useWorkspaceImageWorkbenchActionRuntime
>;

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
  imageGenerationSelectionReady: CanvasFactoryParams["imageGenerationSelectionReady"];
  imageGenerationSelectionWarning: CanvasFactoryParams["imageGenerationSelectionWarning"];
  sourceThreadId?: string | null;
  onOpenArtifact: ImageWorkbenchParams["onOpenArtifact"];
  providerType: CanvasFactoryParams["autoContinueProviderType"];
  setProviderType: CanvasFactoryParams["onAutoContinueProviderTypeChange"];
  model: CanvasFactoryParams["autoContinueModel"];
  setModel: CanvasFactoryParams["onAutoContinueModelChange"];
  handleDocumentAutoContinueRun: CanvasFactoryParams["onAutoContinueRun"];
  handleAddImage: CanvasFactoryParams["onAddImage"];
  handleImportDocument: CanvasFactoryParams["onImportDocument"];
  handleDocumentContentReviewRun: CanvasFactoryParams["onContentReviewRun"];
  handleDocumentTextStylizeRun: CanvasFactoryParams["onTextStylizeRun"];
  preferContentReviewInRightRail: CanvasFactoryParams["preferContentReviewInRightRail"];
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
  imageGenerationSelectionReady,
  imageGenerationSelectionWarning,
  sourceThreadId,
  onOpenArtifact,
  providerType,
  setProviderType,
  model,
  setModel,
  handleDocumentAutoContinueRun,
  handleAddImage,
  handleImportDocument,
  handleDocumentContentReviewRun,
  handleDocumentTextStylizeRun,
  preferContentReviewInRightRail,
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
        selectedTaskId: currentImageWorkbenchState.selectedTaskId,
        selectedOutputId: currentImageWorkbenchState.selectedOutputId,
        sourceProjectId: projectId,
        sourceContentId: contentId,
        sourceThreadId,
        onOpenArtifact,
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
        onStopGeneration: imageWorkbenchHasPendingTasks
          ? imageWorkbenchActionRuntime.handleStopImageWorkbenchGeneration
          : undefined,
        onViewportChange:
          imageWorkbenchActionRuntime.handleImageWorkbenchViewportChange,
        onSelectOutput:
          imageWorkbenchActionRuntime.handleSelectImageWorkbenchOutput,
        applySelectedOutputLabel:
          imageWorkbenchActionRuntime.imageWorkbenchPrimaryActionLabel,
        onApplySelectedOutput:
          currentImageWorkbenchState.outputs.length > 0
            ? imageWorkbenchActionRuntime.handleApplySelectedImageWorkbenchOutput
            : undefined,
        onRetryTask: imageWorkbenchActionRuntime.handleRetryImageWorkbenchTask,
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
        imageGenerationProviderId:
          imageWorkbenchGenerationRuntime.selectedProviderId,
        imageGenerationModelId: imageWorkbenchGenerationRuntime.selectedModelId,
        imageGenerationSelectionReady,
        imageGenerationSelectionWarning,
        autoContinueProviderType: providerType,
        onAutoContinueProviderTypeChange: setProviderType,
        autoContinueModel: model,
        onAutoContinueModelChange: setModel,
        onAutoContinueRun: handleDocumentAutoContinueRun,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        onContentReviewRun: handleDocumentContentReviewRun,
        onTextStylizeRun: handleDocumentTextStylizeRun,
        preferContentReviewInRightRail,
      },
    },
  });
}
