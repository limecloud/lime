import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ComposerController } from "@/components/input-kit/ComposerController";
import type { ComposerAttachment } from "@/components/input-kit/types";
import {
  BROWSER_ANNOTATION_IMAGE_BYTES,
  BROWSER_ANNOTATION_IMAGE_LIMIT,
  BROWSER_ANNOTATION_IMAGE_TYPES,
  readBrowserAnnotationImages,
  type BrowserAnnotationImage,
} from "@/lib/api/browserAnnotationImages";

export function annotationComposerImages(
  images: readonly BrowserAnnotationImage[],
): ComposerAttachment[] {
  return images.map((image) => {
    const [header, data] = image.dataUrl.split(",", 2);
    return {
      data,
      mediaType: header.slice(5, -7),
      metadata: { annotationImageId: image.id, filename: image.filename },
    };
  });
}

export function annotationDocumentImages(
  controller: ComposerController,
): BrowserAnnotationImage[] {
  return readBrowserAnnotationImages(
    controller.getDocument().attachments.map((image) => ({
      id: image.metadata?.annotationImageId,
      dataUrl: `data:${image.mediaType};base64,${image.data}`,
      ...(image.metadata?.filename
        ? { filename: image.metadata.filename }
        : {}),
    })),
  );
}

export function annotationTransferImages(
  transfer: DataTransfer | null,
): File[] {
  if (!transfer) return [];
  // Prefer files; items often contain the same File objects as a second view.
  const files = Array.from(transfer.files ?? []);
  const source = files.length
    ? files
    : Array.from(transfer.items ?? []).flatMap((item) => {
        const file = item.kind === "file" ? item.getAsFile() : null;
        return file ? [file] : [];
      });
  return source.filter((file) =>
    (BROWSER_ANNOTATION_IMAGE_TYPES as readonly string[]).includes(file.type),
  );
}

/** Reads belong to this editor lifetime; committed images belong to its Composer. */
export function useBrowserAnnotationImages(
  controller: ComposerController,
  canEdit: () => boolean,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(false);
  const epoch = useRef(0);
  const count = useRef(0);
  const readers = useRef(new Set<FileReader>());
  const tail = useRef(Promise.resolve());
  const cancel = useCallback(() => {
    epoch.current++;
    for (const reader of readers.current) reader.abort();
    readers.current.clear();
  }, []);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel();
    };
  }, [cancel]);

  const add = useCallback(
    (files: readonly File[]) => {
      if (!alive.current || !canEdit() || !files.length) return;
      const capturedEpoch = epoch.current;
      const current = () =>
        alive.current && epoch.current === capturedEpoch && canEdit();
      const read = (file: File) =>
        new Promise<BrowserAnnotationImage>((resolve, reject) => {
          if (
            !file.size ||
            file.size > BROWSER_ANNOTATION_IMAGE_BYTES ||
            !(BROWSER_ANNOTATION_IMAGE_TYPES as readonly string[]).includes(
              file.type,
            )
          ) {
            reject(new Error("Unsupported browser annotation image"));
            return;
          }
          const reader = new FileReader();
          readers.current.add(reader);
          const finish = () => readers.current.delete(reader);
          reader.onload = () => {
            finish();
            if (typeof reader.result !== "string") {
              reject(new Error("Image read failed"));
              return;
            }
            resolve({
              id: crypto.randomUUID(),
              dataUrl: reader.result,
              ...(file.name.trim()
                ? {
                    filename: file.name
                      .split("")
                      .filter((char) => char.charCodeAt(0) >= 32)
                      .join("")
                      .slice(0, 255),
                  }
                : {}),
            });
          };
          reader.onerror = reader.onabort = () => {
            finish();
            reject(new Error("Image read failed"));
          };
          reader.readAsDataURL(file);
        });
      count.current++;
      setLoading(true);
      setError(false);
      // Serial batches preserve paste/drop order while text edits remain synchronous.
      tail.current = tail.current
        .then(async () => {
          if (!current()) return;
          try {
            if (
              files.length + controller.getDocument().attachments.length >
              BROWSER_ANNOTATION_IMAGE_LIMIT
            )
              throw new Error("Browser annotation image count exceeded");
            const images = await Promise.all(files.map(read));
            if (!current()) return;
            const next = readBrowserAnnotationImages([
              ...annotationDocumentImages(controller),
              ...images,
            ]);
            controller.setAttachments(annotationComposerImages(next));
          } catch {
            if (current()) setError(true);
          }
        })
        .finally(() => {
          count.current--;
          if (alive.current && count.current === 0) setLoading(false);
        });
    },
    [canEdit, controller],
  );

  const remove = useCallback(
    (id: string) => {
      if (!alive.current || !canEdit()) return;
      const images = annotationDocumentImages(controller);
      controller.setAttachments(
        annotationComposerImages(images.filter((image) => image.id !== id)),
      );
      setError(false);
    },
    [canEdit, controller],
  );
  const isReading = useCallback(() => count.current > 0, []);
  return { add, remove, cancel, loading, error, isReading };
}
