import { LoaderCircle } from "lucide-react";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import type {
  MessageImageWorkbenchPreview,
  MessageImageWorkbenchPreviewSelection,
} from "../types";
import { RenderableTaskImage } from "./RenderableTaskImage";

function resolveImageWorkbenchPreviewImages(
  preview: MessageImageWorkbenchPreview,
): string[] {
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

type AgentTranslate = TFunction<"agent", undefined>;

interface ImageWorkbenchPreviewMediaProps {
  preview: MessageImageWorkbenchPreview;
  onSelect?: (selection?: MessageImageWorkbenchPreviewSelection) => void;
  t: AgentTranslate;
}

function resolvePlaceholderLabel(
  preview: MessageImageWorkbenchPreview,
  t: AgentTranslate,
): string {
  switch (preview.status) {
    case "cancelled":
      return t("agentChat.imageWorkbenchPreview.placeholder.cancelled");
    case "failed":
      return t("agentChat.imageWorkbenchPreview.placeholder.failed");
    case "complete":
    case "partial":
      return t("agentChat.imageWorkbenchPreview.placeholder.imageUnavailable");
    case "running":
    default:
      switch (preview.mode) {
        case "edit":
          return t("agentChat.imageWorkbenchPreview.placeholder.editing");
        case "variation":
          return t("agentChat.imageWorkbenchPreview.placeholder.redrawing");
        case "generate":
        default:
          return t("agentChat.imageWorkbenchPreview.placeholder.generating");
      }
  }
}

function renderPlaceholder(
  preview: MessageImageWorkbenchPreview,
  reason: string,
  t: AgentTranslate,
) {
  return (
    <div className="flex h-full min-h-0 w-full items-center justify-center rounded-[12px] bg-slate-50 px-5 text-center">
      <div className="space-y-1.5">
        {reason === "empty" && preview.status === "running" ? (
          <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-slate-500" />
        ) : null}
        <div className="text-sm font-medium text-slate-700">
          {resolvePlaceholderLabel(preview, t)}
        </div>
      </div>
    </div>
  );
}

function resolvePreviewGridAspectClass(
  preview: MessageImageWorkbenchPreview,
  imageCount: number,
): string {
  if (preview.layoutHint === "storyboard_3x3" && imageCount >= 4) {
    return "aspect-square";
  }
  return "aspect-[16/10]";
}

export function ImageWorkbenchPreviewMedia({
  preview,
  onSelect,
  t,
}: ImageWorkbenchPreviewMediaProps) {
  const previewImages = resolveImageWorkbenchPreviewImages(preview);
  const expectedImageCount = Math.max(
    preview.expectedImageCount ?? 0,
    preview.imageCount ?? 0,
    previewImages.length,
  );
  const isStoryboardGrid = preview.layoutHint === "storyboard_3x3";
  const totalSlotCount = isStoryboardGrid
    ? Math.max(expectedImageCount, 9)
    : previewImages.length;
  const aspectClass = resolvePreviewGridAspectClass(preview, totalSlotCount);

  if (!isStoryboardGrid && previewImages.length <= 1) {
    const content = (
      <RenderableTaskImage
        src={previewImages[0] || preview.imageUrl}
        alt={preview.prompt || t("agentChat.imageWorkbenchPreview.media.alt")}
        className="h-full w-full object-cover"
        renderFallback={(reason) => renderPlaceholder(preview, reason, t)}
      />
    );

    return onSelect ? (
      <button
        type="button"
        aria-label={t("agentChat.imageWorkbenchPreview.media.open")}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({
            imageUrl: previewImages[0] || preview.imageUrl || null,
            imageIndex: 0,
          });
        }}
        data-testid={`image-workbench-message-preview-single-media-${preview.taskId}`}
        className="block aspect-[16/9] w-[358px] max-w-full overflow-hidden rounded-[12px] border-0 bg-slate-50 p-0 text-left"
      >
        {content}
      </button>
    ) : (
      <div
        data-testid={`image-workbench-message-preview-single-media-${preview.taskId}`}
        className="block aspect-[16/9] w-[358px] max-w-full overflow-hidden rounded-[12px] border-0 bg-slate-50 p-0 text-left"
      >
        {content}
      </div>
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
      className={cn("grid gap-1.5", aspectClass, columnsClass)}
    >
      {Array.from({ length: visibleCount }, (_, index) => {
        const url = previewImages[index];
        const isLastWithOverflow = extraCount > 0 && index === visibleCount - 1;
        const content = (
          <>
            {url ? (
              <RenderableTaskImage
                src={url}
                alt={`${preview.prompt || t("agentChat.imageWorkbenchPreview.media.alt")} ${
                  index + 1
                }`}
                className="h-full w-full object-cover"
                renderFallback={() => (
                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[11px] font-medium text-slate-400">
                    {t("agentChat.imageWorkbenchPreview.media.previewFailed")}
                  </div>
                )}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-slate-50">
                {preview.status === "running" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" />
                ) : null}
              </div>
            )}
            {isLastWithOverflow ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/48 text-sm font-semibold text-white">
                +{extraCount}
              </div>
            ) : null}
          </>
        );
        const tileClassName = cn(
          "relative block overflow-hidden rounded-[14px] border-0 bg-slate-50 p-0 text-left",
          isStoryboardGrid ? "aspect-square" : "aspect-[4/3]",
        );

        return onSelect ? (
          <button
            type="button"
            key={`${url || "placeholder"}-${index}`}
            aria-label={`${t("agentChat.imageWorkbenchPreview.media.open")} ${
              index + 1
            }`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({
                imageUrl: url || null,
                imageIndex: index,
              });
            }}
            data-testid={`image-workbench-message-preview-media-${preview.taskId}-${index + 1}`}
            className={tileClassName}
          >
            {content}
          </button>
        ) : (
          <div
            key={`${url || "placeholder"}-${index}`}
            data-testid={`image-workbench-message-preview-media-${preview.taskId}-${index + 1}`}
            className={tileClassName}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
