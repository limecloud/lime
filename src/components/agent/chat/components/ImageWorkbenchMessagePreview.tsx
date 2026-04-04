import React from "react";
import {
  ArrowUpRight,
  ImagePlus,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { emitImageWorkbenchFocus } from "@/lib/imageWorkbenchEvents";
import { cn } from "@/lib/utils";
import type { MessageImageWorkbenchPreview } from "../types";

interface ImageWorkbenchMessagePreviewProps {
  preview: MessageImageWorkbenchPreview;
}

function resolveStatusLabel(
  status: MessageImageWorkbenchPreview["status"],
): string {
  switch (status) {
    case "complete":
      return "已生成";
    case "partial":
      return "部分完成";
    case "failed":
      return "生成失败";
    case "running":
    default:
      return "处理中";
  }
}

function resolveStatusDescription(
  preview: MessageImageWorkbenchPreview,
): string {
  switch (preview.status) {
    case "complete":
      return preview.imageCount && preview.imageCount > 1
        ? `共生成 ${preview.imageCount} 张结果，点击查看图片画布。`
        : "结果已返回，点击查看图片画布。";
    case "partial":
      return preview.imageCount && preview.imageCount > 0
        ? `已返回 ${preview.imageCount} 张结果，点击查看图片画布。`
        : "部分结果已返回，点击查看图片画布。";
    case "failed":
      return "这次没有拿到可用图片结果，可在图片画布里继续排查。";
    case "running":
    default:
      return "正在生成预览图，完成后会在这里直接替换结果。";
  }
}

function resolveStatusClassName(
  status: MessageImageWorkbenchPreview["status"],
): string {
  switch (status) {
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "running":
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

export const ImageWorkbenchMessagePreview: React.FC<
  ImageWorkbenchMessagePreviewProps
> = ({ preview }) => {
  const hasImage = Boolean(preview.imageUrl?.trim());
  const showRunningPlaceholder = !hasImage && preview.status === "running";
  const showFailedPlaceholder = !hasImage && preview.status === "failed";
  const showSyncedPlaceholder =
    !hasImage &&
    (preview.status === "complete" || preview.status === "partial");

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
      className="group mt-3 w-full overflow-hidden rounded-[22px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_100%)] text-left shadow-sm shadow-slate-950/5 transition hover:border-slate-300 hover:shadow-slate-950/10"
    >
      <div className="grid gap-3 p-3 sm:grid-cols-[220px,minmax(0,1fr)]">
        <div className="relative overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
          <div className="aspect-[16/10]">
            {hasImage ? (
              <img
                src={preview.imageUrl ?? ""}
                alt={preview.prompt || "图片任务结果"}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.28),transparent_58%),linear-gradient(135deg,rgba(241,245,249,0.98),rgba(226,232,240,0.92))]">
                {showRunningPlaceholder ? (
                  <div className="absolute inset-0 animate-pulse bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.52)_48%,transparent_100%)]" />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.5),transparent_68%)]" />
                )}
                <div className="relative flex flex-col items-center gap-2 px-4 text-center text-slate-500">
                  {showRunningPlaceholder ? (
                    <LoaderCircle className="h-8 w-8 animate-spin" />
                  ) : showFailedPlaceholder ? (
                    <ImagePlus className="h-8 w-8" />
                  ) : (
                    <Sparkles className="h-8 w-8 text-emerald-500" />
                  )}
                  <span className="text-xs font-medium">
                    {showRunningPlaceholder
                      ? "正在生成预览"
                      : showFailedPlaceholder
                        ? "等待重新生成"
                        : "结果已同步"}
                  </span>
                  {showSyncedPlaceholder ? (
                    <span className="text-[11px] text-slate-400">
                      点击查看图片画布
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm",
                resolveStatusClassName(preview.status),
              )}
            >
              {preview.status === "running" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {resolveStatusLabel(preview.status)}
            </span>
            {preview.imageCount && preview.imageCount > 0 ? (
              <span className="rounded-full border border-slate-200 bg-white/92 px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm">
                {preview.imageCount} 张
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ImagePlus className="h-4 w-4 text-sky-600" />
              <span>图片任务卡</span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition group-hover:text-slate-700">
              <span>点击查看图片画布</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
            {preview.prompt || "当前任务未提供提示词。"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{resolveStatusDescription(preview)}</span>
            {preview.size ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                {preview.size}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
};
