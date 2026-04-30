import React from "react";
import {
  ArrowUpRight,
  Clapperboard,
  FileText,
  Link2,
  LoaderCircle,
  Mic,
  PlayCircle,
  Search,
  Volume2,
} from "lucide-react";
import { emitVideoWorkbenchTaskAction } from "@/lib/videoWorkbenchEvents";
import { cn } from "@/lib/utils";
import type { MessageTaskPreview } from "../types";
import {
  countTranscriptSpeakers,
  formatTranscriptSegmentRange,
} from "../utils/transcriptSegments";

interface TaskMessagePreviewProps {
  preview: MessageTaskPreview;
  onOpen?: (preview: MessageTaskPreview) => void;
}

function resolveTaskLabel(preview: MessageTaskPreview): string {
  switch (preview.kind) {
    case "audio_generate":
      return "配音生成";
    case "video_generate":
      return "视频生成";
    case "broadcast_generate":
      return "播报整理";
    case "modal_resource_search":
      return "素材检索";
    case "transcription_generate":
      return "内容转写";
    case "url_parse":
      return "链接解析";
    case "typesetting":
      return "排版优化";
  }

  const exhaustiveCheck: never = preview;
  return exhaustiveCheck;
}

function resolveStatusLabel(preview: MessageTaskPreview): string {
  switch (preview.status) {
    case "complete":
      return "已完成";
    case "partial":
      return "部分完成";
    case "failed":
      return "执行失败";
    case "cancelled":
      return "已取消";
    case "running":
    default:
      if ((preview.phase || "").trim().toLowerCase() === "queued") {
        return "排队中";
      }
      return "执行中";
  }
}

