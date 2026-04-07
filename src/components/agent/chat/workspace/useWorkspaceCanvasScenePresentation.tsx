import { useMemo } from "react";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { ThemeType } from "@/lib/workspace/workbenchContract";
import type { TaskFile } from "../components/TaskFiles";
import { useWorkspaceCanvasPreviewPresentation } from "./useWorkspaceCanvasPreviewPresentation";

type WorkspaceCanvasPreviewPresentationParams = Parameters<
  typeof useWorkspaceCanvasPreviewPresentation
>[0];

interface CanvasPreviewProviderSummary {
  id: string;
  name: string;
}

interface UseWorkspaceCanvasScenePresentationParams {
  shouldBootstrapCanvasOnEntry: boolean;
  normalizedEntryTheme: ThemeType;
  mappedTheme: ThemeType;
  canvasState: CanvasStateUnion | null;
  resolvedCanvasState: CanvasStateUnion | null;
  isInitialContentLoading: boolean;
  initialContentLoadError?: string | null;
  imageWorkbenchProviders: CanvasPreviewProviderSummary[];
  activeCanvasTaskFile: TaskFile | null;
  canvasPreviewPresentation: {
    defaultPreview: Omit<
      WorkspaceCanvasPreviewPresentationParams["defaultPreview"],
      "canvasRenderTheme" | "resolvedCanvasState" | "activeCanvasTaskFile"
    >;
    artifactPreview: WorkspaceCanvasPreviewPresentationParams["artifactPreview"];
    imageWorkbench: Omit<
      WorkspaceCanvasPreviewPresentationParams["imageWorkbench"],
      "availableProviders"
    >;
    generalCanvas: WorkspaceCanvasPreviewPresentationParams["generalCanvas"];
    loading: Omit<
      WorkspaceCanvasPreviewPresentationParams["loading"],
      "shouldShowCanvasLoadingState"
    >;
    canvasFactory: Omit<
      WorkspaceCanvasPreviewPresentationParams["canvasFactory"],
      "canvasRenderTheme" | "resolvedCanvasState"
    >;
    teamWorkbench: WorkspaceCanvasPreviewPresentationParams["teamWorkbench"];
  };
}

interface WorkspaceCanvasScenePresentationResult extends ReturnType<
  typeof useWorkspaceCanvasPreviewPresentation
> {
  canvasRenderTheme: ThemeType;
  shouldShowCanvasLoadingState: boolean;
}

export function useWorkspaceCanvasScenePresentation({
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
}: UseWorkspaceCanvasScenePresentationParams): WorkspaceCanvasScenePresentationResult {
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

  const previewPresentation = useWorkspaceCanvasPreviewPresentation({
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
