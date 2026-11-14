import { useEffect, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  listBrowserPasswords,
  removeBrowserPassword,
  revealBrowserPassword,
  saveBrowserPassword,
  type BrowserPasswordSummary,
} from "@/lib/api/browserPasswords";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

type ErrorKind = "load" | "save" | "remove" | "reveal" | "copy";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-ring";

export function BrowserPasswordsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [passwords, setPasswords] = useState<BrowserPasswordSummary[] | null>(
    null,
  );
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] =
    useState<BrowserPasswordSummary | null>(null);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedOrigin = (() => {
    const value = origin.trim();
    if (!value) return "";
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  })();
  const originInvalid = (() => {
    if (!normalizedOrigin) return false;
    try {
      const url = new URL(normalizedOrigin);
      return url.protocol !== "http:" && url.protocol !== "https:";
    } catch {
      return true;
    }
  })();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = async () => {
    try {
      const next = await listBrowserPasswords();
      if (alive.current) {
        setPasswords(next);
        setError(null);
      }
    } catch {
      if (alive.current) setError("load");
    }
  };

  useEffect(() => {
    if (!open) return;
    setPasswords(null);
    setError(null);
    setOrigin("");
    setUsername("");
    setPassword("");
    setQuery("");
    setRevealed({});
    setCopiedId(null);
    void refresh();
    // 打开时读取一次；refresh 仅依赖密码 API。
  }, [open]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await saveBrowserPassword({
        origin: normalizedOrigin,
        username,
        password,
      });
      setOrigin("");
      setUsername("");
      setPassword("");
      await refresh();
    } catch {
      if (alive.current) setError("save");
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const toggleReveal = async (item: BrowserPasswordSummary) => {
    if (revealed[item.id] !== undefined) {
      setRevealed((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      return;
    }
    setError(null);
    try {
      const value = await revealBrowserPassword(item.id);
      if (alive.current && value !== null) {
        setRevealed((current) => ({ ...current, [item.id]: value }));
      }
    } catch {
      if (alive.current) setError("reveal");
    }
  };

  const copy = async (item: BrowserPasswordSummary) => {
    setError(null);
    try {
      const value = await revealBrowserPassword(item.id);
      if (value === null) throw new Error("missing password");
      await navigator.clipboard.writeText(value);
      if (alive.current) {
        setCopiedId(item.id);
        globalThis.setTimeout(() => {
          if (alive.current) {
            setCopiedId((current) => (current === item.id ? null : current));
          }
        }, 1500);
      }
    } catch {
      if (alive.current) setError("copy");
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    const id = pendingRemove.id;
    setPendingRemove(null);
    setError(null);
    try {
      await removeBrowserPassword(id);
      await refresh();
    } catch {
      if (alive.current) setError("remove");
    }
  };

  const filtered =
    passwords?.filter((item) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        item.origin.toLowerCase().includes(needle) ||
        item.username.toLowerCase().includes(needle)
      );
    }) ?? null;

  const errorMessage =
    error === "load"
      ? t("settings.browser.passwordManagerLoadFailed")
      : error === "save"
        ? t("settings.browser.passwordManagerSaveFailed")
        : error === "remove"
          ? t("settings.browser.passwordManagerRemoveFailed")
          : error === "reveal"
            ? t("settings.browser.passwordManagerRevealFailed")
            : error === "copy"
              ? t("settings.browser.passwordManagerCopyFailed")
              : null;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content
            data-testid="browser-passwords-dialog"
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-lg font-semibold">
              {t("settings.browser.passwordManager")}
            </Dialog.Title>

            <form
              className="mt-4 space-y-2"
              onSubmit={(event) => void save(event)}
            >
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label={t("settings.browser.passwordManagerOrigin")}
                  placeholder={t("settings.browser.passwordManagerOrigin")}
                  value={origin}
                  onChange={(event) => setOrigin(event.target.value)}
                  className={inputClass}
                />
                <input
                  aria-label={t("settings.browser.passwordManagerUsername")}
                  placeholder={t("settings.browser.passwordManagerUsername")}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  aria-label={t("settings.browser.passwordManagerPassword")}
                  placeholder={t("settings.browser.passwordManagerPassword")}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
                <button
                  type="submit"
                  className={BROWSER_SETTINGS_BUTTON}
                  disabled={
                    pending ||
                    !normalizedOrigin ||
                    originInvalid ||
                    !username.trim() ||
                    !password
                  }
                >
                  {t("settings.browser.passwordManagerSave")}
                </button>
              </div>
              {originInvalid ? (
                <p className="text-[12px] text-destructive">
                  {t("settings.browser.passwordManagerInvalidOrigin")}
                </p>
              ) : null}
            </form>

            {errorMessage ? (
              <p role="alert" className="mt-3 text-[12px] text-destructive">
                {errorMessage}
              </p>
            ) : null}

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              {passwords !== null && passwords.length > 0 ? (
                <input
                  type="search"
                  aria-label={t("settings.browser.passwordManagerSearch")}
                  placeholder={t("settings.browser.passwordManagerSearch")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className={`mb-2 ${inputClass}`}
                />
              ) : null}
              {filtered === null ? null : filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {passwords && passwords.length > 0
                    ? t("settings.browser.passwordManagerNoResults")
                    : t("settings.browser.passwordManagerEmpty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {filtered.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{item.origin}</p>
                        <p className="truncate text-[12px] text-muted-foreground">
                          {item.username}
                          {revealed[item.id] !== undefined
                            ? ` · ${revealed[item.id]}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className={BROWSER_SETTINGS_BUTTON}
                          onClick={() => void toggleReveal(item)}
                        >
                          {revealed[item.id] !== undefined
                            ? t("settings.browser.passwordManagerHide")
                            : t("settings.browser.passwordManagerReveal")}
                        </button>
                        <button
                          type="button"
                          className={BROWSER_SETTINGS_BUTTON}
                          onClick={() => void copy(item)}
                        >
                          {copiedId === item.id
                            ? t("settings.browser.passwordManagerCopied")
                            : t("settings.browser.passwordManagerCopy")}
                        </button>
                        <button
                          type="button"
                          className={BROWSER_SETTINGS_BUTTON}
                          onClick={() => setPendingRemove(item)}
                        >
                          {t("settings.browser.passwordManagerRemove")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className={BROWSER_SETTINGS_BUTTON}
                onClick={() => onOpenChange(false)}
              >
                {t("settings.browser.passwordManagerClose")}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        isOpen={pendingRemove !== null}
        title={t("settings.browser.passwordManagerRemoveTitle")}
        message={t("settings.browser.passwordManagerRemoveMessage", {
          origin: pendingRemove?.origin ?? "",
          username: pendingRemove?.username ?? "",
        })}
        confirmText={t("settings.browser.passwordManagerRemove")}
        cancelText={t("settings.browser.passwordManagerCancel")}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
