import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { toast } from "sonner";
import type { MessageImage } from "../../../types";
import {
  getClipboardImageCandidates,
  readImageAttachment,
} from "../../../utils/imageAttachments";

export function useImageAttachments() {
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const appendImageFile = useCallback(
    async (
      file: File,
      successMessage?: string,
      preferredMediaType?: string,
    ) => {
      try {
        const image = await readImageAttachment(file, preferredMediaType);
        setPendingImages((prev) => [...prev, image]);
        toast.success(
          successMessage ?? `已添加图片: ${file.name || "未命名图片"}`,
        );
      } catch {
        toast.error(`图片读取失败: ${file.name || "未命名图片"}`);
      }
    },
    [],
  );

  const appendImageFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((file) => {
        void appendImageFile(file);
      });
    },
    [appendImageFile],
  );

  const handleFileSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files || files.length === 0) {
        return;
      }

      appendImageFiles(files);
      event.target.value = "";
    },
    [appendImageFiles],
  );

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const imageFiles = getClipboardImageCandidates(event.clipboardData);
      if (imageFiles.length === 0) {
        return;
      }

      event.preventDefault();
      imageFiles.forEach(({ file, mediaType }, index) => {
        void appendImageFile(
          file,
          index === 0 ? "已粘贴图片" : undefined,
          mediaType,
        );
      });
    },
    [appendImageFile],
  );

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const files = event.dataTransfer.files;
      if (!files || files.length === 0) {
        return;
      }

      appendImageFiles(files);
    },
    [appendImageFiles],
  );

  const handleRemoveImage = useCallback((index: number) => {
    setPendingImages((prev) =>
      prev.filter((_, currentIndex) => currentIndex !== index),
    );
  }, []);

  const clearPendingImages = useCallback(() => {
    setPendingImages([]);
  }, []);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    pendingImages,
    fileInputRef,
    handleFileSelect,
    handlePaste,
    handleDragOver,
    handleDrop,
    handleRemoveImage,
    clearPendingImages,
    openFileDialog,
  };
}
