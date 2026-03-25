import { useEffect } from "react";
import type { Artifact } from "@/lib/artifact/types";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type {
  ArtifactWriteMetadata,
  WriteArtifactContext,
} from "../types";
import {
  buildArtifactFromWrite,
  resolveArtifactWritePhase,
} from "../utils/messageArtifacts";

export interface ArtifactAutoPreviewResult {
  path?: string;
  content?: string | null;
  isBinary?: boolean;
  error?: string | null;
}

interface UseArtifactAutoPreviewSyncOptions {
  enabled: boolean;
  artifact: Artifact | null;
  loadPreview: (path: string) => Promise<ArtifactAutoPreviewResult>;
  onSyncArtifact: (artifact: Artifact) => void;
}

const STREAM_SYNC_POLL_INTERVAL_MS = 280;
const EMPTY_COMPLETE_SYNC_TIMEOUT_MS = 8000;
const PREVIEW_TEXT_MAX_CHARS = 480;
const LATEST_CHUNK_MAX_CHARS = 240;

function normalizePreviewText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}

export function shouldAutoSyncArtifactPreview(artifact: Artifact | null): boolean {
  if (!artifact) {
    return false;
  }

  if (artifact.type === "browser_assist") {
    return false;
  }

  const artifactPath = resolveArtifactProtocolFilePath(artifact);
  if (!artifactPath.trim()) {
    return false;
  }

  const writePhase = resolveArtifactWritePhase(artifact);
  if (!artifact.content.trim()) {
    return (
      artifact.status === "pending" ||
      artifact.status === "streaming" ||
      artifact.status === "complete" ||
      writePhase === "preparing" ||
      writePhase === "streaming" ||
      writePhase === "persisted" ||
      writePhase === "completed"
    );
  }

  return artifact.status === "streaming" || writePhase === "streaming";
}

export function mergePreviewContentIntoArtifact(
  artifact: Artifact,
  preview: ArtifactAutoPreviewResult,
): Artifact | null {
  if (preview.isBinary || preview.error) {
    return null;
  }

  const nextContent =
    typeof preview.content === "string" ? preview.content : artifact.content;
  const nextPath = preview.path?.trim() || resolveArtifactProtocolFilePath(artifact);
  const currentContent = artifact.content;

  if (!nextContent.trim() && currentContent.trim()) {
    return null;
  }

  if (
    currentContent.trim() &&
    nextContent.length < currentContent.length &&
    currentContent.startsWith(nextContent)
  ) {
    return null;
  }

  if (
    nextContent === currentContent &&
    nextPath === resolveArtifactProtocolFilePath(artifact)
  ) {
    return null;
  }

  const currentWritePhase = resolveArtifactWritePhase(artifact);
  const nextStatus =
    artifact.status === "complete" || currentWritePhase === "completed"
      ? "complete"
      : artifact.status === "error" || currentWritePhase === "failed"
        ? "error"
        : nextContent.trim()
          ? "streaming"
          : artifact.status;
  const nextWritePhase: WriteArtifactContext["metadata"] = {
    ...(artifact.meta as ArtifactWriteMetadata),
    writePhase:
      nextStatus === "complete"
        ? "completed"
        : nextStatus === "error"
          ? "failed"
          : nextContent.trim()
            ? "streaming"
            : currentWritePhase || undefined,
    previewText: nextContent.trim()
      ? normalizePreviewText(nextContent, PREVIEW_TEXT_MAX_CHARS)
      : (artifact.meta.previewText as string | undefined),
    latestChunk: nextContent.trim()
      ? normalizePreviewText(
          nextContent.slice(-LATEST_CHUNK_MAX_CHARS),
          LATEST_CHUNK_MAX_CHARS,
        )
      : (artifact.meta.latestChunk as string | undefined),
    isPartial: nextStatus !== "complete" && nextStatus !== "error",
    lastUpdateSource:
      (artifact.meta.lastUpdateSource as WriteArtifactContext["source"]) ||
      "artifact_snapshot",
  };

  return buildArtifactFromWrite({
    filePath: nextPath,
    content: nextContent,
    context: {
      artifact,
      artifactId: artifact.id,
      source:
        (artifact.meta.lastUpdateSource as WriteArtifactContext["source"]) ||
        "artifact_snapshot",
      sourceMessageId:
        typeof artifact.meta.sourceMessageId === "string"
          ? artifact.meta.sourceMessageId
          : undefined,
      status: nextStatus,
      metadata: nextWritePhase,
    },
  });
}

export function useArtifactAutoPreviewSync({
  enabled,
  artifact,
  loadPreview,
  onSyncArtifact,
}: UseArtifactAutoPreviewSyncOptions): void {
  useEffect(() => {
    if (!enabled || !artifact || !shouldAutoSyncArtifactPreview(artifact)) {
      return;
    }

    const artifactPath = resolveArtifactProtocolFilePath(artifact);
    if (!artifactPath.trim()) {
      return;
    }

    let disposed = false;
    let timer: number | null = null;
    let inFlight = false;
    const startedAt = Date.now();

    const scheduleNext = () => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(runSync, STREAM_SYNC_POLL_INTERVAL_MS);
    };

    const runSync = async () => {
      if (disposed || inFlight) {
        return;
      }

      const currentWritePhase = resolveArtifactWritePhase(artifact);
      const shouldStopOnTimeout =
        !artifact.content.trim() &&
        (artifact.status === "complete" || currentWritePhase === "completed") &&
        Date.now() - startedAt >= EMPTY_COMPLETE_SYNC_TIMEOUT_MS;
      if (shouldStopOnTimeout) {
        return;
      }

      inFlight = true;
      try {
        const preview = await loadPreview(artifactPath);
        if (disposed) {
          return;
        }

        const nextArtifact = mergePreviewContentIntoArtifact(artifact, preview);
        if (nextArtifact) {
          onSyncArtifact(nextArtifact);
        }
      } catch {
        // 预览同步只做兜底，不影响主流程。
      } finally {
        inFlight = false;
        scheduleNext();
      }
    };

    void runSync();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [artifact, enabled, loadPreview, onSyncArtifact]);
}
