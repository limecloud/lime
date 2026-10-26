import React from "react";
import { FileAudio, FileImage, FileVideo, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MessageMediaReference } from "../types";

function isInlineImageUri(uri: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/iu.test(uri.trim());
}

function isInternalMediaReferenceUri(uri: string): boolean {
  return uri.trim().toLowerCase().startsWith("sidecar://");
}

function normalizeKind(kind?: string | null): string {
  const normalized = kind?.trim().toLowerCase();
  if (!normalized) {
    return "file";
  }
  if (normalized.includes("image")) {
    return "image";
  }
  if (normalized.includes("audio")) {
    return "audio";
  }
  if (normalized.includes("video")) {
    return "video";
  }
  return normalized;
}

function formatByteSize(value?: number): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function MediaIcon({ kind }: { kind: string }) {
  const className = "h-4 w-4";
  if (kind === "image") {
    return <FileImage className={className} aria-hidden="true" />;
  }
  if (kind === "audio") {
    return <FileAudio className={className} aria-hidden="true" />;
  }
  if (kind === "video") {
    return <FileVideo className={className} aria-hidden="true" />;
  }
  return <Paperclip className={className} aria-hidden="true" />;
}

export function StreamingMediaReferenceCard({
  reference,
  isStreaming = false,
  onOpen,
}: {
  reference: MessageMediaReference;
  isStreaming?: boolean;
  onOpen?: (reference: MessageMediaReference) => void;
}) {
  const { t } = useTranslation("agent");
  const kind = normalizeKind(reference.kind);
  const kindFallback = t(
    "agentChat.streamingRenderer.mediaReference.kind.file",
    {
      defaultValue: "Media",
    },
  );
  const kindLabel = t(
    `agentChat.streamingRenderer.mediaReference.kind.${kind}`,
    {
      defaultValue: kindFallback,
    },
  );
  const title =
    [reference.caption, reference.title]
      .map((value) => value?.trim())
      .find((value) => value && !isInternalMediaReferenceUri(value)) ||
    kindLabel;
  const byteSize = formatByteSize(reference.byteSize);
  const inlineImageUri =
    kind === "image" && isInlineImageUri(reference.uri)
      ? reference.uri.trim()
      : null;
  const displayUri = isInternalMediaReferenceUri(reference.uri)
    ? null
    : reference.uri.trim();
  if (inlineImageUri) {
    const image = (
      <img
        src={inlineImageUri}
        alt={title}
        loading="lazy"
        className="max-h-[512px] max-w-full rounded-lg border-[0.5px] border-border object-contain"
        data-testid="streaming-media-reference-image"
      />
    );
    const content = (
      <>
        {image}
        {reference.caption?.trim() ? (
          <span className="text-xs text-muted-foreground">
            {reference.caption.trim()}
          </span>
        ) : null}
      </>
    );

    if (onOpen && reference.sourcePath?.trim()) {
      return (
        <button
          type="button"
          className="inline-flex max-w-full flex-col gap-1.5 text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          data-testid="streaming-media-reference-card"
          data-reference-uri-kind="inline-image"
          aria-label={t("agentChat.streamingRenderer.mediaReference.open", {
            title,
            defaultValue: "Open media reference: {{title}}",
          })}
          onClick={() => onOpen(reference)}
        >
          {content}
        </button>
      );
    }

    return (
      <span
        className="inline-flex max-w-full flex-col gap-1.5"
        data-testid="streaming-media-reference-card"
        data-reference-uri-kind="inline-image"
      >
        {content}
      </span>
    );
  }

  const className = cn(
    "max-w-[520px] rounded-lg border-[0.5px] border-border bg-background px-3 py-2 text-left text-sm",
    isStreaming && "bg-muted",
    onOpen &&
      "cursor-pointer hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
  );
  const body = (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 p-1 text-muted-foreground">
        <MediaIcon kind={kind} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{title}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{kindLabel}</span>
          {reference.mimeType ? <span>{reference.mimeType}</span> : null}
          {byteSize ? <span>{byteSize}</span> : null}
        </div>
        {displayUri ? (
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {displayUri}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className={className}
        data-testid="streaming-media-reference-card"
        data-reference-uri={reference.uri}
        aria-label={t("agentChat.streamingRenderer.mediaReference.open", {
          title,
          defaultValue: "Open media reference: {{title}}",
        })}
        onClick={() => onOpen(reference)}
      >
        {body}
      </button>
    );
  }

  return (
    <div
      className={className}
      data-testid="streaming-media-reference-card"
      data-reference-uri={reference.uri}
    >
      {body}
    </div>
  );
}
