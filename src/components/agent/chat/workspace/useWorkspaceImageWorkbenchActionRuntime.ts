import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { Character } from "@/lib/api/memory";
import type { CreateImageGenerationTaskArtifactRequest } from "@/lib/api/mediaTasks";
import { emitCanvasImageInsertRequest } from "@/lib/canvasImageInsertBus";
import type { Message, MessageImage } from "../types";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  collapseWhitespace,
  resolveImageWorkbenchActionLabel,
  type ImageWorkbenchApplyTarget,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";

interface SaveImagesToResourceResult {
  saved: number;
  skipped: number;
  errors: string[];
}

interface UseWorkspaceImageWorkbenchActionRuntimeParams {
  appendLocalDispatchMessages: (messages: Message[]) => void;
  contentId?: string | null;
  createImageGenerationTask: (
    request: CreateImageGenerationTaskArtifactRequest,
  ) => Promise<unknown>;
  currentImageWorkbenchState: SessionImageWorkbenchState;
  imageWorkbenchSelectedModelId?: string;
  imageWorkbenchSelectedProviderId?: string;
  imageWorkbenchSelectedSize: string;
  imageWorkbenchSessionKey: string;
  projectId?: string;
  projectRootPath?: string | null;
  saveImageWorkbenchImagesToResource: (
    imageIds: string[],
    targetProjectId: string,
  ) => Promise<SaveImagesToResourceResult>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  setMentionedCharacters: Dispatch<SetStateAction<Character[]>>;
  updateCurrentImageWorkbenchState: (
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
  ) => void;
}

function dedupeReferenceImages(values: Array<string | undefined>): string[] {
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }
    normalized.push(trimmed);
  }
  return normalized;
}

