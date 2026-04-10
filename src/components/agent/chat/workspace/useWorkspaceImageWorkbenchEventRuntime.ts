import { useEffect, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import {
  COVER_IMAGE_REPLACED_EVENT,
  COVER_IMAGE_WORKBENCH_REQUEST_EVENT,
  type CoverImageReplacedDetail,
  type CoverImageWorkbenchRequestDetail,
} from "@/lib/workspace/workbenchCanvas";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import {
  findImageProviderForSelection,
  getImageModelIdsForProvider,
  pickImageModelBySelection,
  type ImageModelPreset,
} from "@/lib/imageGeneration";
import {
  onImageWorkbenchFocus,
  onImageWorkbenchRequest,
  type ImageWorkbenchExternalRequestDetail,
  type ImageWorkbenchFocusDetail,
} from "@/lib/imageWorkbenchEvents";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import type { MessageImage } from "../types";
import {
  buildImageWorkbenchCommandText,
  resolveCoverAspectRatio,
  resolveScopedImageWorkbenchApplyTarget,
  type ImageWorkbenchApplyTarget,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";

interface ImageWorkbenchProviderSummary {
  id: string;
  type: string;
  custom_models?: string[];
  api_host?: string;
}

interface UseWorkspaceImageWorkbenchEventRuntimeParams {
  canvasState: CanvasStateUnion | null;
  projectId?: string;
  contentId?: string | null;
  imageWorkbenchProviders: ImageWorkbenchProviderSummary[];
  setImageWorkbenchSelectedProviderId: (providerId: string) => void;
  setImageWorkbenchSelectedModelId: (modelId: string) => void;
  setImageWorkbenchSelectedSize: (size: string) => void;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  updateCurrentImageWorkbenchState: (
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
  ) => void;
  handleImageWorkbenchCommand: (params: {
    rawText: string;
    parsedCommand: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>;
    images: MessageImage[];
    applyTarget?: ImageWorkbenchApplyTarget | null;
  }) => Promise<boolean>;
}

export function useWorkspaceImageWorkbenchEventRuntime({
  canvasState,
  projectId,
  contentId,
  imageWorkbenchProviders,
  setImageWorkbenchSelectedProviderId,
  setImageWorkbenchSelectedModelId,
  setImageWorkbenchSelectedSize,
  setCanvasState,
  updateCurrentImageWorkbenchState,
  handleImageWorkbenchCommand,
}: UseWorkspaceImageWorkbenchEventRuntimeParams) {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CoverImageWorkbenchRequestDetail>)
        .detail;
      if (!detail?.prompt?.trim()) {
        return;
      }

      const rawText = buildImageWorkbenchCommandText(detail.prompt, {
        aspectRatio:
          canvasState?.type === "document"
            ? resolveCoverAspectRatio(canvasState.platform)
            : resolveCoverAspectRatio(),
      });
      const parsedCommand = parseImageWorkbenchCommand(rawText);
      if (!parsedCommand) {
        toast.error("封面任务初始化失败");
        return;
      }

      void handleImageWorkbenchCommand({
        rawText,
        parsedCommand,
        images: [],
        applyTarget: {
          kind: "document-cover",
          placeholder: detail.placeholder,
          actionLabel: "设为封面",
          successLabel: "已设为封面",
        },
      });
    };

    window.addEventListener(COVER_IMAGE_WORKBENCH_REQUEST_EVENT, handler);
    return () =>
      window.removeEventListener(COVER_IMAGE_WORKBENCH_REQUEST_EVENT, handler);
  }, [canvasState, handleImageWorkbenchCommand]);

  useEffect(() => {
    return onImageWorkbenchRequest(
      (detail: ImageWorkbenchExternalRequestDetail) => {
        if (detail.projectId && detail.projectId !== (projectId ?? null)) {
          return;
        }
        if (detail.contentId && detail.contentId !== (contentId ?? null)) {
          return;
        }
        if (!detail.prompt.trim()) {
          return;
        }

        if (detail.modelPreset) {
          const preferredProvider = findImageProviderForSelection(
            imageWorkbenchProviders,
            detail.modelPreset as ImageModelPreset,
          );
          if (preferredProvider) {
            setImageWorkbenchSelectedProviderId(preferredProvider.id);
            const nextModel = pickImageModelBySelection(
              getImageModelIdsForProvider(
                preferredProvider.id,
                preferredProvider.type,
                preferredProvider.custom_models,
                preferredProvider.api_host,
              ),
              detail.modelPreset as ImageModelPreset,
            );
            if (nextModel) {
              setImageWorkbenchSelectedModelId(nextModel);
            }
          }
        }

        const rawText = buildImageWorkbenchCommandText(detail.prompt, {
          aspectRatio: detail.aspectRatio,
          count: detail.count,
        });
        const parsedCommand = parseImageWorkbenchCommand(rawText);
        if (!parsedCommand) {
          toast.error("图片任务初始化失败");
          return;
        }
        if (parsedCommand.size) {
          setImageWorkbenchSelectedSize(parsedCommand.size);
        }

        void handleImageWorkbenchCommand({
          rawText,
          parsedCommand,
          images: [],
          applyTarget: resolveScopedImageWorkbenchApplyTarget({
            canvasState,
            projectId: projectId ?? null,
            contentId: contentId ?? null,
            requestedTarget: detail.target,
          }),
        });
      },
    );
  }, [
    canvasState,
    contentId,
    handleImageWorkbenchCommand,
    imageWorkbenchProviders,
    projectId,
    setImageWorkbenchSelectedModelId,
    setImageWorkbenchSelectedProviderId,
    setImageWorkbenchSelectedSize,
  ]);

  useEffect(() => {
    return onImageWorkbenchFocus((detail: ImageWorkbenchFocusDetail) => {
      if (detail.projectId && detail.projectId !== (projectId ?? null)) {
        return;
      }
      if (detail.contentId && detail.contentId !== (contentId ?? null)) {
        return;
      }

      updateCurrentImageWorkbenchState((current) => {
        if (current.tasks.length === 0 && current.outputs.length === 0) {
          return current;
        }

        return {
          ...current,
          active: true,
        };
      });
    });
  }, [contentId, projectId, updateCurrentImageWorkbenchState]);

  useEffect(() => {
    const handler = (event: Event) => {
      const { placeholder, imageUrl } = (
        event as CustomEvent<CoverImageReplacedDetail>
      ).detail;
      if (!placeholder || !imageUrl) {
        return;
      }

      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          return previous;
        }

        const updatedContent = previous.content
          .split(placeholder)
          .join(imageUrl);
        if (updatedContent === previous.content) {
          return previous;
        }

        return { ...previous, content: updatedContent };
      });
    };

    window.addEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
    return () =>
      window.removeEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
  }, [setCanvasState]);
}
