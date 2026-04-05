import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { CanvasStateUnion } from "@/lib/workspace/workbenchCanvas";
import type { LayoutMode } from "@/lib/workspace/workbenchContract";
import type { Character } from "@/lib/api/memory";
import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import { emitCanvasImageInsertRequest } from "@/lib/canvasImageInsertBus";
import { onImageWorkbenchTaskAction } from "@/lib/imageWorkbenchEvents";
import type { Message, MessageImage } from "../types";
import {
  buildMessageImageDataUrl,
  readMessageImageFromDataUrl,
} from "../utils/imageAttachments";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  collapseWhitespace,
  resolveImageWorkbenchActionLabel,
  type ImageWorkbenchApplyTarget,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import {
  buildImageTaskSnapshotFromArtifactOutput,
  mergeImageTaskSnapshot,
  syncDocumentInlineImageTask,
} from "./useWorkspaceImageTaskPreviewRuntime";

interface SaveImagesToResourceResult {
  saved: number;
  skipped: number;
  errors: string[];
}

export interface ImageWorkbenchSkillRequest {
  images: MessageImage[];
  requestContext: Record<string, unknown>;
}

interface ResolveImageWorkbenchSkillRequestParams {
  rawText: string;
  parsedCommand: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>;
  images: MessageImage[];
  currentImageWorkbenchState: SessionImageWorkbenchState;
  imageWorkbenchSelectedModelId?: string;
  imageWorkbenchSelectedProviderId?: string;
  imageWorkbenchSelectedSize: string;
  imageWorkbenchSessionKey: string;
  projectId?: string | null;
  projectRootPath?: string | null;
  contentId?: string | null;
}

function createSkillInputImageRef(index: number): string {
  return `skill-input-image://${index + 1}`;
}

function maybeReadMessageImageFromValue(value: string): MessageImage | null {
  const normalized = value.trim();
  if (!normalized.toLowerCase().startsWith("data:image/")) {
    return null;
  }

  try {
    return readMessageImageFromDataUrl(normalized);
  } catch {
    return null;
  }
}

export function resolveImageWorkbenchSkillRequest(
  params: ResolveImageWorkbenchSkillRequestParams,
): ImageWorkbenchSkillRequest | null {
  if (!params.projectId) {
    toast.error("请先选择项目后再开始配图");
    return null;
  }
  if (!params.projectRootPath?.trim()) {
    toast.error("当前项目目录未就绪，暂时无法创建图片任务");
    return null;
  }

  const { rawText, parsedCommand, images } = params;
  const targetOutput = parsedCommand.targetRef
    ? params.currentImageWorkbenchState.outputs.find(
        (item) =>
          item.refId.toLowerCase() === parsedCommand.targetRef?.toLowerCase(),
      ) || null
    : null;

  if (
    (parsedCommand.mode === "edit" || parsedCommand.mode === "variation") &&
    !targetOutput &&
    images.length === 0
  ) {
    toast.error("修图或重绘任务需要选择已有图片，或先附加参考图");
    return null;
  }

  const effectivePrompt =
    parsedCommand.prompt.trim() ||
    (parsedCommand.mode === "generate" ? "" : "请基于参考图继续优化画面表现");
  if (!effectivePrompt) {
    toast.error("请补充清晰的配图描述后再提交");
    return null;
  }

  const skillImages: MessageImage[] = [];
  const referenceImages: string[] = [];
  const pushSkillImage = (image: MessageImage) => {
    skillImages.push(image);
    referenceImages.push(createSkillInputImageRef(skillImages.length - 1));
  };
  const pushReferenceImage = (value: string | undefined | null) => {
    const normalized = value?.trim();
    if (!normalized || referenceImages.includes(normalized)) {
      return;
    }
    referenceImages.push(normalized);
  };

  const targetOutputImage = targetOutput
    ? maybeReadMessageImageFromValue(targetOutput.url)
    : null;
  if (targetOutputImage) {
    pushSkillImage(targetOutputImage);
  } else {
    pushReferenceImage(targetOutput?.url);
  }

  images.forEach((image) => {
    pushSkillImage(image);
  });

  const requestContext = {
    kind: "image_task",
    image_task: {
      mode: parsedCommand.mode,
      prompt: effectivePrompt,
      raw_text: rawText,
      count: parsedCommand.count,
      size: parsedCommand.size || params.imageWorkbenchSelectedSize,
      aspect_ratio: parsedCommand.aspectRatio,
      provider_id: params.imageWorkbenchSelectedProviderId,
      model: params.imageWorkbenchSelectedModelId,
      session_id: params.imageWorkbenchSessionKey,
      project_id: params.projectId,
      content_id: params.contentId || undefined,
      entry_source: "at_image_command",
      requested_target: "generate",
      target_output_id: targetOutput?.id,
      target_output_ref_id: targetOutput?.refId,
      reference_images: referenceImages,
      target_output_summary: targetOutput
        ? {
            prompt: collapseWhitespace(targetOutput.prompt) || undefined,
            provider_name: targetOutput.providerName,
            model_name: targetOutput.modelName,
            size: targetOutput.size,
            url:
              targetOutputImage || !targetOutput.url.trim()
                ? undefined
                : targetOutput.url.trim(),
          }
        : undefined,
      skill_input_images: skillImages.map((image, index) => ({
        ref: createSkillInputImageRef(index),
        media_type: image.mediaType,
        source:
          index === 0 && targetOutputImage ? "target_output" : "attachment",
      })),
    },
  } satisfies Record<string, unknown>;

  return {
    images: skillImages,
    requestContext,
  };
}

