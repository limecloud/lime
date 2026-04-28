import React from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { emitImageWorkbenchFocus } from "@/lib/imageWorkbenchEvents";
import { cn } from "@/lib/utils";
import type { MessageImageWorkbenchPreview } from "../types";
import { RenderableTaskImage } from "./RenderableTaskImage";

interface ImageWorkbenchMessagePreviewProps {
  preview: MessageImageWorkbenchPreview;
  onOpen?: (preview: MessageImageWorkbenchPreview) => void;
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
      return "图片结果";
  }
}

function resolveSourceLabel(
  mode?: MessageImageWorkbenchPreview["mode"],
): string {
  return mode === "variation" ? "参考图" : "来源图";
}

function resolveStatusPrefix(preview: MessageImageWorkbenchPreview): string {
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

function resolveStatusAccentClass(
  preview: MessageImageWorkbenchPreview,
): string {
  switch (preview.status) {
    case "complete":
      return "bg-emerald-500";
    case "partial":
      return "bg-amber-500";
    case "cancelled":
      return "bg-slate-400";
    case "failed":
      return "bg-rose-500";
    case "running":
    default:
      return "bg-sky-500";
  }
}

function isTransitionStatusMessage(statusMessage: string): boolean {
  return (
    statusMessage.includes("正在同步") ||
    statusMessage.includes("同步任务状态") ||
    statusMessage.includes("同步到对话") ||
    statusMessage.includes("异步队列")
  );
}

function resolveDescription(preview: MessageImageWorkbenchPreview): string {
  const statusMessage = preview.statusMessage?.trim();
  if (
    statusMessage &&
    !(preview.status !== "running" && isTransitionStatusMessage(statusMessage))
  ) {
    return statusMessage;
  }

  const resultLabel = resolveResultLabel(preview.mode);
  const storyboardLabel =
    preview.layoutHint === "storyboard_3x3" ? "3x3 分镜" : null;
  const returnedImageCount = Math.max(
    preview.previewImages?.length ?? 0,
    preview.imageUrl ? 1 : 0,
    preview.imageCount ?? 0,
  );
  const expectedImageCount = Math.max(
    preview.expectedImageCount ?? 0,
    returnedImageCount,
  );

  switch (preview.status) {
    case "complete":
      return storyboardLabel
        ? `${storyboardLabel}已经完成，可在右侧继续查看与使用。`
        : returnedImageCount > 1
          ? `已返回 ${returnedImageCount} 张${resultLabel}，可在右侧继续查看与使用。`
          : `${resultLabel}已经完成，可在右侧继续查看与使用。`;
    case "partial":
      return storyboardLabel
        ? `${storyboardLabel}已返回 ${returnedImageCount} / ${expectedImageCount || 9} 格，可在右侧继续查看。`
        : returnedImageCount > 0
          ? `已返回 ${returnedImageCount} / ${expectedImageCount || returnedImageCount} 张${resultLabel}，剩余结果未完成。`
          : `${resultLabel}已同步一部分，可在右侧继续查看。`;
    case "cancelled":
      return "任务已经取消，当前不会继续生成新的图片结果。";
    case "failed":
      return preview.retryable === false
        ? "当前错误需要先调整配置或参数。"
        : "这次没有拿到可用结果，请调整描述后重试。";
    case "running":
    default:
      if (storyboardLabel && expectedImageCount > 1) {
        return `${storyboardLabel}已创建，${expectedImageCount} 格会逐步回填到同一张任务卡里。`;
      }
      switch (preview.mode) {
        case "edit":
          return "正在处理修图，完成后会自动替换成真实结果。";
        case "variation":
          return "正在处理重绘，完成后会自动替换成真实结果。";
        case "generate":
        default:
          return "正在生成图片，完成后会自动替换成真实结果。";
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
  return resolveStatusPrefix(preview);
}

function resolveImageUnavailableLabel(
  preview: MessageImageWorkbenchPreview,
): string {
  if (preview.status === "complete" || preview.status === "partial") {
    return "图片暂时无法显示";
  }
  return resolvePlaceholderLabel(preview);
}

function shouldShowSourceFootnote(
  preview: MessageImageWorkbenchPreview,
): boolean {
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

function resolveSourceFootnote(
  preview: MessageImageWorkbenchPreview,
): string | null {
  if (!shouldShowSourceFootnote(preview)) {
    return null;
  }

  return `${resolveSourceLabel(preview.mode)}：${resolveSourceSummary(preview)}`;
}

function renderPlaceholder(
  preview: MessageImageWorkbenchPreview,
  reason: string,
) {
  return (
    <div className="flex aspect-[16/10] items-center justify-center bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] px-6 text-center">
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
  );
}

function resolvePreviewImages(preview: MessageImageWorkbenchPreview): string[] {
  const urls: string[] = [];
  (preview.previewImages || []).forEach((value) => {
    const normalized = value.trim();
    if (!normalized || urls.includes(normalized)) {
      return;
    }
    urls.push(normalized);
  });
  const primaryUrl = preview.imageUrl?.trim();
  if (primaryUrl && !urls.includes(primaryUrl)) {
    urls.unshift(primaryUrl);
  }
  return urls.slice(0, 9);
}

function resolvePreviewCardAspectClass(
  preview: MessageImageWorkbenchPreview,
  imageCount: number,
): string {
  if (preview.layoutHint === "storyboard_3x3" && imageCount >= 4) {
    return "aspect-square";
  }
  return "aspect-[16/10]";
}

function resolveStoryboardSlotLabel(
  preview: MessageImageWorkbenchPreview,
  index: number,
): string | null {
  return (
    preview.storyboardSlots?.find((slot) => slot.slotIndex === index + 1)
      ?.label || null
  );
}

function resolvePreviewMetaLabels(
  preview: MessageImageWorkbenchPreview,
  imageCount: number,
  expectedImageCount: number,
): string[] {
  const labels: string[] = [];

  if (preview.layoutHint === "storyboard_3x3" && expectedImageCount >= 4) {
    labels.push("3x3 分镜");
  }

  if (expectedImageCount > imageCount && expectedImageCount > 1) {
    labels.push(`${imageCount}/${expectedImageCount} 张`);
  } else if (imageCount > 1) {
    labels.push(`${imageCount} 张`);
  }

  return labels;
}

function renderPreviewMedia(preview: MessageImageWorkbenchPreview) {
  const previewImages = resolvePreviewImages(preview);
  const expectedImageCount = Math.max(
    preview.expectedImageCount ?? 0,
    preview.imageCount ?? 0,
    previewImages.length,
  );
  const isStoryboardGrid = preview.layoutHint === "storyboard_3x3";
  const totalSlotCount = isStoryboardGrid
    ? Math.max(expectedImageCount, 9)
    : previewImages.length;
  const aspectClass = resolvePreviewCardAspectClass(preview, totalSlotCount);

  if (!isStoryboardGrid && previewImages.length <= 1) {
    return (
      <RenderableTaskImage
        src={previewImages[0] || preview.imageUrl}
        alt={preview.prompt || "图片任务结果"}
        className={cn(aspectClass, "h-full w-full object-cover")}
        renderFallback={(reason) => renderPlaceholder(preview, reason)}
      />
    );
  }

  const visibleCount = isStoryboardGrid
    ? Math.min(totalSlotCount, 9)
    : Math.min(previewImages.length, previewImages.length <= 4 ? 4 : 6);
  const extraCount = Math.max(0, previewImages.length - visibleCount);
  const columnsClass = isStoryboardGrid
    ? "grid-cols-3"
    : visibleCount <= 4
      ? "grid-cols-2"
      : "grid-cols-3";

  return (
    <div
      data-testid={`image-workbench-message-preview-grid-${preview.taskId}`}
      className={cn(
        "grid gap-1.5 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-1.5",
        aspectClass,
        columnsClass,
      )}
    >
      {Array.from({ length: visibleCount }, (_, index) => {
        const url = previewImages[index];
        const isLastWithOverflow = extraCount > 0 && index === visibleCount - 1;
        const storyboardSlotLabel = isStoryboardGrid
          ? resolveStoryboardSlotLabel(preview, index)
          : null;
        return (
          <div
            key={`${url || "placeholder"}-${index}`}
            className={cn(
              "relative overflow-hidden rounded-[16px] border border-slate-200/80 bg-white",
              isStoryboardGrid ? "aspect-square" : "aspect-[4/3]",
            )}
          >
            {url ? (
              <RenderableTaskImage
                src={url}
                alt={`${preview.prompt || "图片任务结果"} ${index + 1}`}
                className="h-full w-full object-cover"
                renderFallback={() => (
                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[11px] font-medium text-slate-400">
                    预览失败
                  </div>
                )}
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] text-[11px] font-medium text-slate-400">
                {preview.status === "running" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-500" />
                ) : (
                  <Sparkles className="h-4 w-4 text-slate-300" />
                )}
                <span>
                  {preview.status === "partial"
                    ? "等待补齐"
                    : preview.status === "failed"
                      ? "本格失败"
                      : preview.status === "cancelled"
                        ? "已取消"
                        : "待生成"}
                </span>
              </div>
            )}
            {isStoryboardGrid ? (
              <>
                <span className="absolute left-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-slate-200/80 bg-white/95 px-1.5 text-[11px] font-semibold text-slate-700 shadow-sm shadow-slate-950/5">
                  {index + 1}
                </span>
                {storyboardSlotLabel ? (
                  <span className="pointer-events-none absolute inset-x-2 bottom-2 line-clamp-2 rounded-[12px] bg-slate-950/66 px-2 py-1 text-[10px] font-medium leading-4 text-white backdrop-blur-[1px]">
                    {storyboardSlotLabel}
                  </span>
                ) : null}
              </>
            ) : null}
            {isLastWithOverflow ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/48 text-sm font-semibold text-white">
                +{extraCount}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export const ImageWorkbenchMessagePreview: React.FC<
  ImageWorkbenchMessagePreviewProps
> = ({ preview, onOpen }) => {
  const sourceFootnote = resolveSourceFootnote(preview);
  const statusPrefix = resolveStatusPrefix(preview);
  const statusDescription = resolveDescription(preview);
  const previewImages = resolvePreviewImages(preview);
  const totalImageCount = Math.max(
    preview.imageCount ?? 0,
    preview.imageUrl ? 1 : 0,
    previewImages.length,
  );
  const expectedImageCount = Math.max(
    preview.expectedImageCount ?? 0,
    totalImageCount,
  );
  const previewMetaLabels = resolvePreviewMetaLabels(
    preview,
    totalImageCount,
    expectedImageCount,
  );

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpen) {
          onOpen(preview);
          return;
        }
        emitImageWorkbenchFocus({
          projectId: preview.projectId ?? null,
          contentId: preview.contentId ?? null,
        });
      }}
      data-testid={`image-workbench-message-preview-${preview.taskId}`}
      className="group block w-full max-w-[360px] text-left sm:max-w-[400px] lg:max-w-[440px]"
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 transition group-hover:border-slate-300",
          previewImages.length > 0
            ? "shadow-[0_18px_42px_-34px_rgba(15,23,42,0.45)]"
            : "shadow-[0_16px_38px_-34px_rgba(15,23,42,0.28)]",
        )}
      >
        {previewMetaLabels.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-wrap items-center gap-1.5">
            {previewMetaLabels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/95 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm shadow-slate-950/5"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {renderPreviewMedia(preview)}
      </div>

      <div className="space-y-1.5 px-0.5 pt-3">
        <div className="line-clamp-2 text-[15px] font-medium leading-6 text-slate-900">
          {preview.prompt || "当前任务未提供提示词。"}
        </div>

        <div className="flex items-start gap-2 text-[13px] leading-5 text-slate-500">
          <span
            className={cn(
              "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
              resolveStatusAccentClass(preview),
            )}
          />
          <span>
            <span className="font-medium text-slate-700">{statusPrefix}</span>
            <span>{` · ${statusDescription}`}</span>
          </span>
        </div>

        {sourceFootnote ? (
          <div className="line-clamp-2 text-[12px] leading-5 text-slate-400">
            {sourceFootnote}
          </div>
        ) : null}
      </div>
    </button>
  );
};
