import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkForUpdates,
  getUpdateInstallSession,
  isUpdateInstallSessionActive,
  listenUpdateInstallSession,
  startUpdateInstallSession,
  type UpdateInstallSession,
  type VersionInfo,
} from "@/lib/api/appUpdate";
import { LIME_BRAND_LOGO_SRC, LIME_BRAND_NAME } from "@/lib/branding";
import {
  interceptHttpExternalLinkClick,
  resolveHttpExternalHref,
} from "@/lib/markdown/externalLinks";
import { getRuntimeAppVersion } from "@/lib/appVersion";
import { cn } from "@/lib/utils";
import { PRODUCT_LINKS } from "@/lib/productLinks";
import { openPermissionsSetup } from "@/lib/permissionsSetup";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
} from "../../SettingsPrimitives";

function normalizeAboutVersion(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }
  return trimmed;
}

export function AboutSection() {
  const { t } = useTranslation("settings");
  const runtimeAppVersion = useMemo(
    () => normalizeAboutVersion(getRuntimeAppVersion()),
    [],
  );
  const [versionInfo, setVersionInfo] = useState<VersionInfo>({
    current: runtimeAppVersion ?? "",
    latest: undefined,
    hasUpdate: false,
    downloadUrl: undefined,
    error: undefined,
  });
  const [checking, setChecking] = useState(false);
  const [installSession, setInstallSession] =
    useState<UpdateInstallSession | null>(null);
  const [installStartFailed, setInstallStartFailed] = useState(false);
  const manualDownloadUrl =
    versionInfo.releaseNotesUrl || PRODUCT_LINKS.releases;
  const manualDownloadRel = resolveHttpExternalHref(manualDownloadUrl)
    ? "noreferrer noopener"
    : undefined;
  const isWindows =
    typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");
  const installingUpdate = isUpdateInstallSessionActive(installSession);
  const rawInstallProgressPercent = installSession?.percent ?? 0;
  const installProgressPercent = Number.isFinite(rawInstallProgressPercent)
    ? Math.min(100, Math.max(0, Math.round(rawInstallProgressPercent * 100)))
    : 0;
  const hasInstallProgress =
    installSession !== null && installSession.stage !== "idle";
  const installFailed =
    installStartFailed || installSession?.stage === "failed";
  const confirmedSessionUpdate = Boolean(
    installSession?.stage === "completed" && installSession.latestVersion,
  );
  const updateAvailable = versionInfo.hasUpdate || confirmedSessionUpdate;
  const latestAvailableVersion = confirmedSessionUpdate
    ? installSession?.latestVersion
    : versionInfo.latest;
  const installStatusLabel = useMemo(() => {
    if (!installSession) {
      return "";
    }

    switch (installSession.stage) {
      case "checking":
        return t("settings.about.update.progress.checking");
      case "downloading":
        return installSession.totalBytes
          ? t("settings.about.update.progress.downloading", {
              percent: `${installProgressPercent}%`,
            })
          : t("settings.about.update.progress.downloadingUnknown");
      case "installing":
        return t("settings.about.update.progress.installing");
      case "restarting":
        return t("settings.about.update.progress.restarting");
      case "failed":
        return t("settings.about.update.progress.failed");
      case "up_to_date":
        return t("settings.about.update.progress.upToDate");
      case "completed":
        return t("settings.about.update.progress.completed");
      case "idle":
      default:
        return "";
    }
  }, [installProgressPercent, installSession, t]);
  const installActionLabel = useMemo(() => {
    if (!installSession) {
      return versionInfo.hasUpdate
        ? t("settings.about.action.restartToUpdate")
        : t("settings.about.action.download");
    }

    switch (installSession.stage) {
      case "checking":
        return t("settings.about.update.progress.checking");
      case "downloading":
        return t("settings.about.action.downloading");
      case "installing":
        return t("settings.about.action.installing");
      case "restarting":
        return t("settings.about.action.restarting");
      case "failed":
        return t("settings.about.action.retryDownload");
      case "completed":
        return t("settings.about.action.restartToUpdate");
      default:
        return t("settings.about.action.download");
    }
  }, [installSession, t, versionInfo.hasUpdate]);

  useEffect(() => {
    const loadCurrentVersion = async () => {
      try {
        const result = await checkForUpdates({ automatic: true });
        setVersionInfo({
          ...result,
          current:
            normalizeAboutVersion(result.current) ?? runtimeAppVersion ?? "",
          downloadUrl: result.downloadUrl || PRODUCT_LINKS.releases,
        });
      } catch (error) {
        console.error("Failed to load version:", error);
        setVersionInfo((prev) => ({
          ...prev,
          current:
            normalizeAboutVersion(prev.current) ?? runtimeAppVersion ?? "",
          error: t("settings.about.update.errorCheck"),
          downloadUrl: prev.downloadUrl || PRODUCT_LINKS.releases,
        }));
      }
    };

    void loadCurrentVersion();
  }, [runtimeAppVersion, t]);

  useEffect(() => {
    let disposed = false;
    void getUpdateInstallSession()
      .then((session) => {
        if (!disposed && session.stage !== "idle") {
          setInstallSession(session);
        }
      })
      .catch((error) => {
        console.error("Failed to read update install session:", error);
      });

    const unlistenPromise = listenUpdateInstallSession((session) => {
      setInstallSession(session);
      setInstallStartFailed(false);
    });

    return () => {
      disposed = true;
      void unlistenPromise
        .then((unlisten) => unlisten())
        .catch((error) => {
          console.error("Failed to remove update install listener:", error);
        });
    };
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setInstallStartFailed(false);
    try {
      const result = await checkForUpdates();
      setVersionInfo({
        ...result,
        current:
          normalizeAboutVersion(result.current) ?? runtimeAppVersion ?? "",
        downloadUrl: result.downloadUrl || PRODUCT_LINKS.releases,
      });
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo((prev) => ({
        ...prev,
        current: normalizeAboutVersion(prev.current) ?? runtimeAppVersion ?? "",
        error: t("settings.about.update.errorCheck"),
        downloadUrl: prev.downloadUrl || PRODUCT_LINKS.releases,
      }));
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setInstallStartFailed(false);
    try {
      const session = await startUpdateInstallSession();
      setInstallSession(session);
    } catch (error) {
      console.error("Failed to start update install session:", error);
      setInstallStartFailed(true);
    }
  };

  const currentVersion =
    normalizeAboutVersion(versionInfo.current) ??
    normalizeAboutVersion(installSession?.currentVersion) ??
    runtimeAppVersion;
  const versionLabel = currentVersion
    ? t("settings.about.version.label", {
        version: currentVersion,
        build: currentVersion,
      })
    : t("settings.about.version.loadingLabel", {
        loading: t("settings.about.version.loading"),
        defaultValue: "Version {{loading}}",
      });

  const updateStatus = useMemo(() => {
    if (installingUpdate) {
      return {
        label:
          installStatusLabel || t("settings.about.update.progress.checking"),
      };
    }

    if (installFailed) {
      return {
        label: t("settings.about.update.progress.failed"),
      };
    }

    if (updateAvailable) {
      return {
        label: t("settings.about.status.updateAvailable", {
          version: latestAvailableVersion ?? "",
        }),
      };
    }

    if (versionInfo.error) {
      return {
        label: t("settings.about.update.errorCheck"),
      };
    }

    if (versionInfo.latest) {
      return {
        label: t("settings.about.status.latest"),
      };
    }

    return {
      label: t("settings.about.status.manualCheck"),
    };
  }, [
    installFailed,
    installStatusLabel,
    installingUpdate,
    latestAvailableVersion,
    t,
    updateAvailable,
    versionInfo.error,
    versionInfo.latest,
  ]);

  return (
    <SettingsPageBody data-testid="settings-about-page">
      <SettingsPageHeader title={t("settings.tab.about")} />
      <section aria-labelledby="settings-about-brand" className="space-y-6">
        <div className="flex min-w-0 items-center gap-4">
          <img
            src={LIME_BRAND_LOGO_SRC}
            alt={LIME_BRAND_NAME}
            className="size-12 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h2
              id="settings-about-brand"
              className="text-[16px] font-medium leading-6"
            >
              {LIME_BRAND_NAME}
            </h2>
            <p
              data-testid="settings-about-version"
              className="text-[13px] leading-5"
            >
              {versionLabel}
            </p>
            <p className="mt-1 text-[12px] leading-4 text-muted-foreground">
              {t("settings.about.copyright", { brand: LIME_BRAND_NAME })}
            </p>
          </div>
        </div>
        <SettingsGroup>
          <SettingsRow
            label={
              <span
                role="status"
                aria-live="polite"
                className={cn(
                  "break-words",
                  (installFailed || versionInfo.error) &&
                    "text-[color:var(--lime-danger,hsl(var(--destructive)))]",
                )}
              >
                {updateStatus.label}
              </span>
            }
          >
            <SettingsAction
              type="button"
              onClick={() => void handleCheckUpdate()}
              disabled={checking || installingUpdate}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn("size-3.5", checking && "animate-spin")}
              />
              {t("settings.about.action.check")}
            </SettingsAction>
          </SettingsRow>
          {updateAvailable ? (
            <div className="flex flex-wrap items-center gap-2 py-3">
              <SettingsAction
                type="button"
                onClick={() => void handleDownloadUpdate()}
                disabled={installingUpdate}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn("size-3.5", installingUpdate && "animate-spin")}
                />
                {installActionLabel}
              </SettingsAction>
              <SettingsAction
                as="a"
                href={manualDownloadUrl}
                rel={manualDownloadRel}
                onAuxClick={(event) => {
                  interceptHttpExternalLinkClick(event, manualDownloadUrl);
                }}
                onClick={(event) => {
                  interceptHttpExternalLinkClick(event, manualDownloadUrl);
                }}
              >
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t("settings.about.action.webDownload")}
              </SettingsAction>
            </div>
          ) : null}
          <SettingsRow
            label={t("settings.permissionsSetup.title")}
            targetId="about-permissions-setup"
          >
            <SettingsAction type="button" onClick={openPermissionsSetup}>
              {t("settings.permissionsSetup.openGuide")}
            </SettingsAction>
          </SettingsRow>
        </SettingsGroup>
        {isWindows ? (
          <p className="text-[12px] leading-4 text-muted-foreground">
            {t("settings.about.windowsSetupNotice")}
          </p>
        ) : null}
        {hasInstallProgress || installFailed ? (
          <div
            role={installFailed ? "alert" : "status"}
            className={cn(
              "flex min-w-0 items-start gap-2 text-[13px] leading-5",
              installFailed
                ? "text-[color:var(--lime-danger,hsl(var(--destructive)))]"
                : "text-muted-foreground",
            )}
          >
            <CheckCircle2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p>
                {installFailed
                  ? t("settings.about.update.errorDownload")
                  : installStatusLabel ||
                    t("settings.about.update.progress.checking")}
              </p>
              {!installFailed &&
              (installSession?.stage === "downloading" ||
                installSession?.stage === "installing" ||
                installSession?.stage === "restarting") ? (
                <div className="mt-2 flex items-center gap-3">
                  <div
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={installStatusLabel}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={
                      installSession?.totalBytes
                        ? installProgressPercent
                        : undefined
                    }
                  >
                    <div
                      className={cn(
                        "h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none",
                        !installSession?.totalBytes &&
                          "motion-safe:animate-pulse",
                      )}
                      style={{
                        width: installSession?.totalBytes
                          ? `${installProgressPercent}%`
                          : "100%",
                      }}
                    />
                  </div>
                  {installSession?.totalBytes ? (
                    <span className="shrink-0 text-[12px] tabular-nums">
                      {installProgressPercent}%
                    </span>
                  ) : null}
                </div>
              ) : null}
              {installFailed ? (
                <a
                  href={manualDownloadUrl}
                  rel={manualDownloadRel}
                  onAuxClick={(event) => {
                    interceptHttpExternalLinkClick(event, manualDownloadUrl);
                  }}
                  onClick={(event) => {
                    interceptHttpExternalLinkClick(event, manualDownloadUrl);
                  }}
                  className="mt-2 inline-flex items-center gap-1 rounded-sm underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ExternalLink aria-hidden="true" className="size-3" />
                  {t("settings.about.action.openWebDownload")}
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
    </SettingsPageBody>
  );
}
