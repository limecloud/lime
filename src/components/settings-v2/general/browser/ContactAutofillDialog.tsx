import { useEffect, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import {
  clearContactAutofillData,
  readContactAutofillData,
  saveContactAutofillData,
  type ContactAutofillData,
} from "@/lib/api/contactAutofill";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring";
const EMPTY: ContactAutofillData = { emails: [], phones: [], addresses: [] };
const EMPTY_DRAFTS: Record<keyof ContactAutofillData, string> = {
  emails: "",
  phones: "",
  addresses: "",
};

type ContactKey = keyof ContactAutofillData;

export function ContactAutofillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [data, setData] = useState<ContactAutofillData>(EMPTY);
  const [drafts, setDrafts] =
    useState<Record<ContactKey, string>>(EMPTY_DRAFTS);
  const [pending, setPending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<"load" | "save" | "clear" | null>(null);
  const emailInvalid = data.emails.some(
    (email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()),
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    void readContactAutofillData()
      .then((value) => {
        setData(value ?? EMPTY);
        setDrafts(EMPTY_DRAFTS);
      })
      .catch(() => setError("load"));
  }, [open]);

  const update = (key: ContactKey, index: number, value: string) => {
    setData((current) => ({
      ...current,
      [key]: current[key].map((item, i) => (i === index ? value : item)),
    }));
  };

  const add = (key: ContactKey) => {
    const value = drafts[key].trim();
    if (!value) return;
    setData((current) => ({
      ...current,
      [key]: [...new Set([...current[key], value])],
    }));
    setDrafts((current) => ({ ...current, [key]: "" }));
  };

  const remove = (key: ContactKey, index: number) => {
    setData((current) => ({
      ...current,
      [key]: current[key].filter((_, i) => i !== index),
    }));
  };

  const clear = async () => {
    setConfirmClear(false);
    setError(null);
    try {
      await clearContactAutofillData();
      setData(EMPTY);
      setDrafts(EMPTY_DRAFTS);
    } catch {
      setError("clear");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || emailInvalid) return;
    setPending(true);
    setError(null);
    try {
      await saveContactAutofillData(data);
      onOpenChange(false);
    } catch {
      setError("save");
    } finally {
      setPending(false);
    }
  };

  const sections: Array<{
    key: ContactKey;
    label: string;
    placeholder: string;
  }> = [
    {
      key: "emails",
      label: t("settings.browser.contactEmail"),
      placeholder: t("settings.browser.contactEmailPlaceholder"),
    },
    {
      key: "phones",
      label: t("settings.browser.contactPhone"),
      placeholder: t("settings.browser.contactPhonePlaceholder"),
    },
    {
      key: "addresses",
      label: t("settings.browser.contactAddress"),
      placeholder: t("settings.browser.contactAddressPlaceholder"),
    },
  ];

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            data-testid="contact-autofill-dialog"
            className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-lg font-semibold">
              {t("settings.browser.contactTitle")}
            </Dialog.Title>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.browser.contactDescription")}
            </p>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => void submit(event)}
            >
              {sections.map(({ key, label, placeholder }) => (
                <fieldset key={key} className="space-y-2">
                  <legend className="text-xs font-medium text-muted-foreground">
                    {label}
                  </legend>
                  {data[key].map((item, index) => (
                    <div
                      key={`${key}-${index}`}
                      className="flex items-center gap-2"
                    >
                      <input
                        aria-label={label}
                        value={item}
                        onChange={(event) =>
                          update(key, index, event.target.value)
                        }
                        className={inputClass}
                      />
                      <button
                        type="button"
                        className={BROWSER_SETTINGS_BUTTON}
                        onClick={() => remove(key, index)}
                      >
                        {t("settings.browser.contactRemove")}
                      </button>
                    </div>
                  ))}
                  {data[key].length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      {t("settings.browser.contactEmpty")}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={placeholder}
                      placeholder={placeholder}
                      value={drafts[key]}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                    <button
                      type="button"
                      className={BROWSER_SETTINGS_BUTTON}
                      onClick={() => add(key)}
                    >
                      {t("settings.browser.contactAdd")}
                    </button>
                  </div>
                </fieldset>
              ))}
              {emailInvalid ? (
                <p role="alert" className="text-[12px] text-destructive">
                  {t("settings.browser.contactEmailInvalid")}
                </p>
              ) : null}
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
