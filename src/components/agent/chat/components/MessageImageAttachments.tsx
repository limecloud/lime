import React from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import type { Message } from "../types";
import { createAppServerClient } from "@/lib/api/appServer";
import { resolveLocalFilePreviewUrl } from "@/lib/api/fileSystem";
import { buildMessageImageDataUrl } from "../utils/imageAttachments";
import { ImageUnavailablePlaceholder } from "./ImageUnavailablePlaceholder";

const MESSAGE_IMAGE_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

interface MessageImageAttachmentsProps {
  images: Message["images"];
  threadId?: string | null;
  thumbnail?: boolean;
  onOpenImage?: (
    image: NonNullable<Message["images"]>[number],
    index: number,
  ) => void;
}

function isSidecarUri(uri?: string | null): boolean {
  return Boolean(uri?.trim().toLowerCase().startsWith("sidecar://"));
}

function isDirectPreviewUri(uri: string): boolean {
  return (
    /^(?:https?|file|asset|blob|data):/iu.test(uri) || uri.startsWith("//")
  );
}

function resolveMessageImageSrc(image: NonNullable<Message["images"]>[number]) {
  const data = image.data.trim();
  if (data) {
    return data.toLowerCase().startsWith("data:")
      ? data
      : buildMessageImageDataUrl(image);
  }

  const previewUrl = image.previewUrl?.trim();
  if (previewUrl && isDirectPreviewUri(previewUrl)) {
    return previewUrl;
  }
  if (image.sourcePath?.trim()) {
    return resolveLocalFilePreviewUrl(image.sourcePath) || image.sourcePath;
  }
  const sourceUri = image.sourceUri?.trim();
  if (sourceUri && isDirectPreviewUri(sourceUri)) {
    return sourceUri;
  }
  return "";
}

function resolveMessageImageSidecarUri(
  image: NonNullable<Message["images"]>[number],
): string {
  return (
    [image.previewUrl, image.sourceUri]
      .map((value) => value?.trim() || "")
      .find(isSidecarUri) || ""
  );
}

function MessageImageAttachment({
  image,
  index,
  onOpenImage,
  threadId,
  thumbnail = false,
}: {
  image: NonNullable<Message["images"]>[number];
  index: number;
  threadId?: string | null;
  thumbnail?: boolean;
  onOpenImage?: MessageImageAttachmentsProps["onOpenImage"];
}) {
  const { t } = useTranslation(["agent", "common"]);
  const directSrc = resolveMessageImageSrc(image);
  const sidecarUri = resolveMessageImageSidecarUri(image);
  const normalizedThreadId = threadId?.trim() || "";
  const [sidecarSrc, setSidecarSrc] = React.useState("");
  const [loadFailed, setLoadFailed] = React.useState(false);

  React.useEffect(() => {
    setSidecarSrc("");
    setLoadFailed(false);
    if (directSrc || !sidecarUri || !normalizedThreadId) {
      return;
    }

    const abortController = new AbortController();
    void createAppServerClient()
      .readMedia(
        {
          threadId: normalizedThreadId,
          uri: sidecarUri,
          maxBytes: MESSAGE_IMAGE_PREVIEW_MAX_BYTES,
          length: MESSAGE_IMAGE_PREVIEW_MAX_BYTES,
        },
        { signal: abortController.signal },
      )
      .then(({ result }) => {
        const mimeType = result.mimeType?.trim() || image.mediaType.trim();
        if (
          abortController.signal.aborted ||
          !mimeType.toLowerCase().startsWith("image/") ||
          !result.contentBase64 ||
          result.offset !== 0 ||
          result.hasMore ||
          result.bytes !== result.totalBytes
        ) {
          if (!abortController.signal.aborted) {
            setLoadFailed(true);
          }
          return;
        }
        setSidecarSrc(`data:${mimeType};base64,${result.contentBase64}`);
      })
      .catch(() => {
        if (!abortController.signal.aborted) {
          setLoadFailed(true);
        }
      });

    return () => abortController.abort();
  }, [directSrc, image.mediaType, normalizedThreadId, sidecarUri]);

  const src = directSrc || sidecarSrc;
  const isUnavailable =
    loadFailed || (!src && (!sidecarUri || !normalizedThreadId));
  const imageNode = isUnavailable ? (
    thumbnail ? (
      <span
        role="img"
        aria-label={t("agentChat.messageImageAttachments.unavailable")}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-border bg-muted/40"
        data-testid={`message-image-attachment-unavailable-${index}`}
      >
        <span aria-hidden className="text-xs text-muted-foreground">
          —
        </span>
      </span>
    ) : (
      <ImageUnavailablePlaceholder
        label={t("agentChat.messageImageAttachments.unavailable")}
        testId={`message-image-attachment-unavailable-${index}`}
        className="h-28 w-40 max-w-xs"
      />
    )
  ) : !src ? (
    <span
      role="status"
      aria-label={t("common:common.loading")}
      className={`inline-flex shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground ${thumbnail ? "size-6" : "h-28 w-40 max-w-xs"}`}
      data-testid={`message-image-attachment-loading-${index}`}
    >
      <LoaderCircle
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    </span>
  ) : (
    <img
      src={src}
      className={
        thumbnail
          ? "size-6 shrink-0 rounded border border-border object-cover"
          : "max-h-64 max-w-xs rounded-lg border border-border object-contain"
      }
      draggable={!thumbnail}
      alt={t("agentChat.messageImageAttachments.alt")}
      data-testid={`message-image-attachment-${index}`}
      onError={() => setLoadFailed(true)}
    />
  );

  if (!onOpenImage) {
    return imageNode;
  }

  return (
    <button
      type="button"
      className="rounded-lg text-left transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      data-testid={`message-image-attachment-open-${index}`}
      onClick={() => onOpenImage(image, index)}
    >
      {imageNode}
    </button>
  );
}

export function MessageImageAttachments({
  images,
  onOpenImage,
  threadId,
  thumbnail,
}: MessageImageAttachmentsProps) {
  if (!images?.length) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, index) => {
        return (
          <MessageImageAttachment
            key={index}
            image={img}
            index={index}
            onOpenImage={onOpenImage}
            threadId={threadId}
            thumbnail={thumbnail}
          />
        );
      })}
    </div>
  );
}
