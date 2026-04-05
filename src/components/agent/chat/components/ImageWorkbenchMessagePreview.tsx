import React from "react";
import { ArrowUpRight, LoaderCircle, Sparkles } from "lucide-react";
import { emitImageWorkbenchFocus } from "@/lib/imageWorkbenchEvents";
import { cn } from "@/lib/utils";
import type { MessageImageWorkbenchPreview } from "../types";
import { RenderableTaskImage } from "./RenderableTaskImage";

interface ImageWorkbenchMessagePreviewProps {
  preview: MessageImageWorkbenchPreview;
}

function resolveModeEyebrow(
  mode?: MessageImageWorkbenchPreview["mode"],
): string {
  switch (mode) {
    case "edit":
      return "Image Editing";
    case "variation":
      return "Image Redraw";
    case "generate":
    default:
      return "Image Generation";
  }
}

function resolveResultLabel(
  mode?: MessageImageWorkbenchPreview["mode"],
): string {
  switch (mode) {
    case "edit":
      return "修图结果";
    case "variation":
      return "重绘结果";
    case "generate":
    default:
      return "图片";
  }
}

function resolveSourceLabel(
  mode?: MessageImageWorkbenchPreview["mode"],
): string {
  return mode === "variation" ? "参考图" : "来源图";
}