interface UseWorkspaceImageWorkbenchActionRuntimeParams {
  appendLocalDispatchMessages: (messages: Message[]) => void;
  canvasState: CanvasStateUnion | null;
  contentId?: string | null;
  createImageGenerationTask: (
    request: CreateImageGenerationTaskArtifactRequest,
  ) => Promise<MediaTaskArtifactOutput>;
  getImageTask: (
    request: MediaTaskLookupRequest,
  ) => Promise<MediaTaskArtifactOutput>;
  cancelImageTask: (request: MediaTaskLookupRequest) => Promise<unknown>;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readTaskPayloadString(
  payload: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function resolveTaskRecordSlotId(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return (
    readTaskPayloadString(asRecord(taskRecord?.relationships) || {}, [
      "slot_id",
      "slotId",
    ]) ||
    readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
      "slot_id",
      "slotId",
    ])
  );
}

function resolveTaskRecordAnchorHint(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_hint",
    "anchorHint",
  ]);
}

function resolveTaskRecordAnchorSectionTitle(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_section_title",
    "anchorSectionTitle",
  ]);
}

function resolveTaskRecordAnchorText(
  taskRecord: MediaTaskArtifactOutput["record"] | undefined,
): string | undefined {
  return readTaskPayloadString(asRecord(taskRecord?.payload) || {}, [
    "anchor_text",
    "anchorText",
  ]);
}