function resolveStatusTone(preview: MessageTaskPreview): string {
  switch (preview.status) {
    case "complete":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partial":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "running":
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function resolveDescription(preview: MessageTaskPreview): string {
  const statusMessage = preview.statusMessage?.trim();
  if (statusMessage) {
    return statusMessage;
  }

  if (preview.kind === "video_generate") {
    switch (preview.status) {
      case "complete":
        return "视频已经生成完成，打开查看即可继续预览和管理任务。";
      case "partial":
        return "任务返回了部分结果，打开查看可继续确认可用片段。";
      case "failed":
        return "这次没有拿到可用视频结果，请调整参数后重试。";
      case "cancelled":
        return "任务已经取消，当前不会继续生成新的结果。";
      case "running":
      default:
        return "任务已提交到异步队列，工作区会继续同步最新生成状态。";
    }
  }

  if (preview.kind === "audio_generate") {
    switch (preview.status) {
      case "complete":
      case "partial":
        return preview.audioUrl?.trim()
          ? "音频结果已同步，打开查看即可继续预览与管理任务。"
          : "配音任务已完成，正在同步音频结果。";
      case "failed":
        return "配音生成失败，请调整文本、音色或模型后重试。";
      case "cancelled":
        return "配音任务已经取消，当前不会继续生成音频。";
      case "running":
      default:
        return "配音任务已写入统一 audio_task/audio_output 协议，工作区会继续同步结果。";
    }
  }

  switch (preview.status) {
    case "complete":
    case "partial":
      return "任务结果已同步，打开查看即可继续处理。";
    case "failed":
      return "任务执行失败，请调整输入后重试。";
    case "cancelled":
      return "任务已经取消，当前不会继续执行。";
    case "running":
    default:
      return "任务已进入统一执行主链，工作区会继续同步最新状态。";
  }
}

function formatDurationLabel(durationSeconds?: number): string | null {
  if (
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return null;
  }
  return `${durationSeconds} 秒`;
}

function formatProgressLabel(progress?: number | null): string | null {
  if (
    typeof progress !== "number" ||
    !Number.isFinite(progress) ||
    progress <= 0
  ) {
    return null;
  }
  return `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

function buildMetaItems(preview: MessageTaskPreview): string[] {
  if (preview.kind === "video_generate") {
    const items = [
      preview.aspectRatio?.trim(),
      preview.resolution?.trim(),
      formatDurationLabel(preview.durationSeconds),
      formatProgressLabel(preview.progress),
    ].filter((item): item is string => Boolean(item));

    if (preview.model?.trim()) {
      items.push(preview.model.trim());
    }

    return items;
  }

  const items = [...(preview.metaItems || [])];
  if (preview.model?.trim()) {
    items.push(preview.model.trim());
  }
  if (
    (preview.kind === "audio_generate" ||
      preview.kind === "transcription_generate") &&
    preview.errorCode?.trim()
  ) {
    items.push(`错误码: ${preview.errorCode.trim()}`);
  }
  if (preview.kind === "transcription_generate") {
    if (preview.language?.trim()) {
      items.push(preview.language.trim());
    }
    if (preview.outputFormat?.trim()) {
      items.push(preview.outputFormat.trim());
    }
    if (preview.transcriptSegments && preview.transcriptSegments.length > 0) {
      items.push(`${preview.transcriptSegments.length} 段时间轴`);
      const speakerCount = countTranscriptSpeakers(preview.transcriptSegments);
      if (speakerCount > 0) {
        items.push(`${speakerCount} 位说话人`);
      }
    }
  }
  return items.filter((item) => item.trim().length > 0);
}

function resolveGenericTaskIcon(
  preview: Exclude<MessageTaskPreview, { kind: "video_generate" }>,
) {
  switch (preview.kind) {
    case "audio_generate":
      return Volume2;
    case "broadcast_generate":
      return Mic;
    case "modal_resource_search":
      return Search;
    case "url_parse":
      return Link2;
    case "transcription_generate":
    case "typesetting":
    default:
      return FileText;
  }
}

function renderGenericTaskMedia(
  preview: Exclude<MessageTaskPreview, { kind: "video_generate" }>,
  Icon: ReturnType<typeof resolveGenericTaskIcon>,
) {
  if (preview.kind === "audio_generate") {
    const playableAudioUrl = preview.audioUrl?.trim();
    return (
      <div className="flex h-20 w-28 shrink-0 flex-col justify-between rounded-[18px] border border-sky-100 bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.18),transparent_48%),linear-gradient(180deg,#f8fafc,#eef6ff)] p-2 text-sky-700">
        <div className="flex items-center justify-between gap-2">
          <Volume2 className="h-5 w-5" />
          <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-sky-700">
            audio
          </span>
        </div>
        {playableAudioUrl ? (
          <audio
            controls
            src={playableAudioUrl}
            className="h-7 w-full"
            aria-label="配音任务音频预览"
          />
        ) : (
          <div className="flex items-end gap-1 text-sky-400">
            {[14, 22, 11, 28, 18].map((height, index) => (
              <span
                key={`${preview.taskId}-wave-${index}`}
                className="w-1.5 rounded-full bg-sky-300"
                style={{ height }}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (
    preview.kind === "modal_resource_search" &&
    preview.imageCandidates &&
    preview.imageCandidates.length > 0
  ) {
    return (
      <div
        data-testid={`task-message-preview-media-${preview.taskId}`}
        className="grid h-20 w-28 shrink-0 grid-cols-2 gap-1 overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100 p-1"
      >
        {preview.imageCandidates.slice(0, 4).map((candidate, index) => (
          <div
            key={`${candidate.id}-${index}`}
            className={cn(
              "overflow-hidden rounded-xl bg-slate-200",
              preview.imageCandidates!.length === 1 ? "col-span-2" : "",
              preview.imageCandidates!.length === 3 && index === 0
                ? "row-span-2"
                : "",
            )}
          >
            <img
              src={candidate.thumbnailUrl}
              alt={candidate.name || "素材候选"}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border border-slate-200 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_46%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] text-sky-600">
      <Icon className="h-7 w-7" />
    </div>
  );
}

function renderTaskFailureDetails(
  preview: Exclude<MessageTaskPreview, { kind: "video_generate" }>,
) {
  if (
    (preview.kind !== "audio_generate" &&
      preview.kind !== "transcription_generate") ||
    preview.status !== "failed"
  ) {
    return null;
  }
  const errorCode = preview.errorCode?.trim();
  const errorMessage = preview.errorMessage?.trim();
  if (!errorCode && !errorMessage) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs leading-5 text-rose-700">
      {errorCode ? (
        <div className="font-semibold">错误码：{errorCode}</div>
      ) : null}
      {errorMessage ? <div>{errorMessage}</div> : null}
    </div>
  );
}

function renderTranscriptionSegmentSummary(
  preview: Exclude<MessageTaskPreview, { kind: "video_generate" }>,
) {
  if (
    preview.kind !== "transcription_generate" ||
    !preview.transcriptSegments ||
    preview.transcriptSegments.length === 0
  ) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
        时间轴预览
      </div>
      <div className="space-y-1.5">
        {preview.transcriptSegments.slice(0, 2).map((segment) => (
          <div
            key={`${preview.taskId}-${segment.id}`}
            className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-xs leading-5"
          >
            <span className="font-medium text-slate-500">
              {formatTranscriptSegmentRange(segment)}
            </span>
            <span className="line-clamp-2 text-slate-700">
              {segment.speaker ? `${segment.speaker}：` : ""}
              {segment.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderVideoTaskPreview(
  preview: Extract<MessageTaskPreview, { kind: "video_generate" }>,
  onOpen?: (preview: MessageTaskPreview) => void,
  metaItems: string[] = [],
) {
  const actionButtons =
    preview.status === "running"
      ? [
          {
            key: "cancel" as const,
            label: "取消任务",
          },
        ]
      : (preview.status === "failed" || preview.status === "cancelled") &&
          preview.retryable !== false
        ? [
            {
              key: "retry" as const,
              label: "重新生成",
            },
          ]
        : [];

  return (
    <div className="mt-3 w-full max-w-[560px]">
      <button
        type="button"
        onClick={() => onOpen?.(preview)}
        data-testid={`task-message-preview-${preview.taskId}`}
        className="block w-full text-left"
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
                  <Clapperboard className="h-3.5 w-3.5" />
                )}
                {resolveStatusLabel(preview)}
              </span>
              <span className="truncate text-[11px] font-semibold text-slate-500">
                {resolveTaskLabel(preview)}
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <span>打开查看</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-[220px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-slate-50">
              {preview.thumbnailUrl ? (
                <img
                  src={preview.thumbnailUrl}
                  alt={preview.prompt || "视频任务封面"}
                  className="aspect-[16/10] h-full w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.14),transparent_46%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] px-6 text-center">
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    {preview.videoUrl ? (
                      <PlayCircle className="h-9 w-9 text-sky-500" />
                    ) : (
                      <Clapperboard className="h-9 w-9 text-sky-500" />
                    )}
                    <span className="text-sm font-medium">
                      {preview.videoUrl
                        ? "已同步视频结果"
                        : resolveStatusLabel(preview)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-3 py-1">
              <div className="space-y-1.5">
                <div className="line-clamp-2 text-sm font-semibold leading-6 text-slate-900">
                  {preview.prompt || "视频任务"}
                </div>
                <p className="text-sm leading-6 text-slate-600">
                  {resolveDescription(preview)}
                </p>
              </div>

              {metaItems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {metaItems.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}

              {preview.providerId?.trim() ? (
                <div className="text-xs text-slate-500">
                  服务商: {preview.providerId.trim()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </button>

      {actionButtons.length > 0 ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2 px-1">
          {actionButtons.map((action) => (
            <button
              key={action.key}
              type="button"
              data-testid={`task-message-preview-action-${preview.taskId}-${action.key}`}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              onClick={(event) => {
                event.stopPropagation();
                emitVideoWorkbenchTaskAction({
                  action: action.key,
                  taskId: preview.taskId,
                  projectId: preview.projectId ?? null,
                  contentId: preview.contentId ?? null,
                });
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderGenericTaskPreview(
  preview: Exclude<MessageTaskPreview, { kind: "video_generate" }>,
  onOpen?: (preview: MessageTaskPreview) => void,
  metaItems: string[] = [],
) {
  const Icon = resolveGenericTaskIcon(preview);
  const media = renderGenericTaskMedia(preview, Icon);
  const titleText =
    preview.kind === "audio_generate" ||
    preview.kind === "transcription_generate"
      ? preview.prompt || preview.title?.trim() || resolveTaskLabel(preview)
      : preview.title?.trim() || preview.prompt || resolveTaskLabel(preview);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(preview)}
      data-testid={`task-message-preview-${preview.taskId}`}
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
                <Icon className="h-3.5 w-3.5" />
              )}
              {resolveStatusLabel(preview)}
            </span>
            <span className="truncate text-[11px] font-semibold text-slate-500">
              {resolveTaskLabel(preview)}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
            <span>打开查看</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </span>
        </div>

        <div className="flex gap-3 px-4 pb-4">
          {media}

          <div className="min-w-0 flex-1 space-y-2.5 py-1">
            <div className="space-y-1.5">
              <div className="line-clamp-2 text-sm font-semibold leading-6 text-slate-900">
                {titleText}
              </div>
              <p className="text-sm leading-6 text-slate-600">
                {resolveDescription(preview)}
              </p>
            </div>

            {renderTaskFailureDetails(preview)}
            {renderTranscriptionSegmentSummary(preview)}

            {metaItems.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {metaItems.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                  >
                    {item}
                  </span>
                ))}
              </div>
            ) : null}

            {preview.artifactPath?.trim() ? (
              <div className="truncate text-xs text-slate-500">
                任务文件: {preview.artifactPath.trim()}
              </div>
            ) : null}

            {(preview.kind === "audio_generate" ||
              preview.kind === "transcription_generate") &&
            preview.taskFilePath?.trim() ? (
              <div className="truncate text-xs text-slate-500">
                源任务: {preview.taskFilePath.trim()}
              </div>
            ) : null}

            {preview.kind === "transcription_generate" &&
            preview.transcriptPath?.trim() ? (
              <div className="truncate text-xs text-slate-500">
                转写结果: {preview.transcriptPath.trim()}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

export const TaskMessagePreview: React.FC<TaskMessagePreviewProps> = ({
  preview,
  onOpen,
}) => {
  const metaItems = buildMetaItems(preview);

  if (preview.kind === "video_generate") {
    return renderVideoTaskPreview(preview, onOpen, metaItems);
  }

  return renderGenericTaskPreview(preview, onOpen, metaItems);
};
