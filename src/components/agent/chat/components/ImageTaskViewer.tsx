import { useMemo } from "react";
import { LoaderCircle, Sparkles, X } from "lucide-react";
import { openResourceManager } from "@/features/resource-manager";
import type { ResourceManagerSourceContext } from "@/features/resource-manager";
import { cn } from "@/lib/utils";
import { RenderableTaskImage } from "./RenderableTaskImage";
import type { ImageTaskViewerProps } from "./imageWorkbenchTypes";
import type { ImageRuntimeContractSnapshot } from "../types";

const IMAGE_TASK_PRIMARY_BUTTON_CLASSNAME =
  "inline-flex items-center justify-center rounded-full border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95";

function resolveModeEyebrow(mode?: string): string {
  switch ((mode || "").trim().toLowerCase()) {
    case "edit":
      return "Image Editing";
    case "variation":
      return "Image Redraw";
    case "generate":
    default:
      return "Image Generation";
  }
}

function resolveSourceLabel(mode?: string): string {
  return (mode || "").trim().toLowerCase() === "variation"
    ? "参考图"
    : "来源图";
}

function resolveFollowUpLabel(mode?: string): string {
  const normalizedMode = (mode || "").trim().toLowerCase();
  if (normalizedMode === "edit") {
    return "继续修图";
  }
  if (normalizedMode === "variation") {
    return "继续重绘";
  }
  return "基于此图重绘";
}

function resolveLayoutLabel(layoutHint?: string | null): string | null {
  return layoutHint === "storyboard_3x3" ? "3x3 分镜" : null;
}

function resolveOutputGridClassName(params: {
  layoutHint?: string | null;
  outputCount: number;
}): string {
  if (params.layoutHint === "storyboard_3x3") {
    return "grid-cols-3";
  }
  if (params.outputCount <= 4) {
    return "grid-cols-2";
  }
  if (params.outputCount <= 9) {
    return "grid-cols-2 sm:grid-cols-3";
  }
  return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4";
}

function resolveOutputTileAspectClass(layoutHint?: string | null): string {
  return layoutHint === "storyboard_3x3" ? "aspect-square" : "aspect-[4/3]";
}

function resolveSelectedOutputLabel(params: {
  selectedIndex: number;
  outputCount: number;
  layoutHint?: string | null;
}): string | null {
  if (params.selectedIndex < 0 || params.outputCount <= 1) {
    return null;
  }

  return params.layoutHint === "storyboard_3x3"
    ? `已选第 ${params.selectedIndex + 1} 格`
    : `已选第 ${params.selectedIndex + 1} 张`;
}

function resolveOutputDisplayIndex(
  outputIndex: number,
  slotIndex?: number | null,
): number {
  return slotIndex && slotIndex > 0 ? slotIndex : outputIndex + 1;
}

function resolveStoryboardSlotLabel(params: {
  layoutHint?: string | null;
  outputIndex: number;
  slotIndex?: number | null;
  slotLabel?: string | null;
  taskSlotLabel?: string | null;
}): string | null {
  if (params.layoutHint !== "storyboard_3x3") {
    return null;
  }

  return (
    params.slotLabel?.trim() ||
    params.taskSlotLabel?.trim() ||
    `第 ${resolveOutputDisplayIndex(params.outputIndex, params.slotIndex)} 格`
  );
}

function buildFollowUpCommand(params: {
  mode?: string;
  outputRef?: string | null;
  prompt?: string | null;
}): string | null {
  const normalizedRef = params.outputRef?.trim();
  if (!normalizedRef) {
    return null;
  }

  const referenceToken = normalizedRef.startsWith("#")
    ? normalizedRef
    : `#${normalizedRef}`;
  const normalizedPrompt = params.prompt?.trim();
  const normalizedMode = (params.mode || "").trim().toLowerCase();
  if (normalizedMode === "edit" && normalizedPrompt) {
    return `@修图 ${referenceToken} ${normalizedPrompt}`;
  }
  if (normalizedMode === "variation" && normalizedPrompt) {
    return `@重绘 ${referenceToken} ${normalizedPrompt}`;
  }
  return `@重绘 ${referenceToken} `;
}

