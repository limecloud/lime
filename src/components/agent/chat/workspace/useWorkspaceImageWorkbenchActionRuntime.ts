import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CanvasStateUnion } from "@/components/workspace/canvas/canvasUtils";
import type {
  CreateImageGenerationTaskArtifactRequest,
  MediaTaskArtifactOutput,
  MediaTaskLookupRequest,
} from "@/lib/api/agentRuntime/mediaTaskTypes";
import { emitCanvasImageInsertRequest } from "@/lib/canvasImageInsertBus";
import { onImageWorkbenchTaskAction } from "@/lib/imageWorkbenchEvents";
import { buildImageTaskLookupRequest } from "./imageTaskLocator";
import {
  collapseWhitespace,
  resolveImageWorkbenchApplyDispatchLabel,
  resolveImageWorkbenchActionLabel,
  resolveImageWorkbenchCoverSuccessLabel,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import {
  matchesTaskActionContext,
  readTaskPayloadPositiveNumber,
  readTaskPayloadString,
  readTaskPayloadStringArray,
  readTaskPayloadTitleGenerationResult,
  resolvePendingImageTaskId,
  resolveReplayMode,
  resolveReplayTarget,
  resolveTaskRecordAnchorHint,
  resolveTaskRecordAnchorSectionTitle,
  resolveTaskRecordAnchorText,
  resolveTaskRecordSlotId,
  resolveTrackedTaskReplayTarget,
  resolveTrackedTaskReplayUsage,
} from "./imageWorkbenchTaskActions";

interface UseWorkspaceImageWorkbenchActionRuntimeParams {
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
  projectId?: string | null;
  projectRootPath?: string | null;
  setCanvasState: Dispatch<SetStateAction<CanvasStateUnion | null>>;
  setInput: Dispatch<SetStateAction<string>>;
  updateCurrentImageWorkbenchState: (
    updater: (
      current: SessionImageWorkbenchState,
    ) => SessionImageWorkbenchState,
  ) => void;
}

export function useWorkspaceImageWorkbenchActionRuntime({
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
  setCanvasState,
  setInput,
  updateCurrentImageWorkbenchState,
}: UseWorkspaceImageWorkbenchActionRuntimeParams) {
  const { t } = useTranslation("agent");

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
      updateCurrentImageWorkbenchState((current) => {
        const selectedOutput =
          current.outputs.find((output) => output.id === outputId) ?? null;
        return {
          ...current,
          active: true,
          selectedTaskId:
            selectedOutput?.taskId ?? current.selectedTaskId ?? null,
          selectedOutputId: outputId,
        };
      });
    },
    [updateCurrentImageWorkbenchState],
  );

  const handleSeedImageWorkbenchFollowUp = useCallback(
    (command: string) => {
      setInput(command);
      toast.info(t("agentChat.imageWorkbenchAction.toast.seedCommand"));
    },
    [setInput, t],
  );

  const handleRetryImageWorkbenchTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      const normalizedProjectRootPath = projectRootPath?.trim();
      const trackedTask = currentImageWorkbenchState.tasks.find(
        (task) => task.id === normalizedTaskId,
      );
      const replayTrackedTaskDirectly = async () => {
        const prompt =
          trackedTask?.prompt.trim() || trackedTask?.rawText.trim() || "";
        if (!prompt) {
          toast.error(
            t("agentChat.imageWorkbenchAction.toast.retry.missingPrompt"),
          );
          return false;
        }

        await createImageGenerationTask({
          projectRootPath: normalizedProjectRootPath!,
          prompt,
          title: prompt,
          titleGenerationResult: undefined,
          mode: resolveReplayMode(trackedTask?.mode),
          rawText: trackedTask?.rawText.trim() || prompt,
          layoutHint: trackedTask?.layoutHint || undefined,
          size: imageWorkbenchSelectedSize,
          aspectRatio: undefined,
          count: trackedTask?.expectedCount || 1,
          usage: resolveTrackedTaskReplayUsage(trackedTask),
          slotId:
            trackedTask?.applyTarget?.kind === "canvas-insert"
              ? trackedTask.applyTarget.slotId || undefined
              : undefined,
          anchorHint:
            trackedTask?.applyTarget?.kind === "canvas-insert"
              ? trackedTask.applyTarget.anchorHint
              : undefined,
          anchorSectionTitle:
            trackedTask?.applyTarget?.kind === "canvas-insert"
              ? trackedTask.applyTarget.sectionTitle || undefined
              : undefined,
          anchorText:
            trackedTask?.applyTarget?.kind === "canvas-insert"
              ? trackedTask.applyTarget.anchorText || undefined
              : undefined,
          style: undefined,
          providerId: imageWorkbenchSelectedProviderId || undefined,
          model: imageWorkbenchSelectedModelId || undefined,
          sessionId: imageWorkbenchSessionKey,
          projectId: projectId || undefined,
          contentId: contentId || undefined,
          entrySource: "image_workbench_retry",
          requestedTarget: resolveTrackedTaskReplayTarget(trackedTask),
          targetOutputId: trackedTask?.targetOutputId || undefined,
          targetOutputRefId: trackedTask?.targetOutputRefId || undefined,
          referenceImages: [],
        });
        toast.success(t("agentChat.imageWorkbenchAction.toast.retry.success"));
        return true;
      };
      if (!normalizedTaskId) {
        toast.error(
          t("agentChat.imageWorkbenchAction.toast.retry.missingTaskId"),
        );
        return false;
      }
      if (!normalizedProjectRootPath) {
        toast.error(
          t("agentChat.imageWorkbenchAction.toast.retry.projectNotReady"),
        );
        return false;
      }

      try {
        const originalTaskLookup = buildImageTaskLookupRequest({
          taskId: normalizedTaskId,
          taskFilePath: trackedTask?.taskFilePath,
          artifactPath: trackedTask?.artifactPath,
          projectRootPath: normalizedProjectRootPath,
        });
        if (!originalTaskLookup) {
          toast.error(
            t("agentChat.imageWorkbenchAction.toast.retry.missingTaskFile"),
          );
          return false;
        }

        let originalTask: Awaited<ReturnType<typeof getImageTask>>;
        try {
          originalTask = await getImageTask(originalTaskLookup);
        } catch (error) {
          if (!trackedTask?.taskFilePath && !trackedTask?.artifactPath) {
            return await replayTrackedTaskDirectly();
          }
          throw error;
        }
        const payload =
          originalTask.record?.payload &&
          typeof originalTask.record.payload === "object" &&
          !Array.isArray(originalTask.record.payload)
            ? (originalTask.record.payload as Record<string, unknown>)
            : null;
        if (!payload) {
          toast.error(
            t("agentChat.imageWorkbenchAction.toast.retry.missingTaskContext"),
          );
          return false;
        }
        const prompt =
          readTaskPayloadString(payload, ["prompt"]) || trackedTask?.prompt;
        if (!prompt?.trim()) {
          toast.error(
            t("agentChat.imageWorkbenchAction.toast.retry.missingPrompt"),
          );
          return false;
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
        const titleGenerationResult =
          readTaskPayloadTitleGenerationResult(payload);

        await createImageGenerationTask({
          projectRootPath: originalTaskLookup.projectRootPath,
          prompt,
          title:
            readTaskPayloadString(payload, ["title"]) ||
            originalTask.record.title?.trim() ||
            titleGenerationResult?.title ||
            prompt,
          titleGenerationResult,
          mode: resolveReplayMode(payload.mode ?? payload.task_mode),
          rawText:
            readTaskPayloadString(payload, ["raw_text", "rawText"]) || prompt,
          layoutHint: readTaskPayloadString(payload, [
            "layout_hint",
            "layoutHint",
          ]),
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
        toast.success(t("agentChat.imageWorkbenchAction.toast.retry.success"));
        return true;
      } catch {
        toast.error(t("agentChat.imageWorkbenchAction.toast.retry.failed"));
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
      t,
    ],
  );

  const handleCancelImageWorkbenchTask = useCallback(
    async (taskId: string) => {
      const normalizedTaskId = taskId.trim();
      const normalizedProjectRootPath = projectRootPath?.trim();
      if (!normalizedTaskId) {
        toast.error(
          t("agentChat.imageWorkbenchAction.toast.cancel.missingTaskId"),
        );
        return false;
      }
      if (!normalizedProjectRootPath) {
        toast.error(
          t("agentChat.imageWorkbenchAction.toast.cancel.projectNotReady"),
        );
        return false;
      }

      try {
        const trackedTask = currentImageWorkbenchState.tasks.find(
          (task) => task.id === normalizedTaskId,
        );
        const cancelRequest = buildImageTaskLookupRequest({
          taskId: normalizedTaskId,
          taskFilePath: trackedTask?.taskFilePath,
          artifactPath: trackedTask?.artifactPath,
          projectRootPath: normalizedProjectRootPath,
        });
        if (!cancelRequest) {
          toast.error(
            t("agentChat.imageWorkbenchAction.toast.cancel.missingTaskFile"),
          );
          return false;
        }

        await cancelImageTask(cancelRequest);
        toast.success(t("agentChat.imageWorkbenchAction.toast.cancel.success"));
        return true;
      } catch {
        toast.error(t("agentChat.imageWorkbenchAction.toast.cancel.failed"));
        return false;
      }
    },
    [cancelImageTask, currentImageWorkbenchState.tasks, projectRootPath, t],
  );

  const handleStopImageWorkbenchGeneration = useCallback(async () => {
    const pendingTaskId = resolvePendingImageTaskId(
      currentImageWorkbenchState.tasks,
    );
    if (!pendingTaskId) {
      toast.info(t("agentChat.imageWorkbenchAction.toast.cancel.none"));
      return false;
    }

    return handleCancelImageWorkbenchTask(pendingTaskId);
  }, [currentImageWorkbenchState.tasks, handleCancelImageWorkbenchTask, t]);

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

  const handleApplySelectedImageWorkbenchOutput = useCallback(() => {
    const selectedOutput = currentImageWorkbenchState.outputs.find(
      (item) => item.id === currentImageWorkbenchState.selectedOutputId,
    );
    if (!selectedOutput) {
      toast.info(t("agentChat.imageWorkbenchAction.toast.output.selectImage"));
      return;
    }

    const applyTarget = selectedOutput.applyTarget;
    if (!applyTarget) {
      toast.info(t("agentChat.imageWorkbenchAction.toast.apply.missingTarget"));
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
        toast.error(
          t(
            "agentChat.imageWorkbenchAction.toast.apply.coverPlaceholderMissing",
          ),
        );
        return;
      }

      updateCurrentImageWorkbenchState((current) => ({
        ...current,
        active: false,
      }));
      toast.success(resolveImageWorkbenchCoverSuccessLabel(applyTarget));
      return;
    }

    emitCanvasImageInsertRequest({
      projectId: applyTarget.projectId ?? projectId ?? null,
      contentId: applyTarget.contentId ?? contentId ?? null,
      canvasType: applyTarget.canvasType,
      anchorHint: applyTarget.anchorHint,
      taskId: selectedOutput.taskId,
      slotId: applyTarget.slotId ?? selectedOutput.slotId ?? null,
      sectionTitle: applyTarget.sectionTitle ?? null,
      anchorText: applyTarget.anchorText ?? null,
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
    toast.info(resolveImageWorkbenchApplyDispatchLabel(applyTarget));
  }, [
    contentId,
    currentImageWorkbenchState.outputs,
    currentImageWorkbenchState.selectedOutputId,
    projectId,
    setCanvasState,
    t,
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

  return {
    handleApplySelectedImageWorkbenchOutput,
    handleCancelImageWorkbenchTask,
    handleImageWorkbenchViewportChange,
    handleRetryImageWorkbenchTask,
    handleSeedImageWorkbenchFollowUp,
    handleSelectImageWorkbenchOutput,
    handleStopImageWorkbenchGeneration,
    imageWorkbenchPrimaryActionLabel,
  };
}