function readTaskPayloadPositiveNumber(
  payload: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function readTaskPayloadStringArray(
  payload: Record<string, unknown>,
  keys: string[],
): string[] {
  for (const key of keys) {
    const value = payload[key];
    if (!Array.isArray(value)) {
      continue;
    }

    const normalized = dedupeReferenceImages(
      value.map((item) => (typeof item === "string" ? item : undefined)),
    );
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

function resolveReplayMode(
  value: unknown,
): CreateImageGenerationTaskArtifactRequest["mode"] {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "edit") {
    return "edit";
  }
  if (normalized === "variation" || normalized === "variant") {
    return "variation";
  }
  return "generate";
}

function resolveReplayTarget(
  value: unknown,
): CreateImageGenerationTaskArtifactRequest["requestedTarget"] {
  return typeof value === "string" && value.trim().toLowerCase() === "cover"
    ? "cover"
    : "generate";
}

function resolvePendingImageTaskId(
  tasks: SessionImageWorkbenchState["tasks"],
): string | null {
  let latestTask: SessionImageWorkbenchState["tasks"][number] | null = null;

  for (const task of tasks) {
    if (
      task.status !== "queued" &&
      task.status !== "routing" &&
      task.status !== "running"
    ) {
      continue;
    }
    if (!latestTask || task.createdAt >= latestTask.createdAt) {
      latestTask = task;
    }
  }

  return latestTask?.id ?? null;
}

function matchesTaskActionContext(params: {
  detailProjectId?: string | null;
  detailContentId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
}): boolean {
  if (
    params.detailProjectId &&
    params.projectId &&
    params.detailProjectId !== params.projectId
  ) {
    return false;
  }

  if (
    params.detailContentId &&
    params.contentId &&
    params.detailContentId !== params.contentId
  ) {
    return false;
  }

  return true;
}

function createDocumentImageTaskSlotId(): string {
  return `document-image-slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useWorkspaceImageWorkbenchActionRuntime({
  appendLocalDispatchMessages,
  canvasState,
  cancelImageTask,
  contentId,
  createImageGenerationTask,
  getImageTask,
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
      toast.info("已在输入框填入图片命令");
    },
    [setInput],
  );

  const handleOpenImageWorkbenchAsset = useCallback((url: string) => {
    if (!url.trim()) {
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleRetryImageWorkbenchTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      const normalizedProjectRootPath = projectRootPath?.trim();
      if (!normalizedTaskId) {
        toast.error("缺少图片任务 ID，暂时无法重新生成");
        return false;
      }
      if (!normalizedProjectRootPath) {
        toast.error("当前项目目录未就绪，暂时无法重新生成");
        return false;
      }

      try {
        const originalTask = await getImageTask({
          projectRootPath: normalizedProjectRootPath,
          taskRef: normalizedTaskId,
        });
        const payload =
          originalTask.record?.payload &&
          typeof originalTask.record.payload === "object" &&
          !Array.isArray(originalTask.record.payload)
            ? (originalTask.record.payload as Record<string, unknown>)
            : null;
        if (!payload) {
          throw new Error("未找到原任务上下文，暂时无法重新生成");
        }

        const trackedTask = currentImageWorkbenchState.tasks.find(
          (task) => task.id === normalizedTaskId,
        );
        const prompt =
          readTaskPayloadString(payload, ["prompt"]) || trackedTask?.prompt;
        if (!prompt?.trim()) {
          throw new Error("原任务缺少提示词，暂时无法重新生成");
        }

        const requestedTarget = resolveReplayTarget(
          payload.requested_target ?? payload.requestedTarget,
        );
        const slotId = resolveTaskRecordSlotId(originalTask.record);
        const anchorHint = resolveTaskRecordAnchorHint(originalTask.record);
        const anchorSectionTitle = resolveTaskRecordAnchorSectionTitle(
          originalTask.record,
        );
        const anchorText = resolveTaskRecordAnchorText(originalTask.record);

        await createImageGenerationTask({
          projectRootPath: normalizedProjectRootPath,
          prompt,
          title: readTaskPayloadString(payload, ["title"]) || prompt,
          mode: resolveReplayMode(payload.mode ?? payload.task_mode),
          rawText:
            readTaskPayloadString(payload, ["raw_text", "rawText"]) || prompt,
          size:
            readTaskPayloadString(payload, ["size"]) ||
            imageWorkbenchSelectedSize,
          aspectRatio: readTaskPayloadString(payload, [
            "aspect_ratio",
            "aspectRatio",
          ]),
          count:
            readTaskPayloadPositiveNumber(payload, ["count", "image_count"]) ||
            trackedTask?.expectedCount ||
            1,
          usage:
            readTaskPayloadString(payload, ["usage"]) ||
            (requestedTarget === "cover" ? "cover" : "claw-image-workbench"),
          slotId,
          anchorHint,
          anchorSectionTitle,
          anchorText,
          style: readTaskPayloadString(payload, ["style"]),
          providerId:
            readTaskPayloadString(payload, ["provider_id", "providerId"]) ||
            imageWorkbenchSelectedProviderId,
          model:
            readTaskPayloadString(payload, ["model"]) ||
            imageWorkbenchSelectedModelId,
          sessionId:
            readTaskPayloadString(payload, ["session_id", "sessionId"]) ||
            imageWorkbenchSessionKey,
          projectId:
            readTaskPayloadString(payload, ["project_id", "projectId"]) ||
            projectId ||
            undefined,
          contentId:
            readTaskPayloadString(payload, ["content_id", "contentId"]) ||
            contentId ||
            undefined,
          entrySource:
            readTaskPayloadString(payload, ["entry_source", "entrySource"]) ||
            "image_workbench_retry",
          requestedTarget,
          targetOutputId: readTaskPayloadString(payload, [
            "target_output_id",
            "targetOutputId",
          ]),
          targetOutputRefId: readTaskPayloadString(payload, [
            "target_output_ref_id",
            "targetOutputRefId",
          ]),
          referenceImages: readTaskPayloadStringArray(payload, [
            "reference_images",
            "referenceImages",
          ]),
        });
        toast.success("已重新创建图片任务");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "重新提交图片任务失败",
        );
        return false;
      }
    },
    [
      contentId,
      createImageGenerationTask,
      currentImageWorkbenchState.tasks,
      getImageTask,
      imageWorkbenchSelectedModelId,
      imageWorkbenchSelectedProviderId,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      projectId,
      projectRootPath,
    ],
  );

  const handleCancelImageWorkbenchTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      const normalizedProjectRootPath = projectRootPath?.trim();
      if (!normalizedTaskId) {
        toast.error("缺少图片任务 ID，暂时无法取消");
        return false;
      }
      if (!normalizedProjectRootPath) {
        toast.error("当前项目目录未就绪，暂时无法取消图片任务");
        return false;
      }

      try {
        await cancelImageTask({
          projectRootPath: normalizedProjectRootPath,
          taskRef: normalizedTaskId,
        });
        toast.success("已提交取消请求");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "取消图片任务失败",
        );
        return false;
      }
    },
    [cancelImageTask, projectRootPath],
  );

  const handleStopImageWorkbenchGeneration = useCallback(async () => {
    const pendingTaskId = resolvePendingImageTaskId(
      currentImageWorkbenchState.tasks,
    );
    if (!pendingTaskId) {
      toast.info("当前没有可取消的图片任务");
      return false;
    }

    return handleCancelImageWorkbenchTask(pendingTaskId);
  }, [currentImageWorkbenchState.tasks, handleCancelImageWorkbenchTask]);

  useEffect(() => {
    return onImageWorkbenchTaskAction((detail) => {
      if (
        !matchesTaskActionContext({
          detailProjectId: detail.projectId,
          detailContentId: detail.contentId,
          projectId,
          contentId,
        })
      ) {
        return;
      }

      if (detail.action === "retry") {
        void handleRetryImageWorkbenchTask(detail.taskId);
        return;
      }

      void handleCancelImageWorkbenchTask(detail.taskId);
    });
  }, [
    contentId,
    handleCancelImageWorkbenchTask,
    handleRetryImageWorkbenchTask,
    projectId,
  ]);

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
        title:
          collapseWhitespace(selectedOutput.prompt) || selectedOutput.refId,
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
      const documentInlineSlotId =
        effectiveApplyTarget?.kind === "canvas-insert" &&
        effectiveApplyTarget.canvasType === "document"
          ? createDocumentImageTaskSlotId()
          : undefined;
      const documentInlineAnchorHint =
        effectiveApplyTarget?.kind === "canvas-insert" &&
        effectiveApplyTarget.canvasType === "document"
          ? effectiveApplyTarget.anchorHint
          : undefined;
      const documentInlineAnchorSectionTitle =
        effectiveApplyTarget?.kind === "canvas-insert" &&
        effectiveApplyTarget.canvasType === "document"
          ? effectiveApplyTarget.sectionTitle
          : undefined;
      const documentInlineAnchorText =
        effectiveApplyTarget?.kind === "canvas-insert" &&
        effectiveApplyTarget.canvasType === "document"
          ? effectiveApplyTarget.anchorText
          : undefined;

      if (
        (parsedCommand.mode === "edit" || parsedCommand.mode === "variation") &&
        !targetOutput &&
        images.length === 0
      ) {
        toast.error("修图或重绘任务需要选择已有图片，或先附加参考图");
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
        ...images.map((image) => buildMessageImageDataUrl(image)),
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
        const createdArtifact = await createImageGenerationTask({
          projectRootPath: projectRootPath.trim(),
          prompt: effectivePrompt,
          title: effectivePrompt,
          mode: parsedCommand.mode,
          rawText,
          size: parsedCommand.size || imageWorkbenchSelectedSize,
          aspectRatio: parsedCommand.aspectRatio,
          count: parsedCommand.count,
          usage:
            requestedTarget === "cover"
              ? "cover"
              : documentInlineSlotId
                ? "document-inline"
                : "claw-image-workbench",
          slotId: documentInlineSlotId,
          anchorHint: documentInlineAnchorHint,
          anchorSectionTitle: documentInlineAnchorSectionTitle ?? undefined,
          anchorText: documentInlineAnchorText ?? undefined,
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
        const createdSnapshot = buildImageTaskSnapshotFromArtifactOutput({
          artifact: createdArtifact,
          projectId,
          contentId: contentId ?? null,
          canvasState,
        });
        if (createdSnapshot) {
          appendLocalDispatchMessages([createdSnapshot.message]);
          updateCurrentImageWorkbenchState((current) =>
            mergeImageTaskSnapshot(current, createdSnapshot),
          );
          syncDocumentInlineImageTask({
            taskRecord:
              asRecord(createdArtifact.record) || {
                    task_id: createdArtifact.task_id,
                    task_type: createdArtifact.task_type,
                    status: createdArtifact.status,
                    normalized_status: createdArtifact.normalized_status,
                    payload: {
                      prompt: effectivePrompt,
                      slot_id: documentInlineSlotId,
                      anchor_hint: documentInlineAnchorHint,
                      anchor_section_title: documentInlineAnchorSectionTitle,
                      anchor_text: documentInlineAnchorText,
                      usage:
                        requestedTarget === "cover"
                          ? "cover"
                          : documentInlineSlotId
                            ? "document-inline"
                            : "claw-image-workbench",
                    },
                    relationships: documentInlineSlotId
                      ? {
                          slot_id: documentInlineSlotId,
                        }
                      : undefined,
                  },
            taskId: createdArtifact.task_id,
            outputs: createdSnapshot.outputs,
            setCanvasState,
          });
        }
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
      canvasState,
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
      setCanvasState,
      setMentionedCharacters,
      updateCurrentImageWorkbenchState,
    ],
  );

  return {
    handleApplySelectedImageWorkbenchOutput,
    handleCancelImageWorkbenchTask,
    handleImageWorkbenchCommand,
    handleImageWorkbenchViewportChange,
    handleOpenImageWorkbenchAsset,
    handleRetryImageWorkbenchTask,
    handleSaveSelectedImageWorkbenchOutput,
    handleSeedImageWorkbenchFollowUp,
    handleSelectImageWorkbenchOutput,
    handleStopImageWorkbenchGeneration,
    imageWorkbenchPrimaryActionLabel,
    resolveImageWorkbenchSkillRequest: (params: {
      rawText: string;
      parsedCommand: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>;
      images: MessageImage[];
    }) =>
      resolveImageWorkbenchSkillRequest({
        ...params,
        currentImageWorkbenchState,
        imageWorkbenchSelectedModelId,
        imageWorkbenchSelectedProviderId,
        imageWorkbenchSelectedSize,
        imageWorkbenchSessionKey,
        projectId,
        projectRootPath,
        contentId,
      }),
  };
}
