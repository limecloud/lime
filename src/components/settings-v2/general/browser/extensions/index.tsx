import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import { revealPathInFinder } from "@/lib/api/fileSystem";
import {
  importChromeBrowserExtensions,
  listBrowserExtensions,
  loadBrowserExtension,
  removeBrowserExtension,
  setBrowserExtensionEnabled,
  type BrowserExtensionSummary,
} from "@/lib/api/browserExtensions";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsLoading,
  SettingsPageBody,
  SettingsPageHeader,
} from "../../../SettingsPrimitives";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BROWSER_SETTINGS_BUTTON } from "../BrowserSettingsFields";

const SEARCH_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

type ErrorKind = "load" | "import" | "remove" | "reveal";

export function BrowserExtensionSettings({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const { t } = useTranslation("settings");
  const [extensions, setExtensions] = useState<
    BrowserExtensionSummary[] | null
  >(null);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
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
    void refresh();
  }, []);

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

  const importChrome = async () => {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const result = await importChromeBrowserExtensions();
      setImportResult(
        t("settings.browser.extensionsImportChromeDone", {
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
        }),
      );
      await refresh();
    } catch {
      if (alive.current) setError("import");
    } finally {
      if (alive.current) setImporting(false);
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
      return (
        !needle ||
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

  const content = (
    <>
      <p className="text-[13px] text-muted-foreground">
        {t("settings.browser.extensionManagerDescription")}
      </p>
      <div className="flex items-center gap-2">
        <SettingsAction
          type="button"
          disabled={pending}
          onClick={() => void refresh()}
        >
          {t("settings.browser.extensionsRefresh")}
        </SettingsAction>
        <SettingsAction
          type="button"
          disabled={pending}
          onClick={() => void add()}
        >
          {t("settings.browser.extensionsLoad")}
        </SettingsAction>
        <SettingsAction
          type="button"
          disabled={pending || importing}
          onClick={() => setConfirmImport(true)}
        >
          {importing
            ? t("settings.browser.extensionsImportChromeRunning")
            : t("settings.browser.extensionsImportChrome")}
        </SettingsAction>
      </div>
      {extensions === null && !errorMessage ? <SettingsLoading /> : null}
      {extensions && extensions.length > 0 ? (
        <input
          type="search"
          aria-label={t("settings.browser.extensionsSearch")}
          placeholder={t("settings.browser.extensionsSearch")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={SEARCH_CLASS}
        />
      ) : null}
      {extensions && extensions.length === 0 ? (
        <SettingsEmptyState>
          {t("settings.browser.extensionsEmpty")}
        </SettingsEmptyState>
      ) : null}
      {filtered &&
      filtered.length === 0 &&
      extensions &&
      extensions.length > 0 ? (
        <SettingsEmptyState>
          {t("settings.browser.extensionsNoResults")}
        </SettingsEmptyState>
      ) : null}
      {filtered && filtered.length > 0 ? (
        <SettingsGroup>
          {filtered.map((extension) => (
            <div
              key={extension.id}
              className="flex items-center gap-3 px-4 py-2.5"
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
            </div>
          ))}
        </SettingsGroup>
      ) : null}
      {importResult ? (
        <p className="text-xs text-muted-foreground">{importResult}</p>
      ) : null}
      <ConfirmDialog
        isOpen={confirmImport}
        title={t("settings.browser.extensionsImportChromeTitle")}
        message={t("settings.browser.extensionsImportChromeMessage")}
        confirmText={t("settings.browser.extensionsImportChrome")}
        cancelText={t("settings.browser.extensionsImportChromeCancel")}
        onCancel={() => setConfirmImport(false)}
        onConfirm={() => {
          setConfirmImport(false);
          void importChrome();
        }}
      />
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </>
  );
  if (embedded) {
    return (
      <div
        className="flex flex-col gap-3"
        data-settings-search-target="browser-extension-manager"
      >
        {content}
      </div>
    );
  }
  return (
    <SettingsPageBody data-settings-search-target="browser-extension-manager">
      <SettingsPageHeader title={t("settings.browser.extensionsTitle")} />
      {content}
    </SettingsPageBody>
  );
}
