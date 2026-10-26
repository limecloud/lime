import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  BrowserSitePermission,
  BrowserSitePermissionSetting,
} from "@/lib/api/browserSiteSettingsTypes";
import {
  BROWSER_SITE_PERMISSIONS,
  browserSitePermissionAvailable,
  browserSitePermissionSettings,
  DEFAULT_BROWSER_SITE_SETTINGS,
  parseBrowserSiteOrigin,
} from "@/lib/api/browserSiteSettingsTypes";
import { BrowserManagementHeader } from "./BrowserManagementHeader";
import {
  BROWSER_SETTINGS_BUTTON,
  BrowserSettingsRow,
  BrowserSettingsSection,
} from "./BrowserSettingsFields";
import { useBrowserSiteSettings } from "./useBrowserSiteSettings";

const permissions = BROWSER_SITE_PERMISSIONS;
const permissionLabels: Record<BrowserSitePermission, string> = {
  camera: "browserSiteSettings.camera",
  microphone: "browserSiteSettings.microphone",
  geolocation: "browserSiteSettings.geolocation",
  notifications: "browserSiteSettings.notifications",
  clipboard: "browserSiteSettings.clipboard",
  sound: "browserSiteSettings.sound",
  protectedContent: "browserSiteSettings.protectedContent",
  automaticDownloads: "browserSiteSettings.automaticDownloads",
  images: "browserSiteSettings.images",
};

