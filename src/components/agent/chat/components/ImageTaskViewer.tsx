import { useTranslation } from "react-i18next";
import { LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { createPreviewArtifact } from "@/lib/artifact/previewArtifact";
import { cn } from "@/lib/utils";
import { RenderableTaskImage } from "./RenderableTaskImage";
import type { ImageTaskViewerProps } from "./imageWorkbenchTypes";
import {
  buildFollowUpCommand,
  canRetryImageTask,
  orderTaskOutputsByTaskOutputIds,
  resolveEmptyStateDescription,
  resolveFollowUpLabel,
  resolveImageUnavailableDescription,
  resolveImageUnavailableTitle,
  resolveLayoutLabel,
  resolveModeEyebrow,
  resolveOutputGridClassName,
  resolveOutputTileAspectClass,
  resolveOutputDisplayIndexForLabel,
  resolveSelectedOutputLabel,
  resolveSelectedStoryboardSlot,
  resolveSourceLabel,
  resolveSourcePlaceholderLabel,
  resolveStatusLabel,
  resolveStatusTone,
} from "./ImageTaskViewerViewModel";

const IMAGE_TASK_PRIMARY_BUTTON_CLASSNAME =
  "inline-flex items-center justify-center rounded-full border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95";

export function ImageTaskViewer({
  tasks,
  outputs,
  selectedTaskId,
  selectedOutputId,
  sourceProjectId,
  sourceContentId,
  sourceThreadId,
  onOpenArtifact,
  applySelectedOutputLabel,
  onApplySelectedOutput,
  onRetryTask,
  onSeedFollowUpCommand,
  onSelectOutput,
  onClose,
}: ImageTaskViewerProps) {
  const { t } = useTranslation("agent");
  const selectedTaskById = selectedTaskId
    ? (tasks.find((item) => item.id === selectedTaskId) ?? null)
    : null;
  const selectedOutputById = selectedOutputId
    ? (outputs.find((item) => item.id === selectedOutputId) ?? null)
    : null;
  const selectedOutput =
    selectedOutputById &&
    (!selectedTaskById || selectedOutputById.taskId === selectedTaskById.id)
      ? selectedOutputById
      : selectedTaskById
        ? (outputs.find((item) => item.taskId === selectedTaskById.id) ?? null)
        : (selectedOutputById ?? outputs[0] ?? null);
  const selectedTask =
    selectedTaskById ??
    (selectedOutput
      ? tasks.find((item) => item.id === selectedOutput.taskId)
      : null) ??
    tasks[0] ??
    null;
  const selectedTaskOutputs = selectedTask
    ? orderTaskOutputsByTaskOutputIds(
        selectedTask,
        outputs.filter((item) => item.taskId === selectedTask.id),
      )
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
  const selectedStoryboardSlot = resolveSelectedStoryboardSlot({
    task: selectedTask,
    output: selectedOutput,
    outputIndex: selectedOutputIndex,
    t,
  });
  const statusLabel = resolveStatusLabel(
    selectedTask?.status,
    selectedTask?.mode,
    t,
  );
  const layoutLabel = resolveLayoutLabel(selectedTask?.layoutHint, t);
  const selectedOutputLabel = resolveSelectedOutputLabel({
    selectedIndex: selectedOutputIndex,
    outputCount: expectedOutputCount,
    layoutHint: selectedTask?.layoutHint,
    t,
  });
  const prompt =
    selectedOutput?.prompt?.trim() ||
    selectedTask?.prompt?.trim() ||
    t("agentChat.imageTaskViewer.promptFallback");
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
      ? t("agentChat.imageTaskViewer.source.refSummary", {
          ref: sourceImageRef,
        })
      : selectedTask?.mode === "variation"
        ? t("agentChat.imageTaskViewer.source.variationSummary")
        : t("agentChat.imageTaskViewer.source.editSummary");
  const followUpCommand = buildFollowUpCommand({
    mode: selectedTask?.mode,
    outputRef: selectedOutput?.refId,
    prompt: selectedTask?.prompt,
  });
  const canContinueEdit = Boolean(followUpCommand && onSeedFollowUpCommand);
  const canRetryTask = Boolean(
    selectedTask?.id && onRetryTask && canRetryImageTask(selectedTask.status),
  );
  const handleOpenSelectedImagePreview = () => {
    if (!selectedOutput) {
      return;
    }

    onOpenArtifact(
      createPreviewArtifact({
        source: "task",
        sourceRef: selectedOutput.id,
        title: selectedStoryboardSlot?.label || selectedOutput.prompt || prompt,
        previewUrl: selectedOutput.url,
        isBinary: true,
        mimeType: "image/png",
        meta: {
          taskId: selectedOutput.taskId,
          outputId: selectedOutput.id,
          prompt: selectedOutput.slotPrompt || selectedOutput.prompt || prompt,
          slotLabel: selectedStoryboardSlot?.label,
          projectId: sourceProjectId,
          contentId: sourceContentId,
          threadId: sourceThreadId,
        },
      }).artifact,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
      <div className="border-b border-slate-200 px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {resolveModeEyebrow(selectedTask?.mode, t)}
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
                aria-label={t("agentChat.imageTaskViewer.action.close")}
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
                alt={
                  selectedOutput.prompt ||
                  t("agentChat.imageTaskViewer.media.resultAlt")
                }
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
                        {selectedStoryboardSlot?.label ||
                          t("agentChat.imageTaskViewer.media.openSingle")}
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
                          ? resolveImageUnavailableTitle(
                              selectedTask?.status,
                              selectedTask?.mode,
                              t,
                            )
                          : statusLabel}
                      </div>
                      <div className="text-sm leading-6 text-slate-500">
                        {reason === "error"
                          ? resolveImageUnavailableDescription(
                              selectedTask?.mode,
                              t,
                            )
                          : resolveEmptyStateDescription(
                              selectedTask?.status,
                              selectedTask?.failureMessage,
                              selectedTask?.mode,
                              t,
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
                      t,
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
              {resolveSourceLabel(selectedTask?.mode, t)}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-white">
                <RenderableTaskImage
                  src={sourceImageUrl}
                  data-testid="image-task-viewer-source-image"
                  alt={
                    sourceImagePrompt ||
                    resolveSourceLabel(selectedTask?.mode, t)
                  }
                  className="h-full w-full object-cover"
                  renderFallback={(reason) => (
                    <span className="px-2 text-center text-[11px] font-medium text-slate-400">
                      {resolveSourcePlaceholderLabel(
                        selectedTask?.mode,
                        reason,
                        t,
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
                      {t("agentChat.imageTaskViewer.source.imageCount", {
                        count: sourceImageCount,
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
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
          {selectedOutput?.size ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {selectedOutput.size}
            </span>
          ) : null}
          {expectedOutputCount > 0 ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {expectedOutputCount > selectedTaskOutputs.length
                ? t("agentChat.imageTaskViewer.resultCount.partial", {
                    current: selectedTaskOutputs.length,
                    total: expectedOutputCount,
                  })
                : t("agentChat.imageTaskViewer.resultCount.complete", {
                    count: selectedTaskOutputs.length,
                  })}
            </span>
          ) : null}
        </div>

        {canRetryTask ||
        canContinueEdit ||
        (selectedOutput && onApplySelectedOutput) ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canRetryTask ? (
              <button
                type="button"
                data-testid="image-task-viewer-action-retry"
                onClick={() => {
                  if (!selectedTask?.id) {
                    return;
                  }
                  onRetryTask?.(selectedTask.id);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 transition hover:border-amber-300 hover:bg-amber-100"
              >
                <RotateCcw className="h-4 w-4" />
                {t("agentChat.imageWorkbenchPreview.action.retry")}
              </button>
            ) : null}
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
                {resolveFollowUpLabel(selectedTask?.mode, t)}
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
              const storyboardSlotLabel = resolveSelectedStoryboardSlot({
                task: selectedTask,
                output,
                outputIndex: index,
                t,
              })?.label;
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
                        alt={
                          output.prompt ||
                          t("agentChat.imageTaskViewer.media.thumbAlt")
                        }
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
                            {t("agentChat.imageTaskViewer.media.previewFailed")}
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
                            ? t("agentChat.imageTaskViewer.slot.failed")
                            : selectedTask?.status === "cancelled"
                              ? t("agentChat.imageTaskViewer.slot.cancelled")
                              : t("agentChat.imageTaskViewer.slot.pending")}
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
                        {resolveOutputDisplayIndexForLabel(
                          index,
                          output?.slotIndex,
                        )}
                      </span>
                    ) : null}
                    {storyboardSlotLabel ? (
                      <span className="pointer-events-none absolute inset-x-2 bottom-2 line-clamp-2 rounded-[12px] bg-slate-950/66 px-2 py-1 text-left text-[10px] font-medium leading-4 text-white backdrop-blur-[1px]">
                        {storyboardSlotLabel}
                      </span>
                    ) : null}
                    {active && output ? (
                      <span className="absolute right-2 top-2 rounded-full bg-slate-950/68 px-2.5 py-1 text-[11px] font-medium text-white">
                        {t("agentChat.imageTaskViewer.selected.current")}
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
