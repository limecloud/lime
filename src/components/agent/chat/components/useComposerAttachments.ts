import { useCallback, useEffect, useMemo, useRef, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ComposerController } from "@/components/input-kit";
import { useComposerController } from "@/components/input-kit/useComposerController";
import { pickFilesFromDialog, type PickedFile } from "@/lib/api/filePicker";
import { readFileBytes } from "@/lib/api/fileBrowser";
import {
  consumePendingAppSnapshot,
  restorePendingAppSnapshot,
} from "@/lib/pendingAppSnapshot";
import type { MessageImage, MessagePathReference } from "../types";
import {
  createImageAttachmentFile,
  getClipboardImageCandidates,
  MAX_IMAGE_ATTACHMENTS_PER_TURN,
  normalizeImageMimeType,
  readImageAttachment,
} from "../utils/imageAttachments";
import {
  createPathReference,
  mergePathReferences,
  readCustomPathReferencesFromDataTransfer,
  readSystemPathReferencesFromFiles,
} from "../utils/pathReferences";
import { buildComposerAttachmentsCopy } from "./composerAttachmentsCopy";
import { useAttachmentGeneration } from "./useAttachmentGeneration";

function pendingSnapshotFileName(windowName: string): string {
  const base = windowName
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${(base || "app-snapshot").slice(0, 80)}.png`;
}

export function useComposerAttachments({
  controller,
  onAddPathReferences,
}: {
  controller?: ComposerController;
  onAddPathReferences?: (references: MessagePathReference[]) => void;
} = {}) {
  const { t } = useTranslation("agent");
  const copy = useMemo(
    () => buildComposerAttachmentsCopy((key, values) => t(key, values ?? {})),
    [t],
  );
  const { controller: owner, snapshot } = useComposerController({ controller });
  const {
    captureGeneration,
    isCurrentGeneration,
    invalidateGeneration,
    runAttachmentWrite,
  } = useAttachmentGeneration(owner);
  const pendingSnapshotAttempted = useRef(false);
  const setPendingImages = useCallback(
    (images: MessageImage[]) => {
      runAttachmentWrite(images, () => owner.setAttachments(images));
    },
    [owner, runAttachmentWrite],
  );
  const replacePendingImages = useCallback(
    (images: MessageImage[]) => {
      invalidateGeneration();
      setPendingImages(images);
    },
    [invalidateGeneration, setPendingImages],
  );
  const clearPendingImages = useCallback(
    () => replacePendingImages([]),
    [replacePendingImages],
  );
  const addPathReferences = useCallback(
    (references: MessagePathReference[]) => {
      if (!references.length) return;
      owner.setPathReferences(
        mergePathReferences(
          [...owner.getDocument().pathReferences],
          references,
        ),
      );
      onAddPathReferences?.(references);
    },
    [owner, onAddPathReferences],
  );
  const appendImage = useCallback(
    (
      image: MessageImage,
      generation: number,
      label: string,
      success?: string,
    ): boolean => {
      if (!isCurrentGeneration(generation)) return false;
      const images = owner.getDocument().attachments;
      if (images.length >= MAX_IMAGE_ATTACHMENTS_PER_TURN) {
        toast.error(copy.imageReadFailed(label));
        return false;
      }
      setPendingImages([...images, image]);
      if (success && isCurrentGeneration(generation)) toast.success(success);
      return true;
    },
    [owner, copy, isCurrentGeneration, setPendingImages],
  );
  const addImages = useCallback(
    async (
      files: { file: File; mediaType?: string }[],
      success?: string,
    ): Promise<number> => {
      const generation = captureGeneration();
      let appended = 0;
      await Promise.all(
        files.map(async ({ file, mediaType }, index) => {
          const label = file.name || copy.unnamedImage;
          try {
            const image = await readImageAttachment(file, mediaType);
            if (
              appendImage(
                image,
                generation,
                label,
                index === 0 && success ? success : copy.imageAdded(label),
              )
            ) {
              appended += 1;
            }
          } catch {
            if (isCurrentGeneration(generation))
              toast.error(copy.imageReadFailed(label));
          }
        }),
      );
      return appended;
    },
    [appendImage, captureGeneration, copy, isCurrentGeneration],
  );
  useEffect(() => {
    if (pendingSnapshotAttempted.current) return;
    pendingSnapshotAttempted.current = true;
    const pendingSnapshot = consumePendingAppSnapshot();
    if (!pendingSnapshot) return;
    const fileName = pendingSnapshotFileName(pendingSnapshot.windowName);
    const label = pendingSnapshot.windowName ? fileName : copy.unnamedImage;
    void (async () => {
      let appended = 0;
      try {
        const file = createImageAttachmentFile(
          pendingSnapshot.dataUrl,
          fileName,
        );
        appended = await addImages([{ file }]);
      } catch {
        toast.error(copy.imageReadFailed(label));
      }
      if (appended === 0) restorePendingAppSnapshot(pendingSnapshot);
    })();
  }, [addImages, copy]);
  const addPickedFiles = useCallback(
    async (files: readonly PickedFile[]) => {
      const generation = captureGeneration();
      // Read concurrently, commit in picker order. Directory paths are never read as images.
      const results = await Promise.all(
        files.map(async (file) => {
          const isDirectory = /[\\/]$/.test(file.path);
          const mediaType = isDirectory
            ? null
            : normalizeImageMimeType(null, file.fsPath);
          if (!mediaType) return { file, isDirectory };
          try {
            const bytes = await readFileBytes(file.fsPath);
            if (!isCurrentGeneration(generation)) return null;
            const image = await readImageAttachment(
              new File([new Uint8Array(bytes).buffer], file.label, {
                type: mediaType,
              }),
            );
            return { file, image };
          } catch {
            if (isCurrentGeneration(generation))
              toast.error(copy.imageReadFailed(file.label));
            return null;
          }
        }),
      );
      if (!isCurrentGeneration(generation)) return;
      for (const result of results) {
        if (!result || !isCurrentGeneration(generation)) continue;
        if ("image" in result && result.image)
          appendImage(result.image, generation, result.file.label);
        else {
          const reference = createPathReference({
            path: result.file.fsPath,
            name: result.file.label,
            isDir: result.isDirectory,
          });
          if (reference) addPathReferences([reference]);
        }
      }
    },
    [
      addPathReferences,
      appendImage,
      captureGeneration,
      copy,
      isCurrentGeneration,
    ],
  );
  const openFileDialog = useCallback(async () => {
    const generation = captureGeneration();
    try {
      const files = await pickFilesFromDialog();
      if (!isCurrentGeneration(generation) || !files.length) return false;
      await addPickedFiles(files);
      return isCurrentGeneration(generation);
    } catch {
      if (isCurrentGeneration(generation))
        toast.error(String(t("agentChat.inputbar.attachments.failed")));
      return false;
    }
  }, [addPickedFiles, captureGeneration, isCurrentGeneration, t]);
  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const images = getClipboardImageCandidates(event.clipboardData);
      if (!images.length) return;
      event.preventDefault();
      void addImages(images, copy.imagePasted);
    },
    [addImages, copy.imagePasted],
  );
  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((file) =>
        normalizeImageMimeType(file.type, file.name),
      );
      const paths = readSystemPathReferencesFromFiles(
        Array.from(files).filter((file) => !images.includes(file)),
      );
      addPathReferences(paths);
      if (images.length + paths.length < files.length)
        toast.error(
          String(
            t("agentChat.inputbar.controller.toast.systemPathDropUnsupported"),
          ),
        );
      await addImages(images.map((file) => ({ file })));
    },
    [addImages, addPathReferences, t],
  );
  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const references = readCustomPathReferencesFromDataTransfer(
        event.dataTransfer,
      );
      if (references.length) addPathReferences(references);
      else void addFiles(event.dataTransfer.files);
    },
    [addFiles, addPathReferences],
  );
  const handleRemoveImage = useCallback(
    (index: number) => {
      setPendingImages(
        owner
          .getDocument()
          .attachments.filter((_, current) => current !== index),
      );
    },
    [owner, setPendingImages],
  );
  return {
    pendingImages: [...snapshot.document.attachments],
    addPickedFiles,
    addFiles,
    openFileDialog,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    clearPendingImages,
    replacePendingImages,
  };
}
