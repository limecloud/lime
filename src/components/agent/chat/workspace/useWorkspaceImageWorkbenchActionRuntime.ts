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
import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "@/lib/api/mediaTasks";
import { emitCanvasImageInsertRequest } from "@/lib/canvasImageInsertBus";
import { onImageWorkbenchTaskAction } from "@/lib/imageWorkbenchEvents";
import type { MessageImage } from "../types";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  buildImageWorkbenchSessionTitle,
  isLocalImageWorkbenchSessionKey,
  resolveImageWorkbenchSkillRequest,
} from "./imageSkillLaunch";
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

export interface SubmitImageWorkbenchAgentCommandParams {
  rawText: string;
  displayContent?: string;
  images: MessageImage[];
  requestContext: Record<string, unknown>;
}

interface UseWorkspaceImageWorkbenchActionRuntimeParams {
  contentId?: string | null;
  createFreshSession: (sessionName?: string) => Promise<string | null>;
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
  submitImageWorkbenchAgentCommand: (
    params: SubmitImageWorkbenchAgentCommandParams,
  ) => Promise<boolean>;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  setLayoutMode: Dispatch<SetStateAction<LayoutMode>>;
  updateImageWorkbenchStateForSession: (
    sessionKey: string,
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
    options?: {
      fallbackState?: SessionImageWorkbenchState;
      removeSessionKeys?: string[];
    },
  ) => void;
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

export function useWorkspaceImageWorkbenchActionRuntime({
  cancelImageTask,
  contentId,
  createFreshSession,
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
  submitImageWorkbenchAgentCommand,
  setCanvasState,
  setInput,
  setLayoutMode,
  updateImageWorkbenchStateForSession,
  updateCurrentImageWorkbenchState,
}: UseWorkspaceImageWorkbenchActionRuntimeParams) {
  const resolveImageWorkbenchSessionKey = useCallback(
    async (params: {
      preferredSessionKey?: string | null;
      mode: NonNullable<ReturnType<typeof parseImageWorkbenchCommand>>["mode"];
      prompt: string;
    }) => {
      const normalizedPreferredSessionKey =
        params.preferredSessionKey?.trim() || null;
      if (
        normalizedPreferredSessionKey &&
        !isLocalImageWorkbenchSessionKey(normalizedPreferredSessionKey)
      ) {
        return normalizedPreferredSessionKey;
      }

      const normalizedCurrentSessionKey = imageWorkbenchSessionKey.trim();
      if (
        normalizedCurrentSessionKey &&
        !isLocalImageWorkbenchSessionKey(normalizedCurrentSessionKey)
      ) {
        return normalizedCurrentSessionKey;
      }

      const createdSessionId = await createFreshSession(
        buildImageWorkbenchSessionTitle(params.mode, params.prompt),
      );
      const normalizedCreatedSessionId = createdSessionId?.trim();
      if (!normalizedCreatedSessionId) {
        throw new Error("图片会话创建失败，请稍后重试");
      }

      return normalizedCreatedSessionId;
    },
    [createFreshSession, imageWorkbenchSessionKey],
  );

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

      const effectivePrompt =
        params.parsedCommand.prompt.trim() ||
        (params.parsedCommand.mode === "generate"
          ? ""
          : "请基于参考图继续优化画面表现");
      if (!effectivePrompt) {
        toast.error("请补充清晰的配图描述后再提交");
        return false;
      }

      const resolvedSessionKey = await resolveImageWorkbenchSessionKey({
        mode: params.parsedCommand.mode,
        prompt: effectivePrompt,
      });

      const skillRequest = resolveImageWorkbenchSkillRequest({
        rawText: params.rawText,
        parsedCommand: params.parsedCommand,
        images: params.images,
        currentImageWorkbenchState,
        imageWorkbenchSelectedModelId,
        imageWorkbenchSelectedProviderId,
        imageWorkbenchSelectedSize,
        imageWorkbenchSessionKey,
        sessionIdOverride: resolvedSessionKey,
        projectId,
        projectRootPath,
        contentId,
        applyTarget: params.applyTarget,
        entrySource: params.applyTarget
          ? "image_workbench_action"
          : "at_image_command",
      });
      if (!skillRequest) {
        return false;
      }

      if (resolvedSessionKey !== imageWorkbenchSessionKey) {
        updateImageWorkbenchStateForSession(
          resolvedSessionKey,
          (current) => current,
          {
            fallbackState: currentImageWorkbenchState,
            removeSessionKeys: [imageWorkbenchSessionKey],
          },
        );
      }

      return submitImageWorkbenchAgentCommand({
        rawText: params.rawText,
        displayContent: params.rawText,
        images: skillRequest.images,
        requestContext: skillRequest.requestContext,
      });
    },
    [
      contentId,
      currentImageWorkbenchState,
      imageWorkbenchSelectedModelId,
      imageWorkbenchSelectedProviderId,
      imageWorkbenchSelectedSize,
      imageWorkbenchSessionKey,
      projectId,
      projectRootPath,
      resolveImageWorkbenchSessionKey,
      submitImageWorkbenchAgentCommand,
      updateImageWorkbenchStateForSession,
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
      sessionIdOverride?: string | null;
      applyTarget?: ImageWorkbenchApplyTarget | null;
      entrySource?: string;
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
