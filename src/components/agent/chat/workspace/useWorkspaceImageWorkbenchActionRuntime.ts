import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import { IMAGE_GENERATION_CANCELED_MESSAGE } from "@/components/image-gen/useImageGen";
import type { GeneratedImage } from "@/components/image-gen/types";
import type { Character } from "@/lib/api/memory";
import { emitCanvasImageInsertRequest } from "@/lib/canvasImageInsertBus";
import type { Message, MessageImage } from "../types";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  buildImageWorkbenchCompletionMessage,
  buildImageWorkbenchDispatchMessages,
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
  cancelImageWorkbenchGeneration: () => void;
  contentId?: string | null;
  currentImageWorkbenchState: SessionImageWorkbenchState;
  imageWorkbenchSelectedSize: string;
  imageWorkbenchSessionKey: string;
  projectId?: string;
  runImageWorkbenchGeneration: (
    prompt: string,
    options: {
      imageCount?: number;
      referenceImages?: string[];
      size?: string;
    },
  ) => Promise<GeneratedImage[]>;
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

export function useWorkspaceImageWorkbenchActionRuntime({
  appendLocalDispatchMessages,
  cancelImageWorkbenchGeneration,
  contentId,
  currentImageWorkbenchState,
  imageWorkbenchSelectedSize,
  imageWorkbenchSessionKey,
  projectId,
  runImageWorkbenchGeneration,
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
    cancelImageWorkbenchGeneration();
    updateCurrentImageWorkbenchState((current) => ({
      ...current,
      active: true,
      tasks: current.tasks.map((task) =>
        task.status === "routing" || task.status === "running"
          ? {
              ...task,
              status: "error",
              failureMessage: IMAGE_GENERATION_CANCELED_MESSAGE,
            }
          : task,
      ),
    }));
    toast.info(IMAGE_GENERATION_CANCELED_MESSAGE);
  }, [cancelImageWorkbenchGeneration, updateCurrentImageWorkbenchState]);

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

      const taskId = `image-task-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const referenceImages = [
        ...(targetOutput?.url ? [targetOutput.url] : []),
        ...images.map((image) => image.data).filter(Boolean),
      ];
      const now = Date.now();

      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: true,
        tasks: [
          {
            sessionId: imageWorkbenchSessionKey,
            id: taskId,
            mode: parsedCommand.mode,
            status: "routing",
            prompt: effectivePrompt,
            rawText,
            expectedCount: parsedCommand.count,
            outputIds: [],
            targetOutputId: targetOutput?.id ?? null,
            createdAt: now,
            hookImageIds: [],
            applyTarget: effectiveApplyTarget,
          },
          ...current.tasks,
        ],
        selectedOutputId: targetOutput?.id ?? current.selectedOutputId,
      }));

      appendLocalDispatchMessages(
        buildImageWorkbenchDispatchMessages({
          rawText,
          images,
          taskId,
          prompt: effectivePrompt,
          mode: parsedCommand.mode,
          count: parsedCommand.count,
        }),
      );

      setLayoutMode("chat-canvas");
      setInput("");
      setMentionedCharacters([]);

      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: true,
        tasks: current.tasks.map((task) =>
          task.id === taskId ? { ...task, status: "running" } : task,
        ),
      }));

      try {
        const generatedImages = await runImageWorkbenchGeneration(
          effectivePrompt,
          {
            imageCount: parsedCommand.count,
            referenceImages,
            size: parsedCommand.size || imageWorkbenchSelectedSize,
          },
        );
        const hookImageIds = generatedImages.map((image) => image.id);

        let successCount = 0;
        updateCurrentImageWorkbenchState((current) => {
          let nextOutputIndex = current.nextOutputIndex;
          const nextOutputs = [...current.outputs];
          const createdOutputIds: string[] = [];

          for (const image of generatedImages) {
            if (image.status !== "complete" || !image.url) {
              continue;
            }

            successCount += 1;
            const outputId = `${taskId}:${image.id}`;
            const refId = `img-${nextOutputIndex}`;
            nextOutputIndex += 1;
            nextOutputs.unshift({
              id: outputId,
              taskId,
              hookImageId: image.id,
              refId,
              url: image.url,
              prompt: image.prompt,
              createdAt: image.createdAt,
              providerName: image.providerName,
              modelName: image.model,
              size: image.size,
              parentOutputId: targetOutput?.refId ?? null,
              resourceSaved: Boolean(image.resourceMaterialId),
              applyTarget: effectiveApplyTarget,
            });
            createdOutputIds.push(outputId);
          }

          const failedCount = Math.max(0, parsedCommand.count - successCount);
          const nextStatus =
            successCount === 0
              ? "error"
              : failedCount > 0
                ? "partial"
                : "complete";

          return {
            ...current,
            active: true,
            outputs: nextOutputs,
            selectedOutputId:
              createdOutputIds[0] ||
              current.selectedOutputId ||
              targetOutput?.id ||
              null,
            nextOutputIndex,
            tasks: current.tasks.map((task) =>
              task.id === taskId
                ? {
                    ...task,
                    status: nextStatus,
                    outputIds: createdOutputIds,
                    hookImageIds,
                    failureMessage:
                      successCount === 0
                        ? "图片服务未返回可用结果"
                        : failedCount > 0
                          ? `有 ${failedCount} 张结果生成失败`
                          : undefined,
                  }
                : task,
            ),
          };
        });

        appendLocalDispatchMessages([
          buildImageWorkbenchCompletionMessage({
            taskId,
            successCount,
            failedCount: Math.max(0, parsedCommand.count - successCount),
            mode: parsedCommand.mode,
          }),
        ]);

        if (successCount === 0) {
          toast.error("图片任务失败，未生成可用结果");
        } else if (parsedCommand.count - successCount > 0) {
          toast.warning(
            `图片任务已完成 ${successCount} 张，失败 ${Math.max(
              0,
              parsedCommand.count - successCount,
            )} 张`,
          );
        } else {
          toast.success(`图片任务已完成，共生成 ${successCount} 张`);
        }
        return true;
      } catch (error) {
        const failureMessage =
          error instanceof Error ? error.message : "图片任务执行失败";
        const canceled = failureMessage === IMAGE_GENERATION_CANCELED_MESSAGE;
        updateCurrentImageWorkbenchState((current) => ({
          ...current,
          active: true,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: "error",
                  failureMessage,
                }
              : task,
          ),
        }));
        if (!canceled) {
          appendLocalDispatchMessages([
            {
              id: `image-workbench:${taskId}:failed`,
              role: "assistant",
              content: `当前图片任务失败：${failureMessage}`,
              timestamp: new Date(),
              runtimeStatus: {
                phase: "failed",
                title: "图片任务失败",
                detail: failureMessage,
              },
            },
          ]);
          toast.error(failureMessage);
        }
        return true;
      }
    },
    [
      appendLocalDispatchMessages,
      currentImageWorkbenchState.outputs,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      projectId,
      runImageWorkbenchGeneration,
      setInput,
      setLayoutMode,
      setMentionedCharacters,
      updateCurrentImageWorkbenchState,
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
