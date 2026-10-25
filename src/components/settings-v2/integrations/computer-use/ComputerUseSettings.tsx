import { FileSpreadsheet, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import type { ComputerUseAdapterKind } from "@limecloud/app-server-client";
import { LIME_BRAND_LOGO_SRC } from "@/lib/branding";
import {
  SettingsAction,
  SettingsEmptyState,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import {
  ComputerUseAdapterDialog,
  RemoveAllowedApp,
} from "./ComputerUseDialogs";
import { useComputerUseSettings } from "./useComputerUseSettings";

const Page = styled(SettingsPageBody)`
  width: 100%;
  max-width: 640px;
  margin-inline: auto;
  gap: 32px;
  header h1 {
    font-size: 24px;
    font-weight: 600;
  }
`;
const ControlRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 66px;
  padding-block: 12px;
  border-bottom: 1px solid var(--lime-surface-border, hsl(var(--border)));
  &:last-child {
    border-bottom: 0;
  }
  &:focus {
    outline-offset: 3px;
  }
  .computer-use-copy {
    flex: 1;
    min-width: min(100%, 180px);
  }
  .computer-use-label {
    font-size: 13px;
    font-weight: 500;
  }
  .computer-use-description {
    margin-top: 2px;
    color: var(--lime-text-muted, hsl(var(--muted-foreground)));
    font-size: 12px;
    line-height: 17px;
    overflow-wrap: anywhere;
  }
  .computer-use-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
`;

function ControlIcon({ adapter }: { adapter: ComputerUseAdapterKind }) {
  if (adapter === "native")
    return (
      <img
        src={LIME_BRAND_LOGO_SRC}
        alt=""
        className="size-9 shrink-0 rounded-lg"
      />
    );
  if (adapter === "office")
    return (
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600"
      >
        <FileSpreadsheet className="size-7" />
      </span>
    );
  return (
    <svg aria-hidden="true" viewBox="0 0 36 36" className="size-9 shrink-0">
      <path
        fill="#ea4335"
        d="M18 2a16 16 0 0 1 13.86 8H18a8 8 0 0 0-6.93 4L6.45 6.5A15.94 15.94 0 0 1 18 2"
      />
      <path
        fill="#fbbc05"
        d="M31.86 10A16 16 0 0 1 18 34l6.93-12A8 8 0 0 0 18 10Z"
      />
      <path
        fill="#34a853"
        d="M18 34A16 16 0 0 1 6.45 6.5L11.07 14A8 8 0 0 0 24.93 22Z"
      />
      <circle
        cx="18"
        cy="18"
        r="7"
        fill="#4285f4"
        stroke="white"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function ComputerUseSettings() {
  const { t } = useTranslation("settings");
  const settings = useComputerUseSettings();
  const { snapshot, error, pending } = settings;
  const unavailable = !snapshot || error === "load" || error === "reload";
  const nativeStatus = snapshot?.status.adapters.find(
    (entry) => entry.adapter === "native",
  );
  const broadApproval =
    snapshot?.allowedApps.some((app) => app.field === "default") ?? false;
  const rows = [
    { adapter: "native", label: "anyApp", description: "anyAppDescription" },
    { adapter: "chrome", label: "chrome", description: "chromeDescription" },
    { adapter: "office", label: "wps", description: "wpsDescription" },
  ] as const;
  return (
    <Page data-testid="computer-use-settings" aria-busy={!snapshot && !error}>
      <div>
        <SettingsPageHeader title={t("settings.computerUse.title")} />
        <p className="mt-2 text-[13px] text-muted-foreground">
          {t("settings.computerUse.description")}
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-destructive"
        >
          <span>
            {t(
              `settings.computerUse.${error === "load" ? "loadError" : error === "reload" ? "reloadError" : error === "setup" ? "setupError" : "saveError"}`,
            )}
          </span>
          <SettingsAction
            disabled={pending}
            onClick={() => void settings.refresh()}
          >
            {t("settings.computerUse.retry")}
          </SettingsAction>
        </div>
      )}
      <SettingsSection title={t("settings.computerUse.control")}>
        <SettingsGroup>
          {rows.map((row) => {
            const status = snapshot?.status.adapters.find(
              (entry) => entry.adapter === row.adapter,
            );
            const label = t(`settings.computerUse.${row.label}`);
            const description = t(`settings.computerUse.${row.description}`);
            const id = `computer-use-${row.adapter}`;
            return (
              <ControlRow
                key={row.adapter}
                id={id}
                tabIndex={-1}
                data-settings-search-target={id}
              >
                <ControlIcon adapter={row.adapter} />
                <div className="computer-use-copy">
                  <div id={`${id}-label`} className="computer-use-label">
                    {label}
                  </div>
                  <div
                    id={`${id}-description`}
                    className="computer-use-description"
                  >
                    <div>{description}</div>
                    {snapshot && (
                      <div
                        className="mt-0.5 flex items-center gap-1.5"
                        role="status"
                      >
                        {status?.readiness === "ready" && (
                          <span
                            aria-hidden="true"
                            className="size-1.5 rounded-full bg-emerald-500"
                          />
                        )}
                        {t(
                          `settings.computerUse.status.${status?.readiness ?? "unavailable"}`,
                        )}
                      </div>
                    )}
                    {snapshot?.managed[row.adapter] && (
                      <div>{t("settings.computerUse.managed")}</div>
                    )}
                  </div>
                </div>
                <div className="computer-use-actions">
                  {row.adapter === "native" &&
                    nativeStatus?.readiness === "permission_required" && (
                      <SettingsAction
                        disabled={
                          pending ||
                          unavailable ||
                          snapshot?.managed.native ||
                          !snapshot?.enabled.native
                        }
                        onClick={() => void settings.setup("native")}
                      >
                        {t("settings.computerUse.setup")}
                      </SettingsAction>
                    )}
                  <ComputerUseAdapterDialog
                    title={label}
                    description={description}
                    status={status}
                    pending={pending || unavailable}
                    onRefresh={settings.refresh}
                    onSetup={(target) => settings.setup(row.adapter, target)}
                    enabled={
                      snapshot?.enabled[row.adapter] === true &&
                      !snapshot?.managed[row.adapter]
                    }
                  />
                  <SettingsSwitch
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-description`}
                    checked={snapshot?.enabled[row.adapter] ?? false}
                    disabled={
                      unavailable || pending || snapshot?.managed[row.adapter]
                    }
                    onCheckedChange={(value) => {
                      void settings.toggle(row.adapter, value);
                    }}
                  />
                </div>
              </ControlRow>
            );
          })}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        id="computer-use-allowed-apps"
        tabIndex={-1}
        data-settings-search-target="computer-use-allowed-apps"
        title={t("settings.computerUse.allowedApps")}
      >
        <SettingsGroup>
          {!snapshot ? (
            <SettingsEmptyState role="status">
              {t(`settings.computerUse.${error ? "loadError" : "loading"}`)}
            </SettingsEmptyState>
          ) : snapshot.allowedApps.length === 0 ? (
            <SettingsEmptyState>
              {t("settings.computerUse.empty")}
            </SettingsEmptyState>
          ) : (
            snapshot.allowedApps.map((app) => (
              <ControlRow key={app.id}>
                <Monitor
                  aria-hidden="true"
                  className="size-7 shrink-0 text-muted-foreground"
                />
                <div className="computer-use-copy">
                  <div className="computer-use-label break-all">
                    {app.field === "default"
                      ? t("settings.computerUse.allApps")
                      : app.name}
                  </div>
                  <div className="computer-use-description">
                    {app.managed
                      ? t("settings.computerUse.managed")
                      : broadApproval && app.field !== "default"
                        ? t("settings.computerUse.removeDefaultFirst")
                        : app.platform === "macos"
                          ? "macOS"
                          : app.platform === "windows"
                            ? "Windows"
                            : t("settings.computerUse.allPlatforms")}
                  </div>
                </div>
                <RemoveAllowedApp
                  app={app}
                  disabled={
                    pending ||
                    unavailable ||
                    app.managed ||
                    (broadApproval && app.field !== "default")
                  }
                  onRemove={() => settings.remove(app)}
                />
              </ControlRow>
            ))
          )}
        </SettingsGroup>
      </SettingsSection>
    </Page>
  );
}
