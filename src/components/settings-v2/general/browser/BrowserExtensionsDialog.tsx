import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import {
  listBrowserExtensions,
  loadBrowserExtension,
  removeBrowserExtension,
  setBrowserExtensionEnabled,
  type BrowserExtensionSummary,
} from "@/lib/api/browserExtensions";
import { BROWSER_SETTINGS_BUTTON } from "./BrowserSettingsFields";

const EXTENSION_SEARCH_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

type ErrorKind = "load" | "import" | "remove" | "reveal";

export function BrowserExtensionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const [extensions, setExtensions] = useState<
    BrowserExtensionSummary[] | null
  >(null);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = async () => {
    try {
      const next = await listBrowserExtensions();
      if (alive.current) {
        setExtensions(next);
        setError(null);
      }
    } catch {
      if (alive.current) setError("load");
    }
  };

  useEffect(() => {
    if (open) {
      setExtensions(null);
      setError(null);
      setQuery("");
      void refresh();
    }
    // refresh 仅依赖浏览器扩展 API，打开时读取一次即可。
  }, [open]);

  const add = async () => {
    setPending(true);
    setError(null);
    try {
      const files = await pickFilesFromDialog({
        allowMultiple: false,
        kind: "directory",
        title: t("settings.browser.extensionsLoad"),
      });
      const directory = files[0];
      if (!directory) return;
      await loadBrowserExtension(directory.fsPath);
      await refresh();
    } catch {
      if (alive.current) setError("import");
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const reveal = async (path: string) => {
    setError(null);
    try {
      await revealPathInFinder(path);
    } catch {
      if (alive.current) setError("reveal");
    }
  };

  const toggleEnabled = async (extension: BrowserExtensionSummary) => {
    setPending(true);
    setError(null);
    try {
      await setBrowserExtensionEnabled(extension.id, !extension.enabled);
      await refresh();
    } catch {
      if (alive.current) setError("import");
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const remove = async (id: string) => {
    setPending(true);
    setError(null);
    try {
      await removeBrowserExtension(id);
      await refresh();
    } catch {
      if (alive.current) setError("remove");
    } finally {
      if (alive.current) setPending(false);
    }
  };

  const filtered =
    extensions?.filter((extension) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return (
        extension.name.toLowerCase().includes(needle) ||
        extension.path.toLowerCase().includes(needle)
      );
    }) ?? null;

  const errorMessage =
    error === "load"
      ? t("settings.browser.extensionsLoadFailed")
      : error === "import"
        ? t("settings.browser.extensionsImportFailed")
        : error === "remove"
          ? t("settings.browser.extensionsRemoveFailed")
          : error === "reveal"
            ? t("settings.browser.extensionsRevealFailed")
            : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          data-testid="browser-extensions-dialog"
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl"
          aria-describedby={undefined}
        >
          <Dialog.Title className="text-lg font-semibold">
            {t("settings.browser.extensionManager")}
          </Dialog.Title>
          {extensions === null && !errorMessage ? (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              {t("settings.browser.extensionsLoading")}
            </p>
          ) : null}
          {extensions && extensions.length > 0 ? (
            <input
              type="search"
              aria-label={t("settings.browser.extensionsSearch")}
              placeholder={t("settings.browser.extensionsSearch")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={`mt-4 ${EXTENSION_SEARCH_CLASS}`}
            />
          ) : null}
          {extensions && extensions.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("settings.browser.extensionsEmpty")}
            </p>
          ) : null}
          {filtered &&
          filtered.length === 0 &&
          extensions &&
          extensions.length > 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("settings.browser.extensionsNoResults")}
            </p>
          ) : null}
          {filtered && filtered.length > 0 ? (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {filtered.map((extension) => (
                <li
                  key={extension.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">
                      {extension.name}{" "}
                      <span className="text-[12px] font-normal text-muted-foreground">
                        v{extension.version}
                      </span>
                    </div>
                    <div
                      className="truncate text-[11px] text-muted-foreground"
                      title={extension.path}
                    >
                      {extension.path}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={BROWSER_SETTINGS_BUTTON}
                    disabled={pending}
                    onClick={() => void toggleEnabled(extension)}
                  >
                    {extension.enabled
                      ? t("settings.browser.extensionsDisable")
                      : t("settings.browser.extensionsEnable")}
                  </button>
                  <button
                    type="button"
                    className={BROWSER_SETTINGS_BUTTON}
                    disabled={pending}
                    onClick={() => void reveal(extension.path)}
                  >
                    {t("settings.browser.extensionsReveal")}
                  </button>
                  <button
                    type="button"
                    className={BROWSER_SETTINGS_BUTTON}
                    disabled={pending}
                    onClick={() => void remove(extension.id)}
                  >
                    {t("settings.browser.extensionsRemove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={pending}
              onClick={() => void refresh()}
            >
              {t("settings.browser.extensionsRefresh")}
            </button>
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={pending}
              onClick={() => void add()}
            >
              {t("settings.browser.extensionsLoad")}
            </button>
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              onClick={() => onOpenChange(false)}
            >
              {t("settings.browser.extensionsClose")}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
