import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  clearContactAutofillProfile,
  readContactAutofillProfile,
  saveContactAutofillProfile,
} from "@/lib/api/contactAutofill";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring";

export function ContactAutofillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<"load" | "save" | "clear" | null>(null);
  const emailInvalid =
    email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    if (!open) return;
    setError(null);
    void readContactAutofillProfile()
      .then((profile) => {
        setFullName(profile?.fullName ?? "");
        setEmail(profile?.email ?? "");
        setPhone(profile?.phone ?? "");
        setAddress(profile?.address ?? "");
      })
      .catch(() => setError("load"));
  }, [open]);

  const clear = async () => {
    setConfirmClear(false);
    setError(null);
    try {
      await clearContactAutofillProfile();
      setFullName("");
      setEmail("");
      setPhone("");
      setAddress("");
    } catch {
      setError("clear");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await saveContactAutofillProfile({ fullName, email, phone, address });
      onOpenChange(false);
    } catch {
      setError("save");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            data-testid="contact-autofill-dialog"
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-lg font-semibold">
              {t("settings.browser.contactTitle")}
            </Dialog.Title>
            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => void submit(event)}
            >
              <input
                aria-label={t("settings.browser.contactName")}
                placeholder={t("settings.browser.contactName")}
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className={inputClass}
              />
              <input
                aria-label={t("settings.browser.contactEmail")}
                placeholder={t("settings.browser.contactEmail")}
                aria-invalid={emailInvalid || undefined}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
              {emailInvalid ? (
                <p className="text-[12px] text-destructive">
                  {t("settings.browser.contactEmailInvalid")}
                </p>
              ) : null}
              <input
                aria-label={t("settings.browser.contactPhone")}
                placeholder={t("settings.browser.contactPhone")}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={inputClass}
              />
              <input
                aria-label={t("settings.browser.contactAddress")}
                placeholder={t("settings.browser.contactAddress")}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className={inputClass}
              />
              {error ? (
                <p role="alert" className="text-[12px] text-destructive">
                  {error === "load"
                    ? t("settings.browser.contactLoadFailed")
                    : error === "clear"
                      ? t("settings.browser.contactClearFailed")
                      : t("settings.browser.contactSaveFailed")}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className={BROWSER_SETTINGS_BUTTON}
                  onClick={() => setConfirmClear(true)}
                >
                  {t("settings.browser.contactClear")}
                </button>
                <button
                  type="button"
                  className={BROWSER_SETTINGS_BUTTON}
                  onClick={() => onOpenChange(false)}
                >
                  {t("settings.browser.contactClose")}
                </button>
                <button
                  type="submit"
                  className={BROWSER_SETTINGS_BUTTON}
                  disabled={pending || emailInvalid}
                >
                  {t("settings.browser.contactSave")}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        isOpen={confirmClear}
        title={t("settings.browser.contactClearTitle")}
        message={t("settings.browser.contactClearMessage")}
        confirmText={t("settings.browser.contactClear")}
        cancelText={t("settings.browser.contactCancel")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void clear()}
      />
    </>
  );
}
