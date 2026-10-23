import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";

export function ResetShortcutsDialog({
  open,
  onOpenChange,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.keyboardShortcuts.resetTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
            {t("settings.keyboardShortcuts.resetDescription")}
          </Dialog.Description>
          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <SettingsAction type="button" disabled={pending}>
                {t("settings.keyboardShortcuts.cancel")}
              </SettingsAction>
            </Dialog.Close>
            <SettingsAction
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={onConfirm}
            >
              {t("settings.keyboardShortcuts.resetConfirm")}
            </SettingsAction>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
