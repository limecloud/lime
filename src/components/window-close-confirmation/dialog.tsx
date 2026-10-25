import { useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function WindowCloseConfirmationDialog({
  onClose,
  onConfirm,
}: {
  onClose(): void;
  onConfirm(doNotAskAgain: boolean): void;
}) {
  const { t } = useTranslation("settings");
  const [doNotAskAgain, setDoNotAskAgain] = useState(false);
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 select-none rounded-3xl border border-border bg-background p-5 text-foreground shadow-xl"
          onOpenAutoFocus={(event) => {
            previousFocus.current =
              document.activeElement as HTMLElement | null;
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected)
              previousFocus.current.focus();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onConfirm(doNotAskAgain);
            }}
          >
            <Dialog.Title className="text-lg font-semibold">
              {t("desktop.windowCloseConfirmation.title")}
            </Dialog.Title>
            <div className="mt-4 flex min-w-0 items-center gap-2">
              <Checkbox
                id={id}
                checked={doNotAskAgain}
                onCheckedChange={(checked) =>
                  setDoNotAskAgain(checked === true)
                }
              />
              <label htmlFor={id} className="cursor-pointer text-sm">
                {t("desktop.windowCloseConfirmation.doNotAskAgain")}
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                ref={cancel}
                type="button"
                variant="outline"
                className="h-8 rounded-full px-3 text-[13px]"
                onClick={onClose}
              >
                {t("desktop.windowCloseConfirmation.cancel")}
              </Button>
              <Button
                type="submit"
                className="h-8 rounded-full px-3 text-[13px]"
              >
                {t("desktop.windowCloseConfirmation.confirm")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
