import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  addSshConnection,
  updateSshConnection,
  type SshConnection,
} from "@/lib/api/sshConnections";
import { SettingsAction } from "../../SettingsPrimitives";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring";

export function SshConnectionDialog({
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  initial?: SshConnection | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("settings");
  const editing = Boolean(initial);
  const [alias, setAlias] = useState("");
  const [hostName, setHostName] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAlias(initial?.alias ?? "");
    setHostName(initial?.hostName ?? "");
    setUser(initial?.user ?? "");
    setPort(initial?.port ? String(initial.port) : "");
    setPending(false);
    setError(false);
  }, [open, initial]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const input = {
        hostName: hostName.trim(),
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(port.trim() ? { port: Number(port) } : {}),
      };
      if (initial) {
        await updateSshConnection(initial.alias, input);
      } else {
        await addSshConnection({ alias: alias.trim(), ...input });
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-testid="ssh-connection-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
          aria-describedby={undefined}
        >
          <Dialog.Title className="text-lg font-semibold">
            {editing
              ? t("settings.connections.editTitle")
              : t("settings.connections.addTitle")}
          </Dialog.Title>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => void submit(event)}
          >
            <label className="block text-[12px] text-muted-foreground">
              {t("settings.connections.alias")}
              <input
                autoFocus={!editing}
                disabled={editing}
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-[12px] text-muted-foreground">
              {t("settings.connections.hostName")}
              <input
                autoFocus={editing}
                value={hostName}
                onChange={(event) => setHostName(event.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-[12px] text-muted-foreground">
              {t("settings.connections.user")}
              <input
                value={user}
                onChange={(event) => setUser(event.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            <label className="block text-[12px] text-muted-foreground">
              {t("settings.connections.port")}
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.target.value)}
                className={`mt-1 ${inputClass}`}
              />
            </label>
            {error ? (
              <p role="alert" className="text-[12px] text-destructive">
                {editing
                  ? t("settings.connections.updateFailed")
                  : t("settings.connections.addFailed")}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <SettingsAction
                type="button"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                {t("settings.connections.cancel")}
              </SettingsAction>
              <SettingsAction
                type="submit"
                disabled={pending || !alias.trim() || !hostName.trim()}
              >
                {t("settings.connections.save")}
              </SettingsAction>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
