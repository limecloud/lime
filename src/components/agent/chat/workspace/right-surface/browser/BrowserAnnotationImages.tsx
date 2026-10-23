import { useLayoutEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { BrowserAnnotationImage } from "@/lib/api/browserAnnotationImages";
import type { BrowserAnnotationEditorLabels } from "@/lib/api/browserAnnotationEditorTypes";

export function BrowserAnnotationImages({
  images,
  labels,
  disabled,
  onRemove,
  onPreviewOpenChange,
  onPreviewClose,
}: {
  images: readonly BrowserAnnotationImage[];
  labels: BrowserAnnotationEditorLabels;
  disabled: boolean;
  onRemove: (id: string) => void;
  onPreviewOpenChange: (open: boolean) => void;
  onPreviewClose: () => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = images.find((image) => image.id === previewId);
  useLayoutEffect(() => {
    onPreviewOpenChange(!!preview);
    return () => onPreviewOpenChange(false);
  }, [preview, onPreviewOpenChange]);
  return (
    <>
      <ul
        aria-label={labels.imageAttachment}
        className="flex shrink-0 gap-2 overflow-x-auto py-1"
      >
        {images.map((image) => (
          <li key={image.id} className="relative shrink-0">
            <button
              type="button"
              disabled={disabled}
              aria-label={`${labels.previewImage}: ${image.filename ?? labels.imageAttachment}`}
              className="block rounded-lg border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50"
              onClick={() => setPreviewId(image.id)}
            >
              <img
                src={image.dataUrl}
                alt={image.filename ?? labels.imageAttachment}
                className="h-14 w-16 rounded-lg object-cover"
                draggable={false}
              />
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={`${labels.removeImage}: ${image.filename ?? labels.imageAttachment}`}
              className="absolute -right-1 -top-1 rounded-full border border-border bg-popover p-0.5 text-popover-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50"
              onClick={() => onRemove(image.id)}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <Dialog.Root
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-background/95" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed inset-2 z-50 flex flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground outline-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              onPreviewClose();
            }}
          >
            <Dialog.Title className="min-w-0 truncate pr-6 text-xs font-medium">
              {preview?.filename ?? labels.imageAttachment}
            </Dialog.Title>
            <Dialog.Close
              aria-label={labels.closePreview}
              className="absolute right-2 top-2 rounded p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
            {preview ? (
              <img
                src={preview.dataUrl}
                alt={preview.filename ?? labels.imageAttachment}
                className="min-h-0 flex-1 object-contain"
                draggable={false}
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
