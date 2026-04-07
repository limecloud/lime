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
    !(
      preview.status !== "running" &&
      isTransitionStatusMessage(statusMessage)
    )
  ) {
    return statusMessage;
  }

  const resultLabel = resolveResultLabel(preview.mode);

  switch (preview.status) {
    case "complete":
      return preview.imageCount && preview.imageCount > 1
        ? `已返回 ${preview.imageCount} 张${resultLabel}，可在右侧继续查看与使用。`
        : `${resultLabel}已经完成，可在右侧继续查看与使用。`;
    case "partial":
      return preview.imageCount && preview.imageCount > 0
        ? `已返回 ${preview.imageCount} 张${resultLabel}，剩余结果未完成。`
        : `${resultLabel}已同步一部分，可在右侧继续查看。`;
    case "cancelled":
      return "任务已经取消，当前不会继续生成新的图片结果。";
    case "failed":
      return preview.retryable === false
        ? "当前错误需要先调整配置或参数。"
        : "这次没有拿到可用结果，请调整描述后重试。";
    case "running":
    default:
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

function resolvePlaceholderLabel(preview: MessageImageWorkbenchPreview): string {
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

function renderPlaceholder(preview: MessageImageWorkbenchPreview, reason: string) {
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

export const ImageWorkbenchMessagePreview: React.FC<
  ImageWorkbenchMessagePreviewProps
> = ({ preview, onOpen }) => {
  const sourceFootnote = resolveSourceFootnote(preview);
  const statusPrefix = resolveStatusPrefix(preview);
  const statusDescription = resolveDescription(preview);

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
          "overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 transition group-hover:border-slate-300",
          preview.imageUrl
            ? "shadow-[0_18px_42px_-34px_rgba(15,23,42,0.45)]"
            : "shadow-[0_16px_38px_-34px_rgba(15,23,42,0.28)]",
        )}
      >
        <RenderableTaskImage
          src={preview.imageUrl}
          alt={preview.prompt || "图片任务结果"}
          className="aspect-[16/10] h-full w-full object-cover"
          renderFallback={(reason) => renderPlaceholder(preview, reason)}
        />
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