export function useWorkspaceImageWorkbenchActionRuntime({
  appendLocalDispatchMessages,
  contentId,
  createImageGenerationTask,
  currentImageWorkbenchState,
  imageWorkbenchSelectedModelId,
  imageWorkbenchSelectedProviderId,
  imageWorkbenchSelectedSize,
  imageWorkbenchSessionKey,
  projectId,
  projectRootPath,
  saveImageWorkbenchImagesToResource,
  setCanvasState,
  setInput,
  setLayoutMode,
  setMentionedCharacters,
  updateCurrentImageWorkbenchState,
}: UseWorkspaceImageWorkbenchActionRuntimeParams) {
  const handleImageWorkbenchViewportChange = useCallback(
    (viewport: SessionImageWorkbenchState["viewport"]) => {
      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: true,
        viewport,
      }));
    },
    [updateCurrentImageWorkbenchState],
  );

  const handleSelectImageWorkbenchOutput = useCallback(
    (outputId: string) => {
      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: true,
        selectedOutputId: outputId,
      }));
    },
    [updateCurrentImageWorkbenchState],
  );

  const handleSeedImageWorkbenchFollowUp = useCallback(
    (command: string) => {
      setInput(command);
      toast.info("已在输入框填入配图命令");
    },
    [setInput],
  );

  const handleOpenImageWorkbenchAsset = useCallback((url: string) => {
    if (!url.trim()) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleStopImageWorkbenchGeneration = useCallback(() => {
    toast.info("异步图片任务已进入队列，当前版本暂不支持前端直接取消");
  }, []);

  const handleSaveSelectedImageWorkbenchOutput = useCallback(async () => {
    const selectedOutput = currentImageWorkbenchState.outputs.find(
      (item) => item.id === currentImageWorkbenchState.selectedOutputId,
    );
    if (!selectedOutput) {
      toast.info("请先选择一张图片");
      return;
    }
    if (!projectId) {
      toast.error("请先选择项目后再保存到素材库");
      return;
    }

    const result = await saveImageWorkbenchImagesToResource(
      [selectedOutput.hookImageId],
      projectId,
    );
    if (result.saved > 0) {
      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        outputs: current.outputs.map((item) =>
          item.id === selectedOutput.id
            ? { ...item, resourceSaved: true }
            : item,
        ),
      }));
      toast.success("已保存到素材库");
      return;
    }

    if (result.skipped > 0) {
      toast.info("该图片已在当前素材库中");
      return;
    }

    toast.error(result.errors[0] || "保存到素材库失败");
  }, [
    currentImageWorkbenchState.outputs,
    currentImageWorkbenchState.selectedOutputId,
    projectId,
    saveImageWorkbenchImagesToResource,
    updateCurrentImageWorkbenchState,
  ]);

  const handleApplySelectedImageWorkbenchOutput = useCallback(() => {
    const selectedOutput = currentImageWorkbenchState.outputs.find(
      (item) => item.id === currentImageWorkbenchState.selectedOutputId,
    );
    if (!selectedOutput) {
      toast.info("请先选择一张图片");
      return;
    }

    const applyTarget = selectedOutput.applyTarget;
    if (!applyTarget) {
      toast.info("当前结果还没有绑定落位目标");
      return;
    }

    if (applyTarget.kind === "document-cover") {
      let replaced = false;
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          return previous;
        }

        const updatedContent = previous.content
          .split(applyTarget.placeholder)
          .join(selectedOutput.url);
        if (updatedContent === previous.content) {
          return previous;
        }

        replaced = true;
        return {
          ...previous,
          content: updatedContent,
        };
      });

      if (!replaced) {
        toast.error("未找到待替换的封面占位");
        return;
      }

      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: false,
      }));
      setLayoutMode("chat-canvas");
      toast.success(applyTarget.successLabel);
      return;
    }

    emitCanvasImageInsertRequest({
      projectId: applyTarget.projectId ?? projectId ?? null,
      contentId: applyTarget.contentId ?? contentId ?? null,
      canvasType: applyTarget.canvasType,
      anchorHint: applyTarget.anchorHint,
      source: "manual",
      image: {
        id: selectedOutput.id,
        previewUrl: selectedOutput.url,
        contentUrl: selectedOutput.url,
        title: collapseWhitespace(selectedOutput.prompt) || selectedOutput.refId,
        provider: selectedOutput.providerName,
      },
    });

    updateCurrentImageWorkbenchState((current) => ({
      ...current,
      active: false,
    }));
    setLayoutMode("chat-canvas");
    toast.info(applyTarget.dispatchLabel);
  }, [
    contentId,
    currentImageWorkbenchState.outputs,
    currentImageWorkbenchState.selectedOutputId,
    projectId,
    setCanvasState,
    setLayoutMode,
    updateCurrentImageWorkbenchState,
  ]);

  const imageWorkbenchPrimaryActionLabel = useMemo(() => {
    const selectedOutput = currentImageWorkbenchState.outputs.find(
      (item) => item.id === currentImageWorkbenchState.selectedOutputId,
    );
    return resolveImageWorkbenchActionLabel(selectedOutput?.applyTarget);
  }, [
    currentImageWorkbenchState.outputs,
    currentImageWorkbenchState.selectedOutputId,
  ]);

  const handleImageWorkbenchCommand = useCallback(
    async (params: {
      rawText: string;
      parsedCommand: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>;
      images: MessageImage[];
      applyTarget?: ImageWorkbenchApplyTarget | null;
    }): Promise<boolean> => {
      if (!projectId) {
        toast.error("请先选择项目后再开始配图");
        return false;
      }
      if (!projectRootPath?.trim()) {
        toast.error("当前项目目录未就绪，暂时无法创建图片任务");
        return false;
      }

      const { rawText, parsedCommand, images } = params;
      const targetOutput = parsedCommand.targetRef
        ? currentImageWorkbenchState.outputs.find(
            (item) =>
              item.refId.toLowerCase() ===
              parsedCommand.targetRef?.toLowerCase(),
          ) || null
        : null;
      const effectiveApplyTarget =
        params.applyTarget ?? targetOutput?.applyTarget ?? null;

      if (
        (parsedCommand.mode === "edit" || parsedCommand.mode === "variation") &&
        !targetOutput &&
        images.length === 0
      ) {
        toast.error("编辑或变体任务需要选择已有图片，或先附加参考图");
        return false;
      }

      const effectivePrompt =
        parsedCommand.prompt.trim() ||
        (parsedCommand.mode === "generate"
          ? ""
          : "请基于参考图继续优化画面表现");
      if (!effectivePrompt) {
        toast.error("请补充清晰的配图描述后再提交");
        return false;
      }

      const localDispatchId = `image-task-dispatch-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const referenceImages = dedupeReferenceImages([
        targetOutput?.url,
        ...images.map((image) => image.data),
      ]);
      const requestedTarget =
        effectiveApplyTarget?.kind === "document-cover" ? "cover" : "generate";

      appendLocalDispatchMessages([
        {
          id: `image-workbench:${localDispatchId}:user`,
          role: "user",
          content: rawText,
          images: images.length > 0 ? images : undefined,
          timestamp: new Date(),
        },
      ]);

      setInput("");
      setMentionedCharacters([]);

      try {
        await createImageGenerationTask({
          projectRootPath: projectRootPath.trim(),
          prompt: effectivePrompt,
          title: effectivePrompt,
          mode: parsedCommand.mode,
          rawText,
          size: parsedCommand.size || imageWorkbenchSelectedSize,
          aspectRatio: parsedCommand.aspectRatio,
          count: parsedCommand.count,
          usage:
            requestedTarget === "cover" ? "cover" : "claw-image-workbench",
          providerId: imageWorkbenchSelectedProviderId,
          model: imageWorkbenchSelectedModelId,
          sessionId: imageWorkbenchSessionKey,
          projectId,
          contentId: contentId ?? undefined,
          entrySource: "at_image_command",
          requestedTarget,
          targetOutputId: targetOutput?.id ?? undefined,
          targetOutputRefId: targetOutput?.refId ?? undefined,
          referenceImages,
        });
        return true;
      } catch (error) {
        const failureMessage =
          error instanceof Error ? error.message : "图片任务创建失败";
        appendLocalDispatchMessages([
          {
            id: `image-workbench:${localDispatchId}:assistant-error`,
            role: "assistant",
            content: `图片任务创建失败：${failureMessage}`,
            timestamp: new Date(),
            isThinking: false,
          },
        ]);
        toast.error(failureMessage);
        return true;
      }
    },
    [
      appendLocalDispatchMessages,
      createImageGenerationTask,
      contentId,
      currentImageWorkbenchState.outputs,
      imageWorkbenchSelectedModelId,
      imageWorkbenchSelectedProviderId,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      projectId,
      projectRootPath,
      setInput,
      setMentionedCharacters,
    ],
  );

  return {
    handleApplySelectedImageWorkbenchOutput,
    handleImageWorkbenchCommand,
    handleImageWorkbenchViewportChange,
    handleOpenImageWorkbenchAsset,
    handleSaveSelectedImageWorkbenchOutput,
    handleSeedImageWorkbenchFollowUp,
    handleSelectImageWorkbenchOutput,
    handleStopImageWorkbenchGeneration,
    imageWorkbenchPrimaryActionLabel,
  };
}
