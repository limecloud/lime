import { useEffect, useState } from "react";
import { Globe, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import { effectiveDesktopPreferences } from "@/lib/api/desktopPreferences";
import {
  DEFAULT_BROWSER_SETTINGS,
  type BrowserSettings,
} from "@/lib/api/browserSettings";
import { pickFilesFromDialog } from "@/lib/api/filePicker";
import type { LinkOpenTarget } from "@/lib/api/appConfigTypes";
import { PreferenceMenu } from "./PreferenceMenu";
import { useBrowserSettings } from "./useBrowserSettings";
import { BrowserAgentPermissions } from "./BrowserAgentPermissions";
import { BrowserHistoryPage } from "./BrowserHistoryPage";
import {
  BROWSER_SETTINGS_BUTTON,
  BrowserSettingsRow,
  BrowserSettingsSection,
  BrowserSettingsSwitch,
} from "./BrowserSettingsFields";

export function BrowserUseSettings({ page }: { page?: "history" } = {}) {
  const [currentPage, setCurrentPage] = useState(page);
  useEffect(() => setCurrentPage(page), [page]);
  if (currentPage === "history")
    return <BrowserHistoryPage onBack={() => setCurrentPage(undefined)} />;
  return <BrowserSettingsPage onHistory={() => setCurrentPage("history")} />;
}

function BrowserSettingsPage({ onHistory }: { onHistory: () => void }) {
  const { t } = useTranslation("settings");
  const desktop = useDesktopPreferences();
  const browser = useBrowserSettings();
  const [dialogError, setDialogError] = useState(false);
  const [choosingDirectory, setChoosingDirectory] = useState(false);
  const effective = effectiveDesktopPreferences(
    desktop.configured ?? undefined,
  );
  const preferences = browser.configured ?? DEFAULT_BROWSER_SETTINGS;
  const pending = browser.pending || desktop.pending || choosingDirectory;
  const disabled = !browser.configured || pending;
  const options: { value: LinkOpenTarget; label: string }[] = [
    { value: "in-app-browser", label: t("settings.browser.inApp") },
    { value: "external-browser", label: t("settings.browser.external") },
  ];
  const toggle = (
    key:
      | "enabled"
      | "show_full_url"
      | "ask_download_location"
      | "site_tools_enabled"
      | "full_cdp_access",
    id: string,
  ) => (
    <BrowserSettingsSwitch
      id={id}
      checked={preferences[key]}
      disabled={disabled}
      onChange={(value) => void browser.save(key, value)}
    />
  );
  const chooseDirectory = async () => {
    setChoosingDirectory(true);
    setDialogError(false);
    try {
      const [selected] = await pickFilesFromDialog({
        kind: "directory",
        allowMultiple: false,
        title: t("settings.browser.chooseDownloadDirectory"),
      });
      if (selected) await browser.save("download_directory", selected.fsPath);
    } catch {
      setDialogError(true);
    } finally {
      setChoosingDirectory(false);
    }
  };
  const error = desktop.error ?? browser.error;
  return (
    <div
      className="mx-auto max-w-[640px] space-y-8 pb-8"
      aria-busy={
        pending ||
        (!browser.configured && !browser.error) ||
        (!desktop.configured && !desktop.error)
      }
    >
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("settings.tab.browser")}</h1>
        <p className="text-xs text-muted-foreground">
          {t("settings.browser.description")}
        </p>
      </header>
      {error || dialogError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 text-sm text-destructive"
        >
          {dialogError
            ? t("settings.browser.error.directory")
            : error === "load"
              ? t("settings.browser.error.load")
              : t("settings.browser.error.save")}
          {error === "load" ? (
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              onClick={() => {
                void desktop.refresh();
                void browser.refresh();
              }}
            >
              {t("settings.browser.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-xl border border-border bg-background px-4">
        <BrowserSettingsRow
          id="browser-enabled"
          label={t("settings.tab.browser")}
          description={t("settings.browser.enabledDescription")}
          leading={
            <Globe
              className="size-6 shrink-0 text-foreground"
              aria-hidden="true"
            />
          }
        >
          {toggle("enabled", "browser-enabled")}
        </BrowserSettingsRow>
      </div>
      <BrowserSettingsSection
        id="browser-general"
        title={t("settings.browser.general")}
      >
        <PreferenceMenu
          label={t("settings.browser.web")}
          targetId="browser-web-target"
          value={effective["open-link-in-target-preference"]}
          options={options}
          disabled={!desktop.configured || pending}
          onChange={(value) =>
            void desktop.save("open-link-in-target-preference", value)
          }
        />
        <PreferenceMenu
          label={t("settings.browser.local")}
          description={t("settings.browser.localDescription")}
          targetId="browser-local-target"
          value={effective["open-local-url-in-target-preference"]}
          options={options}
          disabled={!desktop.configured || pending}
          onChange={(value) =>
            void desktop.save("open-local-url-in-target-preference", value)
          }
        />
        <BrowserSettingsRow
          id="browser-history"
          label={t("browserHistory.title")}
          description={t("browserHistory.description")}
        >
          <button
            type="button"
            className={BROWSER_SETTINGS_BUTTON}
            onClick={onHistory}
          >
            {t("browserHistory.manage")}
          </button>
        </BrowserSettingsRow>
        <BrowserSettingsRow
          id="browser-full-url"
          label={t("settings.browser.showFullUrl")}
          description={t("settings.browser.showFullUrlDescription")}
        >
          {toggle("show_full_url", "browser-full-url")}
        </BrowserSettingsRow>
        <PreferenceMenu
          label={t("settings.browser.annotationScreenshot")}
          description={t("settings.browser.annotationScreenshotDescription")}
          targetId="browser-annotation-screenshot"
          value={preferences.annotation_screenshot}
          disabled={disabled}
          options={(["always", "necessary"] as const).map((value) => ({
            value,
            label: t(`settings.browser.screenshot.${value}`),
          }))}
          onChange={(value) =>
            void browser.save("annotation_screenshot", value)
          }
        />
      </BrowserSettingsSection>
      <BrowserSettingsSection
        id="browser-downloads"
        title={t("settings.browser.downloads")}
      >
        <BrowserSettingsRow
          id="browser-download-directory"
          label={t("settings.browser.downloadDirectory")}
          description={
            preferences.download_directory ??
            t("settings.browser.systemDownloads")
          }
        >
          <div className="flex shrink-0 gap-1">
            {preferences.download_directory ? (
              <button
                type="button"
                className={BROWSER_SETTINGS_BUTTON}
                disabled={disabled}
                onClick={() => void browser.save("download_directory", null)}
              >
                {t("settings.browser.reset")}
              </button>
            ) : null}
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              disabled={disabled}
              onClick={() => void chooseDirectory()}
            >
              {t("settings.browser.change")}
            </button>
          </div>
        </BrowserSettingsRow>
        <BrowserSettingsRow
          id="browser-ask-download"
          label={t("settings.browser.askDownloadLocation")}
          description={t("settings.browser.askDownloadLocationDescription")}
        >
          {toggle("ask_download_location", "browser-ask-download")}
        </BrowserSettingsRow>
      </BrowserSettingsSection>
      <BrowserSettingsSection
        id="browser-permissions"
        title={t("settings.browser.permissions")}
      >
        <PreferenceMenu
          label={t("settings.browser.historyAccess")}
          description={t("settings.browser.historyAccessDescription")}
          targetId="browser-history-access"
          value={preferences.history_access}
          disabled={disabled}
          options={(["alwaysAsk", "neverAsk", "disabled"] as const).map(
            (value) => ({
              value,
              label: t(`settings.browser.history.${value}`),
            }),
          )}
          onChange={(value) =>
            void browser.save(
              "history_access",
              value as BrowserSettings["history_access"],
            )
          }
        />
        <BrowserSettingsRow
          id="browser-site-tools"
          label={t("settings.browser.siteTools")}
          description={t("settings.browser.siteToolsDescription")}
        >
          {toggle("site_tools_enabled", "browser-site-tools")}
        </BrowserSettingsRow>
      </BrowserSettingsSection>
      <BrowserAgentPermissions
        value={preferences.agent_permissions}
        disabled={disabled}
        onChange={(value) => browser.save("agent_permissions", value)}
      />
      <BrowserSettingsSection
        id="browser-developer"
        title={t("settings.browser.developerMode")}
      >
        <BrowserSettingsRow
          id="browser-full-cdp"
          label={t("settings.browser.fullCdp")}
          description={t("settings.browser.fullCdpDescription")}
        >
          <div className="flex shrink-0 items-center gap-3">
            <ShieldAlert
              className="size-4 text-destructive"
              aria-hidden="true"
            />
            {toggle("full_cdp_access", "browser-full-cdp")}
          </div>
        </BrowserSettingsRow>
      </BrowserSettingsSection>
    </div>
  );
}
