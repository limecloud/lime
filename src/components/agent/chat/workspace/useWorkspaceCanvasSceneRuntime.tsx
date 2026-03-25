import type { Dispatch, SetStateAction } from "react";
import { useImageGen } from "@/components/image-gen/useImageGen";
import type { ArtifactDisplayState } from "../hooks/useArtifactDisplayState";
import type { SessionImageWorkbenchState } from "./imageWorkbenchHelpers";
import { useWorkspaceCanvasScenePresentation } from "./useWorkspaceCanvasScenePresentation";
import { useWorkspaceInputbarSceneRuntime } from "./useWorkspaceInputbarSceneRuntime";
import { useWorkspaceImageWorkbenchActionRuntime } from "./useWorkspaceImageWorkbenchActionRuntime";
import { useWorkspaceTeamSessionControlRuntime } from "./useWorkspaceTeamSessionControlRuntime";
import { useWorkspaceTeamSessionRuntime } from "./useWorkspaceTeamSessionRuntime";
import type { AgentThreadItem } from "../types";

type CanvasScenePresentationParams = Parameters<
  typeof useWorkspaceCanvasScenePresentation
>[0];
type CanvasPreviewPresentationParams =
  CanvasScenePresentationParams["canvasPreviewPresentation"];
type ArtifactPreviewParams = CanvasPreviewPresentationParams["artifactPreview"];
type ImageWorkbenchParams = CanvasPreviewPresentationParams["imageWorkbench"];
type CanvasFactoryParams = CanvasPreviewPresentationParams["canvasFactory"];
type TeamWorkbenchParams = CanvasPreviewPresentationParams["teamWorkbench"];
type InputbarScene = ReturnType<typeof useWorkspaceInputbarSceneRuntime>;
type ImageWorkbenchGenerationRuntime = ReturnType<typeof useImageGen>;
type ImageWorkbenchActionRuntime = ReturnType<
  typeof useWorkspaceImageWorkbenchActionRuntime
>;
type TeamSessionRuntime = ReturnType<typeof useWorkspaceTeamSessionRuntime>;
type TeamSessionControlRuntime = ReturnType<
  typeof useWorkspaceTeamSessionControlRuntime
>;

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
    SetStateAction<CanvasPreviewPresentationParams["defaultPreview"]["generalCanvasState"]>
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
  novelChapterListCollapsed: CanvasFactoryParams["novelChapterListCollapsed"];
  setNovelChapterListCollapsed: CanvasFactoryParams["onNovelChapterListCollapsedChange"];
  teamSessionRuntime: TeamSessionRuntime;
  teamSessionControlRuntime: TeamSessionControlRuntime;
  teamWorkbenchAutoFocusToken: TeamWorkbenchParams["autoFocusToken"];
  teamDispatchPreviewState: TeamWorkbenchParams["teamDispatchPreviewState"];
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
  novelChapterListCollapsed,
  setNovelChapterListCollapsed,
  teamSessionRuntime,
  teamSessionControlRuntime,
  teamWorkbenchAutoFocusToken,
  teamDispatchPreviewState,
}: UseWorkspaceCanvasSceneRuntimeParams) {
  return useWorkspaceCanvasScenePresentation({
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
        showPreviousVersionBadge:
          artifactDisplayState.showPreviousVersionBadge,
        artifactViewMode,
        onArtifactViewModeChange: setArtifactViewMode,
        artifactPreviewSize,
        onArtifactPreviewSizeChange: setArtifactPreviewSize,
        onSaveArtifactDocument,
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
        generating: imageWorkbenchGenerationRuntime.generating,
        savingToResource: imageWorkbenchGenerationRuntime.savingToResource,
        onStopGeneration:
          imageWorkbenchActionRuntime.handleStopImageWorkbenchGeneration,
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
        onOpenImage: imageWorkbenchActionRuntime.handleOpenImageWorkbenchAsset,
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
        novelChapterListCollapsed,
        onNovelChapterListCollapsedChange: setNovelChapterListCollapsed,
      },
      teamWorkbench: {
        enabled: teamSessionRuntime.showTeamWorkspaceBoard,
        surfaceProps: inputbarScene.teamWorkbenchSurfaceProps,
        hasRealTeamGraph: teamSessionRuntime.hasRealTeamGraph,
        autoFocusToken: teamWorkbenchAutoFocusToken,
        teamDispatchPreviewState,
        liveActivityBySessionId: teamSessionRuntime.liveActivityBySessionId,
        teamWaitSummary: teamSessionControlRuntime.teamWaitSummary,
        teamControlSummary: teamSessionControlRuntime.teamControlSummary,
      },
    },
  });
}