export function BrowserSiteSettingsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation("settings");
  const settings = useBrowserSiteSettings();
  const [origin, setOrigin] = useState("");
  const [originError, setOriginError] = useState(false);
  const snapshot = settings.snapshot;
  const disabled = settings.pending || !snapshot;

  const addOrigin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setOriginError(false);
    let canonicalOrigin: string;
    try {
      const parsed = new URL(origin.trim());
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      )
        throw new Error("Invalid browser site origin");
      canonicalOrigin = parseBrowserSiteOrigin(parsed.origin);
    } catch {
      setOriginError(true);
      return;
    }
    if (snapshot?.sites.some((site) => site.origin === canonicalOrigin)) {
      setOriginError(true);
      return;
    }
    const saved = await settings.save({
      origin: canonicalOrigin,
      permission: "camera",
      setting: null,
    });
    if (saved) setOrigin("");
  };

  const update = (
    permission: BrowserSitePermission,
    setting: BrowserSitePermissionSetting,
  ) => void settings.save({ origin: null, permission, setting });

  return (
    <div
      className="mx-auto w-full max-w-[960px] space-y-5 pb-8"
      data-testid="browser-site-settings-page"
      aria-busy={settings.pending}
    >
      <BrowserManagementHeader
        title={t("browserSiteSettings.title")}
        onBack={onBack}
      />
      {settings.error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 text-sm text-destructive"
        >
          <span>
            {t(
              settings.error === "load"
                ? "browserSiteSettings.loadError"
                : "browserSiteSettings.saveError",
            )}
          </span>
          {settings.error === "load" ? (
            <button
              type="button"
              className={BROWSER_SETTINGS_BUTTON}
              onClick={() => void settings.refresh()}
            >
              {t("browserSiteSettings.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <BrowserSettingsSection
        id="browser-site-settings-defaults"
        title={t("browserSiteSettings.defaults")}
      >
        {permissions.map((permission) => (
          <PermissionRow
            key={permission}
            id={`browser-site-default-${permission}`}
            label={t(permissionLabels[permission])}
            choices={browserSitePermissionSettings(permission)}
            value={
              snapshot?.defaults[permission] ??
              DEFAULT_BROWSER_SITE_SETTINGS[permission]
            }
            disabled={disabled || !browserSitePermissionAvailable(permission)}
            unavailable={!browserSitePermissionAvailable(permission)}
            onChange={(setting) => {
              if (setting !== "default") update(permission, setting);
            }}
            t={t}
          />
        ))}
      </BrowserSettingsSection>
      <BrowserSettingsSection
        id="browser-site-settings-sites"
        title={t("browserSiteSettings.sites")}
        action={
          snapshot?.sites.length ? (
            <span className="text-xs text-muted-foreground">
              {t("browserSiteSettings.siteCount", {
                count: snapshot.sites.length,
              })}
            </span>
          ) : undefined
        }
      >
        <form
          className="flex flex-wrap items-end gap-2 border-b border-border py-3"
          onSubmit={(event) => void addOrigin(event)}
        >
          <label className="min-w-[220px] flex-1 text-xs text-muted-foreground">
            {t("browserSiteSettings.addSite")}
            <input
              type="url"
              value={origin}
              disabled={disabled}
              onChange={(event) => {
                setOrigin(event.target.value);
                setOriginError(false);
              }}
              placeholder={t("browserSiteSettings.originPlaceholder")}
              aria-label={t("browserSiteSettings.addSite")}
              className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            className={BROWSER_SETTINGS_BUTTON}
            disabled={disabled || !origin.trim()}
          >
            {t("browserSiteSettings.add")}
          </button>
        </form>
        {originError ? (
          <p role="alert" className="py-2 text-xs text-destructive">
            {t("browserSiteSettings.invalidOrigin")}
          </p>
        ) : null}
        {snapshot?.sites.length ? (
          snapshot.sites.map((site) => (
            <div
              key={site.origin}
              className="border-b border-border last:border-0"
            >
              <div className="flex min-h-14 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm" title={site.origin}>
                  {site.origin}
                </span>
                <button
                  type="button"
                  className={BROWSER_SETTINGS_BUTTON}
                  disabled={disabled}
                  onClick={() => void settings.remove(site.origin)}
                >
                  {t("browserSiteSettings.remove")}
                </button>
              </div>
              <div className="grid gap-x-6 sm:grid-cols-2">
                {permissions.map((permission) => (
                  <PermissionRow
                    key={permission}
                    id={`browser-site-${encodeURIComponent(site.origin)}-${permission}`}
                    label={t(permissionLabels[permission])}
                    choices={browserSitePermissionSettings(permission)}
                    value={site[permission] ?? "default"}
                    disabled={
                      disabled || !browserSitePermissionAvailable(permission)
                    }
                    unavailable={!browserSitePermissionAvailable(permission)}
                    inherited
                    onChange={(value) =>
                      void settings.save({
                        origin: site.origin,
                        permission,
                        setting: value === "default" ? null : value,
                      })
                    }
                    t={t}
                  />
                ))}
              </div>
            </div>
          ))
        ) : snapshot ? (
          <p className="py-5 text-sm text-muted-foreground">
            {t("browserSiteSettings.empty")}
          </p>
        ) : (
          <p className="py-5 text-sm text-muted-foreground" role="status">
            {t("browserSiteSettings.loading")}
          </p>
        )}
      </BrowserSettingsSection>
    </div>
  );
}

function PermissionRow({
  id,
  label,
  choices,
  value,
  disabled,
  unavailable = false,
  inherited = false,
  onChange,
  t,
}: {
  id: string;
  label: string;
  choices: readonly BrowserSitePermissionSetting[];
  value: BrowserSitePermissionSetting | "default";
  disabled: boolean;
  unavailable?: boolean;
  inherited?: boolean;
  onChange: (value: BrowserSitePermissionSetting | "default") => void;
  t: (key: string) => string;
}) {
  return (
    <BrowserSettingsRow
      id={id}
      label={label}
      description={
        unavailable
          ? t("browserSiteSettings.protectedContentUnavailable")
          : inherited && value === "default"
            ? t("browserSiteSettings.inherited")
            : undefined
      }
    >
      <select
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          if (!disabled)
            onChange(
              event.target.value as BrowserSitePermissionSetting | "default",
            );
        }}
        className="h-9 min-w-32 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {inherited ? (
          <option value="default">{t("browserSiteSettings.useDefault")}</option>
        ) : null}
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {t(`browserSiteSettings.choice.${choice}`)}
          </option>
        ))}
      </select>
    </BrowserSettingsRow>
  );
}
