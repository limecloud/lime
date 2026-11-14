import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import {
  getBrowserPasswordManagerProvider,
  setBrowserPasswordManagerProvider,
  type BrowserPasswordManagerProvider,
} from "@/lib/api/browserPasswordManager";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

const PROVIDERS: readonly BrowserPasswordManagerProvider[] = [
  "onepassword",
  "openai",
];

export function BrowserPasswordManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [provider, setProvider] =
    useState<BrowserPasswordManagerProvider | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(false);
    void getBrowserPasswordManagerProvider()
      .then((value) => {
        if (alive.current) setProvider(value);
      })
      .catch(() => {
        if (alive.current) setError(true);
      });
  }, [open]);

  const save = async () => {
    setPending(true);
    setError(false);
    try {
      await setBrowserPasswordManagerProvider(provider);
      if (alive.current) onOpenChange(false);
    } catch {
      if (alive.current) setError(true);
    } finally {
      if (alive.current) setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-xl"
          data-testid="browser-password-manager-dialog"
        >
          <Dialog.Title className="text-base font-medium">
            {t("settings.browser.passwordManagerTitle")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-muted-foreground">
            {t("settings.browser.passwordManagerSetupDescription")}
          </Dialog.Description>
          <fieldset className="mt-4">
            <legend className="text-xs font-medium text-muted-foreground">
              {t("settings.browser.passwordManagerChoose")}
            </legend>
            <div className="mt-2 space-y-2">
              {PROVIDERS.map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <input
                    type="radio"
                    name="password-manager-provider"
                    checked={provider === value}
                    onChange={() => setProvider(value)}
                  />
                  {t(
                    value === "onepassword"
                      ? "settings.browser.passwordManager1Password"
                      : "settings.browser.passwordManagerOpenAI",
                  )}
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="mt-3 text-xs text-destructive">
              {t("settings.browser.passwordManagerSaveFailed")}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {t("settings.browser.passwordManagerNotNow")}
            </button>
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={pending}
              onClick={() => void save()}
            >
              {t("settings.browser.passwordManagerSave")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