function resolveStatusLabel(preview: MessageImageWorkbenchPreview): string {
  switch (preview.status) {
    case "complete":
      switch (preview.mode) {
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
    case "failed":
      switch (preview.mode) {
        case "edit":
          return "修图失败";
        case "variation":
          return "重绘失败";
        case "generate":
        default:
          return "生成失败";
      }
    case "running":
    default:
      switch ((preview.phase || "").trim().toLowerCase()) {
        case "queued":
          return "等待队列";
        case "running":
          switch (preview.mode) {
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
}

function resolveStatusTone(preview: MessageImageWorkbenchPreview): string {
  switch (preview.status) {
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function resolveDescription(preview: MessageImageWorkbenchPreview): string {
  const statusMessage = preview.statusMessage?.trim();
  if (statusMessage) {
    return statusMessage;
  }

  const resultLabel = resolveResultLabel(preview.mode);

  switch (preview.status) {
    case "complete":
      return preview.imageCount && preview.imageCount > 1
        ? `已返回 ${preview.imageCount} 张${resultLabel}，打开查看即可。`
        : `${resultLabel}已经完成，打开查看即可。`;
    case "partial":
      return preview.imageCount && preview.imageCount > 0
        ? `已返回 ${preview.imageCount} 张${resultLabel}，剩余结果未完成。`
        : `${resultLabel}任务返回了部分结果。`;
    case "cancelled":
      return "任务已经取消，当前不会继续生成新的图片结果。";
    case "failed":
      return preview.retryable === false
        ? "当前错误需要先调整配置或参数。"
        : "这次没有拿到可用结果，请稍后重试。";
    case "running":
    default:
      switch (preview.mode) {
        case "edit":
          return "图片编辑中，完成后会直接替换成真实结果。";
        case "variation":
          return "图片重绘中，完成后会直接替换成真实结果。";
        case "generate":
        default:
          return "图片生成中，完成后会直接替换成真实结果。";
      }
  }
}

function resolvePlaceholderLabel(
  preview: MessageImageWorkbenchPreview,
): string {
  if (preview.status === "failed") {
    return "暂未生成成功";
  }
  if (preview.status === "cancelled") {
    return "任务已取消";
  }
  if (preview.status === "complete" || preview.status === "partial") {
    return "结果已同步";
  }
  return resolveStatusLabel(preview);
}

function resolveImageUnavailableLabel(
  preview: MessageImageWorkbenchPreview,
): string {
  if (preview.status === "complete" || preview.status === "partial") {
    return "图片暂时无法显示";
  }
  return resolvePlaceholderLabel(preview);
}

function shouldShowSourcePanel(preview: MessageImageWorkbenchPreview): boolean {
  return Boolean(
    preview.mode === "edit" ||
    preview.mode === "variation" ||
    preview.sourceImageUrl?.trim() ||
    preview.sourceImagePrompt?.trim() ||
    preview.sourceImageRef?.trim() ||
    preview.sourceImageCount,
  );
}

function resolveSourceSummary(preview: MessageImageWorkbenchPreview): string {
  const prompt = preview.sourceImagePrompt?.trim();
  if (prompt) {
    return prompt;
  }

  const ref = preview.sourceImageRef?.trim();
  if (ref) {
    return `已引用 ${ref}`;
  }

  if (preview.sourceImageCount && preview.sourceImageCount > 1) {
    return preview.mode === "variation"
      ? `已附加 ${preview.sourceImageCount} 张参考图。`
      : `已引用 ${preview.sourceImageCount} 张来源图。`;
  }

  return preview.mode === "variation"
    ? "当前任务会基于参考图继续生成新的重绘结果。"
    : "当前任务会基于已有图片结果继续完成修图。";
}

function resolveSourcePlaceholderLabel(
  preview: MessageImageWorkbenchPreview,
): string {
  return preview.mode === "variation" ? "参考图待同步" : "来源图待同步";
}

export const ImageWorkbenchMessagePreview: React.FC<
  ImageWorkbenchMessagePreviewProps
> = ({ preview }) => {
  const showSourcePanel = shouldShowSourcePanel(preview);

  return (
    <button
      type="button"
      onClick={() =>
        emitImageWorkbenchFocus({
          projectId: preview.projectId ?? null,
          contentId: preview.contentId ?? null,
        })
      }
      data-testid={`image-workbench-message-preview-${preview.taskId}`}
      className="mt-3 block w-full max-w-[560px] text-left"
    >
      <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:shadow-slate-950/10">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                resolveStatusTone(preview),
              )}
            >
              {preview.status === "running" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {resolveStatusLabel(preview)}
            </span>
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {resolveModeEyebrow(preview.mode)}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
            <span>打开查看</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="px-4 pb-4">
          <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-slate-50">
              <RenderableTaskImage
                src={preview.imageUrl}
                alt={preview.prompt || "图片任务结果"}
                className="aspect-[16/10] h-full w-full object-cover"
                renderFallback={(reason) => (
                  <div className="flex aspect-[16/10] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_46%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] px-6 text-center">
                    <div className="space-y-2">
                      {reason === "empty" && preview.status === "running" ? (
                        <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-sky-500" />
                      ) : (
                        <Sparkles className="mx-auto h-7 w-7 text-slate-400" />
                      )}
                      <div className="text-sm font-medium text-slate-700">
                        {reason === "error"
                          ? resolveImageUnavailableLabel(preview)
                          : resolvePlaceholderLabel(preview)}
                      </div>
                    </div>
                  </div>
                )}
              />
            </div>
            <div className="min-w-0">
              <div className="line-clamp-2 text-sm font-medium leading-6 text-slate-900">
                {preview.prompt || "当前任务未提供提示词。"}
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-500">
                {resolveDescription(preview)}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                {preview.size ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                    {preview.size}
                  </span>
                ) : null}
                {preview.imageCount && preview.imageCount > 0 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                    {preview.imageCount} 张
                  </span>
                ) : null}
                {preview.attemptCount && preview.attemptCount > 1 ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                    第 {preview.attemptCount} 次
                  </span>
                ) : null}
              </div>

              {showSourcePanel ? (
                <div
                  data-testid={`image-workbench-message-preview-source-${preview.taskId}`}
                  className="mt-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="text-[11px] font-medium text-slate-500">
                    {resolveSourceLabel(preview.mode)}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <RenderableTaskImage
                        src={preview.sourceImageUrl}
                        alt={
                          preview.sourceImagePrompt ||
                          resolveSourceLabel(preview.mode)
                        }
                        className="h-full w-full object-cover"
                        renderFallback={(reason) => (
                          <span className="px-2 text-center text-[11px] font-medium text-slate-400">
                            {reason === "error"
                              ? `${resolveSourceLabel(preview.mode)}暂时无法显示`
                              : resolveSourcePlaceholderLabel(preview)}
                          </span>
                        )}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-xs font-medium leading-5 text-slate-700">
                        {resolveSourceSummary(preview)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        {preview.sourceImageRef ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                            {preview.sourceImageRef}
                          </span>
                        ) : null}
                        {preview.sourceImageCount &&
                        preview.sourceImageCount > 0 ? (
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                            {preview.sourceImageCount} 张
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};