function resolveStatusLabel(status?: string, mode?: string): string {
  const normalizedMode = (mode || "").trim().toLowerCase();
  switch ((status || "").trim().toLowerCase()) {
    case "complete":
      switch (normalizedMode) {
        case "edit":
          return "已修图";
        case "variation":
          return "已重绘";
        case "generate":
        default:
          return "已生成";
      }
    case "partial":
      return "部分完成";
    case "cancelled":
      return "已取消";
    case "error":
      switch (normalizedMode) {
        case "edit":
          return "修图失败";
        case "variation":
          return "重绘失败";
        case "generate":
        default:
          return "生成失败";
      }
    case "queued":
      return "等待队列";
    case "running":
    case "routing":
      switch (normalizedMode) {
        case "edit":
          return "修图中";
        case "variation":
          return "重绘中";
        case "generate":
        default:
          return "生成中";
      }
    default:
      return "准备中";
  }
}

function resolveStatusTone(status?: string): string {
  switch ((status || "").trim().toLowerCase()) {
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "queued":
    case "running":
    case "routing":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function resolveRuntimeContractBadge(
  runtimeContract?: ImageRuntimeContractSnapshot | null,
): { label: string; tone: string } | null {
  if (!runtimeContract) {
    return null;
  }

  const contractKey = runtimeContract.contractKey?.trim() || "image_generation";
  const outcome = (runtimeContract.routingOutcome || "").trim().toLowerCase();
  if (outcome === "blocked") {
    return {
      label: `运行合同阻止 · ${
        runtimeContract.failureCode?.trim() || contractKey
      }`,
      tone: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (outcome === "failed") {
    return {
      label: `运行合同失败 · ${
        runtimeContract.failureCode?.trim() || contractKey
      }`,
      tone: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  return {
    label: `运行合同 · 已按 ${contractKey} 路由`,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}

function resolveRuntimeContractRegistryLabel(
  runtimeContract?: ImageRuntimeContractSnapshot | null,
): string | null {
  if (runtimeContract?.modelCapabilityAssessmentSource !== "model_registry") {
    return null;
  }
  if (runtimeContract.modelSupportsImageGeneration === false) {
    return "模型能力来自 model_registry · 不支持图片生成";
  }
  if (runtimeContract.modelSupportsImageGeneration === true) {
    return "模型能力来自 model_registry · 支持图片生成";
  }
  return "模型能力来自 model_registry";
}

function resolveEmptyStateDescription(
  status?: string,
  failureMessage?: string,
  mode?: string,
): string {
  if (failureMessage?.trim()) {
    return failureMessage.trim();
  }

  switch ((status || "").trim().toLowerCase()) {
    case "cancelled":
      return "这次任务已经取消，当前不会继续生成新的图片结果。";
    case "error":
      return "这次生成没有拿到可用图片结果。";
    case "queued":
      return "图片任务已经提交，正在等待服务分配执行槽位。";
    case "running":
    case "routing":
      switch ((mode || "").trim().toLowerCase()) {
        case "edit":
          return "图片编辑中，完成后会直接在这里展示修图结果。";
        case "variation":
          return "图片重绘中，完成后会直接在这里展示结果。";
        case "generate":
        default:
          return "图片生成中，完成后会直接在这里展示结果。";
      }
    default:
      return "图片任务已创建，结果准备好后会展示在这里。";
  }
}

function resolveImageUnavailableTitle(status?: string): string {
  switch ((status || "").trim().toLowerCase()) {
    case "complete":
    case "partial":
      return "图片暂时无法显示";
    default:
      return resolveStatusLabel(status);
  }
}

function resolveImageUnavailableDescription(mode?: string): string {
  switch ((mode || "").trim().toLowerCase()) {
    case "edit":
      return "修图结果已经返回，但当前预览地址暂时无法加载。";
    case "variation":
      return "重绘结果已经返回，但当前预览地址暂时无法加载。";
    case "generate":
    default:
      return "图片结果已经返回，但当前预览地址暂时无法加载。";
  }
}

function resolveSourcePlaceholderLabel(
  mode?: string,
  reason?: "empty" | "error",
) {
  if (reason === "error") {
    return (mode || "").trim().toLowerCase() === "variation"
      ? "参考图暂时无法显示"
      : "来源图暂时无法显示";
  }

  return (mode || "").trim().toLowerCase() === "variation"
    ? "参考图待同步"
    : "来源图待同步";
}

function normalizeSourceContextText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function buildImageTaskResourceSourceContext(params: {
  taskId?: string | null;
  outputId?: string | null;
  projectId?: string | null;
  contentId?: string | null;
  threadId?: string | null;
}): ResourceManagerSourceContext {
  return {
    kind: "image_task",
    projectId: normalizeSourceContextText(params.projectId),
    contentId: normalizeSourceContextText(params.contentId),
    taskId: normalizeSourceContextText(params.taskId),
    outputId: normalizeSourceContextText(params.outputId),
    threadId: normalizeSourceContextText(params.threadId),
    sourcePage: "image-task-viewer",
  };
}

export function ImageTaskViewer({
  tasks,
  outputs,
  selectedOutputId,
  sourceProjectId,
  sourceContentId,
  sourceThreadId,
  savingToResource,
  onSaveSelectedToLibrary,
  applySelectedOutputLabel,
  onApplySelectedOutput,
  onSeedFollowUpCommand,
  onSelectOutput,
  onClose,
}: ImageTaskViewerProps) {
  const selectedOutput =
    outputs.find((item) => item.id === selectedOutputId) ?? outputs[0] ?? null;
  const selectedTask =
    (selectedOutput
      ? tasks.find((item) => item.id === selectedOutput.taskId)
      : null) ??
    tasks[0] ??
    null;
  const selectedTaskOutputs = selectedTask
    ? outputs.filter((item) => item.taskId === selectedTask.id)
    : outputs;
  const expectedOutputCount = Math.max(
    selectedTask?.expectedCount ?? 0,
    selectedTaskOutputs.length,
  );
  const outputGridSlots = Array.from(
    { length: expectedOutputCount },
    (_, index) => selectedTaskOutputs[index] ?? null,
  );
  const selectedOutputIndex = selectedOutput
    ? selectedTaskOutputs.findIndex((item) => item.id === selectedOutput.id)
    : -1;
  const selectedStoryboardSlot = useMemo(() => {
    if (!selectedTask || selectedOutputIndex < 0) {
      return null;
    }

    const selectedSlotIndex =
      selectedOutput?.slotIndex ?? selectedOutputIndex + 1;
    const taskSlot = selectedTask.storyboardSlots?.find(
      (slot) => slot.slotIndex === selectedSlotIndex,
    );

    return {
      slotIndex: selectedSlotIndex,
      label: resolveStoryboardSlotLabel({
        layoutHint: selectedTask.layoutHint,
        outputIndex: selectedOutputIndex,
        slotIndex: selectedSlotIndex,
        slotLabel: selectedOutput?.slotLabel,
        taskSlotLabel: taskSlot?.label,
      }),
      prompt: selectedOutput?.slotPrompt || taskSlot?.prompt || null,
    };
  }, [
    selectedOutput?.slotIndex,
    selectedOutput?.slotLabel,
    selectedOutput?.slotPrompt,
    selectedOutputIndex,
    selectedTask,
  ]);
  const statusLabel = resolveStatusLabel(
    selectedTask?.status,
    selectedTask?.mode,
  );
  const runtimeContractBadge = resolveRuntimeContractBadge(
    selectedTask?.runtimeContract,
  );
  const runtimeContractRegistryLabel = resolveRuntimeContractRegistryLabel(
    selectedTask?.runtimeContract,
  );
  const layoutLabel = resolveLayoutLabel(selectedTask?.layoutHint);
  const selectedOutputLabel = resolveSelectedOutputLabel({
    selectedIndex: selectedOutputIndex,
    outputCount: expectedOutputCount,
    layoutHint: selectedTask?.layoutHint,
  });
  const prompt =
    selectedOutput?.prompt?.trim() ||
    selectedTask?.prompt?.trim() ||
    "当前图片任务未提供提示词。";
  const sourceOutputId =
    selectedTask?.targetOutputId ?? selectedOutput?.parentOutputId ?? null;
  const sourceOutput = sourceOutputId
    ? (outputs.find((item) => item.id === sourceOutputId) ?? null)
    : null;
  const sourceImageUrl =
    sourceOutput?.url?.trim() || selectedTask?.sourceImageUrl?.trim() || null;
  const sourceImagePrompt =
    selectedTask?.sourceImagePrompt?.trim() ||
    sourceOutput?.prompt?.trim() ||
    null;
  const sourceImageRef =
    selectedTask?.sourceImageRef?.trim() || sourceOutput?.refId?.trim() || null;
  const sourceImageCount =
    selectedTask?.sourceImageCount ?? (sourceOutput ? 1 : undefined);
  const showSourcePanel = Boolean(
    selectedTask?.mode === "edit" ||
    selectedTask?.mode === "variation" ||
    sourceImageUrl ||
    sourceImagePrompt ||
    sourceImageRef ||
    sourceImageCount,
  );
  const sourceSummary = sourceImagePrompt
    ? sourceImagePrompt
    : sourceImageRef
      ? `已引用 ${sourceImageRef}`
      : selectedTask?.mode === "variation"
        ? "当前任务会基于参考图继续生成新的重绘结果。"
        : "当前任务会基于已有图片结果继续完成修图。";
  const followUpCommand = buildFollowUpCommand({
    mode: selectedTask?.mode,
    outputRef: selectedOutput?.refId,
    prompt: selectedTask?.prompt,
  });
  const canContinueEdit = Boolean(followUpCommand && onSeedFollowUpCommand);
  const handleOpenSelectedImagePreview = () => {
    if (!selectedOutput) {
      return;
    }

    void openResourceManager({
      sourceLabel: resolveModeEyebrow(selectedTask?.mode),
      sourceContext: buildImageTaskResourceSourceContext({
        taskId: selectedTask?.id ?? selectedOutput.taskId,
        outputId: selectedOutput.id,
        projectId: sourceProjectId,
        contentId: sourceContentId,
        threadId: sourceThreadId,
      }),
      initialIndex: selectedOutputIndex >= 0 ? selectedOutputIndex : 0,
      items: selectedTaskOutputs.map((output, index) => {
        const taskSlotLabel = selectedTask?.storyboardSlots?.find(
          (slot) =>
            slot.slotIndex ===
            resolveOutputDisplayIndex(index, output.slotIndex),
        )?.label;
        const slotLabel = resolveStoryboardSlotLabel({
          layoutHint: selectedTask?.layoutHint,
          outputIndex: index,
          slotIndex: output.slotIndex,
          slotLabel: output.slotLabel,
          taskSlotLabel,
        });

        return {
          id: output.id,
          kind: "image" as const,
          src: output.url,
          title: slotLabel || output.prompt || prompt,
          description: output.slotPrompt || output.prompt || prompt,
          metadata: {
            prompt: output.slotPrompt || output.prompt || prompt,
            slotLabel,
            size: output.size,
            providerName: output.providerName,
            modelName: output.modelName,
          },
          sourceContext: buildImageTaskResourceSourceContext({
            taskId: output.taskId || selectedTask?.id,
            outputId: output.id,
            projectId: sourceProjectId,
            contentId: sourceContentId,
            threadId: sourceThreadId,
          }),
        };
      }),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="border-b border-slate-200 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {resolveModeEyebrow(selectedTask?.mode)}
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6 text-slate-900">
              {prompt}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                resolveStatusTone(selectedTask?.status),
              )}
            >
              {selectedTask?.status === "running" ||
              selectedTask?.status === "routing" ||
              selectedTask?.status === "queued" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {statusLabel}
            </span>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
                aria-label="关闭图片查看"
                data-testid="image-task-viewer-close"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
        <div
          data-testid="image-task-viewer-stage"
          className="flex-1 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-50"
        >
          <div className="h-full w-full p-4 pt-5">
            {selectedOutput ? (
              <RenderableTaskImage
                src={selectedOutput.url}
                alt={selectedOutput.prompt || "图片任务结果"}
                className="h-full w-full object-contain"
                renderImage={(imageProps) => (
                  <button
                    type="button"
                    className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-[18px] border border-slate-200/80 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_42%),linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.98))] p-4"
                    onClick={handleOpenSelectedImagePreview}
                    data-testid="image-task-viewer-open-image"
                  >
                    <img
                      {...imageProps}
                      className={cn(
                        "h-full w-full rounded-[14px] object-contain",
                        imageProps.className,
                      )}
                    />
                    <span className="pointer-events-none absolute inset-x-4 bottom-4 rounded-[14px] bg-slate-950/66 px-3 py-2 text-left text-xs leading-5 text-white backdrop-blur-[1px]">
                      <span className="font-medium">
                        {selectedStoryboardSlot?.label || "点击逐张预览"}
                      </span>
                      {selectedStoryboardSlot?.prompt ? (
                        <span className="mt-0.5 line-clamp-2 block text-white/80">
                          {selectedStoryboardSlot.prompt}
                        </span>
                      ) : null}
                    </span>
                  </button>
                )}
                renderFallback={(reason) => (
                  <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
                    <div className="max-w-sm space-y-3">
                      {reason === "empty" &&
                      (selectedTask?.status === "running" ||
                        selectedTask?.status === "routing" ||
                        selectedTask?.status === "queued") ? (
                        <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-sky-500" />
                      ) : (
                        <Sparkles className="mx-auto h-8 w-8 text-slate-400" />
                      )}
                      <div className="text-sm font-semibold text-slate-900">
                        {reason === "error"
                          ? resolveImageUnavailableTitle(selectedTask?.status)
                          : statusLabel}
                      </div>
                      <div className="text-sm leading-6 text-slate-500">
                        {reason === "error"
                          ? resolveImageUnavailableDescription(
                              selectedTask?.mode,
                            )
                          : resolveEmptyStateDescription(
                              selectedTask?.status,
                              selectedTask?.failureMessage,
                              selectedTask?.mode,
                            )}
                      </div>
                    </div>
                  </div>
                )}
              />
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
                <div className="max-w-sm space-y-3">
                  {selectedTask?.status === "running" ||
                  selectedTask?.status === "routing" ||
                  selectedTask?.status === "queued" ? (
                    <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-sky-500" />
                  ) : (
                    <Sparkles className="mx-auto h-8 w-8 text-slate-400" />
                  )}
                  <div className="text-sm font-semibold text-slate-900">
                    {statusLabel}
                  </div>
                  <div className="text-sm leading-6 text-slate-500">
                    {resolveEmptyStateDescription(
                      selectedTask?.status,
                      selectedTask?.failureMessage,
                      selectedTask?.mode,
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {showSourcePanel ? (
          <div
            data-testid="image-task-viewer-source"
            className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-[11px] font-medium text-slate-500">
              {resolveSourceLabel(selectedTask?.mode)}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-white">
                <RenderableTaskImage
                  src={sourceImageUrl}
                  data-testid="image-task-viewer-source-image"
                  alt={
                    sourceImagePrompt || resolveSourceLabel(selectedTask?.mode)
                  }
                  className="h-full w-full object-cover"
                  renderFallback={(reason) => (
                    <span className="px-2 text-center text-[11px] font-medium text-slate-400">
                      {resolveSourcePlaceholderLabel(
                        selectedTask?.mode,
                        reason,
                      )}
                    </span>
                  )}
                />
              </div>
              <div className="min-w-0">
                <div className="line-clamp-2 text-sm font-medium leading-6 text-slate-800">
                  {sourceSummary}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  {sourceImageRef ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {sourceImageRef}
                    </span>
                  ) : null}
                  {sourceImageCount && sourceImageCount > 0 ? (
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                      {sourceImageCount} 张
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {runtimeContractBadge ? (
            <span
              data-testid="image-task-viewer-runtime-contract"
              className={cn(
                "rounded-full border px-2.5 py-1 font-medium",
                runtimeContractBadge.tone,
              )}
            >
              {runtimeContractBadge.label}
            </span>
          ) : null}
          {runtimeContractRegistryLabel ? (
            <span
              data-testid="image-task-viewer-runtime-contract-registry"
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600"
            >
              {runtimeContractRegistryLabel}
            </span>
          ) : null}
          {layoutLabel ? (
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-medium text-sky-700">
              {layoutLabel}
            </span>
          ) : null}
          {selectedOutputLabel ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
              {selectedOutputLabel}
            </span>
          ) : null}
          {selectedStoryboardSlot?.label ? (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-700">
              {selectedStoryboardSlot.label}
            </span>
          ) : null}
          {selectedOutput?.providerName ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {selectedOutput.providerName}
            </span>
          ) : null}
          {selectedOutput?.modelName ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {selectedOutput.modelName}
            </span>
          ) : null}
          {selectedOutput?.size ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {selectedOutput.size}
            </span>
          ) : null}
          {expectedOutputCount > 0 ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {expectedOutputCount > selectedTaskOutputs.length
                ? `${selectedTaskOutputs.length} / ${expectedOutputCount} 张结果`
                : `${selectedTaskOutputs.length} 张结果`}
            </span>
          ) : null}
        </div>

        {canContinueEdit ||
        (selectedOutput && onSaveSelectedToLibrary) ||
        (selectedOutput && onApplySelectedOutput) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canContinueEdit ? (
              <button
                type="button"
                data-testid="image-task-viewer-action-follow-up"
                onClick={() => {
                  if (!followUpCommand) {
                    return;
                  }
                  onSeedFollowUpCommand?.(followUpCommand);
                }}
                className={IMAGE_TASK_PRIMARY_BUTTON_CLASSNAME}
              >
                {resolveFollowUpLabel(selectedTask?.mode)}
              </button>
            ) : null}
            {selectedOutput && onSaveSelectedToLibrary ? (
              <button
                type="button"
                data-testid="image-task-viewer-action-save"
                onClick={() => onSaveSelectedToLibrary()}
                disabled={Boolean(
                  selectedOutput?.resourceSaved || savingToResource,
                )}
                className={cn(
                  "inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                  selectedOutput?.resourceSaved
                    ? "cursor-default border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:text-slate-900",
                  savingToResource && !selectedOutput?.resourceSaved
                    ? "cursor-wait"
                    : null,
                )}
              >
                {savingToResource && !selectedOutput?.resourceSaved ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {selectedOutput?.resourceSaved
                  ? "已保存到素材库"
                  : "保存到素材库"}
              </button>
            ) : null}
            {selectedOutput &&
            onApplySelectedOutput &&
            applySelectedOutputLabel ? (
              <button
                type="button"
                data-testid="image-task-viewer-action-apply"
                onClick={() => onApplySelectedOutput()}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
              >
                {applySelectedOutputLabel}
              </button>
            ) : null}
          </div>
        ) : null}

        {expectedOutputCount > 1 ? (
          <div
            data-testid="image-task-viewer-output-grid"
            className={cn(
              "mt-4 grid max-h-[min(34vh,280px)] gap-3 overflow-y-auto pb-1 pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]",
              resolveOutputGridClassName({
                layoutHint: selectedTask?.layoutHint,
                outputCount: expectedOutputCount,
              }),
            )}
          >
            {outputGridSlots.map((output, index) => {
              const active = output?.id === selectedOutput?.id;
              const taskSlotLabel = selectedTask?.storyboardSlots?.find(
                (slot) =>
                  slot.slotIndex ===
                  resolveOutputDisplayIndex(index, output?.slotIndex),
              )?.label;
              const storyboardSlotLabel = resolveStoryboardSlotLabel({
                layoutHint: selectedTask?.layoutHint,
                outputIndex: index,
                slotIndex: output?.slotIndex,
                slotLabel: output?.slotLabel,
                taskSlotLabel,
              });
              return (
                <button
                  key={output?.id || `image-output-placeholder-${index + 1}`}
                  type="button"
                  disabled={!output}
                  onClick={() => {
                    if (!output) {
                      return;
                    }
                    onSelectOutput(output.id);
                  }}
                  className={cn(
                    "group overflow-hidden rounded-2xl border bg-white transition",
                    active
                      ? "border-sky-300 shadow-sm shadow-sky-500/10"
                      : output
                        ? "border-slate-200 hover:border-slate-300"
                        : "cursor-default border-dashed border-slate-200 bg-slate-50/80",
                  )}
                >
                  <div className="relative">
                    {output ? (
                      <RenderableTaskImage
                        src={output.url}
                        alt={output.prompt || "图片结果缩略图"}
                        className={cn(
                          "w-full object-cover",
                          resolveOutputTileAspectClass(
                            selectedTask?.layoutHint,
                          ),
                        )}
                        renderFallback={() => (
                          <div
                            className={cn(
                              "flex w-full items-center justify-center bg-slate-50 px-3 text-center text-[11px] font-medium text-slate-400",
                              resolveOutputTileAspectClass(
                                selectedTask?.layoutHint,
                              ),
                            )}
                          >
                            预览失败
                          </div>
                        )}
                      />
                    ) : (
                      <div
                        className={cn(
                          "flex w-full flex-col items-center justify-center gap-2 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.98))] px-3 text-center",
                          resolveOutputTileAspectClass(
                            selectedTask?.layoutHint,
                          ),
                        )}
                      >
                        {selectedTask?.status === "queued" ||
                        selectedTask?.status === "routing" ||
                        selectedTask?.status === "running" ? (
                          <LoaderCircle className="h-5 w-5 animate-spin text-sky-500" />
                        ) : (
                          <Sparkles className="h-5 w-5 text-slate-300" />
                        )}
                        <span className="text-[11px] font-medium text-slate-400">
                          {selectedTask?.status === "error"
                            ? "本格失败"
                            : selectedTask?.status === "cancelled"
                              ? "已取消"
                              : "等待生成"}
                        </span>
                      </div>
                    )}
                    {expectedOutputCount > 1 ? (
                      <span
                        className={cn(
                          "absolute left-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold shadow-sm shadow-slate-950/5",
                          layoutLabel || active
                            ? "border-slate-200/80 bg-white/95 text-slate-700"
                            : "border-slate-200 bg-slate-50/95 text-slate-600",
                        )}
                      >
                        {resolveOutputDisplayIndex(index, output?.slotIndex)}
                      </span>
                    ) : null}
                    {storyboardSlotLabel ? (
                      <span className="pointer-events-none absolute inset-x-2 bottom-2 line-clamp-2 rounded-[12px] bg-slate-950/66 px-2 py-1 text-left text-[10px] font-medium leading-4 text-white backdrop-blur-[1px]">
                        {storyboardSlotLabel}
                      </span>
                    ) : null}
                    {active && output ? (
                      <span className="absolute right-2 top-2 rounded-full bg-slate-950/68 px-2.5 py-1 text-[11px] font-medium text-white">
                        当前选中
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
