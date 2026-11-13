import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { SettingsAction } from "../../SettingsPrimitives";

export function DeleteArchivedChatsDialog({
  pending,
  failed,
  onConfirm,
  onClose,
  onRestoreFocus,
}: {
  pending: boolean;
  failed: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[71] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-5 text-[13px] text-popover-foreground shadow-lg"
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          onInteractOutside={(event) => pending && event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onRestoreFocus();
          }}
          aria-busy={pending}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) onConfirm();
            }}
          >
            <Dialog.Title className="text-base font-medium">
              {t("settings.archivedConversations.deleteConfirm.title")}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
              {t("settings.archivedConversations.deleteConfirm.body")}
            </Dialog.Description>
            {failed ? (
              <p role="alert" className="mt-3 text-destructive">
                {t("settings.archivedConversations.toast.deleteFailed")}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <SettingsAction
                type="button"
                disabled={pending}
                onClick={onClose}
              >
                {t("settings.archivedConversations.deleteConfirm.cancel")}
              </SettingsAction>
              <SettingsAction
                type="submit"
                disabled={pending}
                $tone="danger"
                data-testid="settings-archived-confirm-delete"
              >
                {t(
                  pending
                    ? "settings.archivedConversations.action.deleting"
                    : "settings.archivedConversations.action.delete",
                )}
              </SettingsAction>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
