import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  deleteManagedWorktree,
  type ManagedWorktree,
} from "@/lib/api/worktrees";
import { SettingsAction } from "../../SettingsPrimitives";
import { useSettingsDraft } from "../../_layout/useSettingsDraft";

export function DeleteWorktreeDialog({
  entry,
  onClose,
  onDeleted,
}: {
  entry: ManagedWorktree;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation("settings");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  useSettingsDraft({ dirty: false, saving: pending });
  async function remove() {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await deleteManagedWorktree(entry.worktreePath);
      toast.success(t("settings.worktrees.deleted"));
      onDeleted();
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving.current) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/30" />
        <Dialog.Content
          role="alertdialog"
          className="fixed left-1/2 top-1/2 z-[70] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none"
          onEscapeKeyDown={(event) => {
            if (saving.current) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (saving.current) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.worktrees.deleteTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[13px] text-muted-foreground">
            {t("settings.worktrees.deleteDescription")}
          </Dialog.Description>
          <p className="mt-3 break-all text-[12px] text-muted-foreground">
            {entry.worktreePath}
          </p>
          {failed ? (
            <p
              role="alert"
              className="mt-3 text-[13px] text-[color:var(--lime-danger)]"
            >
              {t("settings.worktrees.deleteFailed")}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <SettingsAction type="button" disabled={pending}>
                {t("settings.worktrees.cancel")}
              </SettingsAction>
            </Dialog.Close>
            <SettingsAction
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void remove()}
            >
              <span className="text-[color:var(--lime-danger)]">
                {t("settings.worktrees.delete")}
              </span>
            </SettingsAction>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
