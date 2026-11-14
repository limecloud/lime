import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import {
  openDesktopPermissionSettings,
  readDesktopPermissions,
  requestDesktopPermission,
  type DesktopPermissionState,
} from "@/lib/api/desktopPermissions";
import {
  listAppSnapshotWindows,
  type AppSnapshotWindow,
} from "@/lib/api/appSnapshots";
import { setPendingAppSnapshot } from "@/lib/pendingAppSnapshot";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import {
  SettingsAction,
  SettingsGroup,
  SettingsLoading,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";
import {
  setAppSnapshotPreferences,
  useAppSnapshotPreferences,
} from "@/lib/appSnapshotPreferences";

export function AppSnapshotsSettings() {
  const { t } = useTranslation("settings");
  const navigate = useAppNavigationRequest();
  const snapshotPreferences = useAppSnapshotPreferences();
  const [state, setState] = useState<DesktopPermissionState | null>(null);
  const [accessibility, setAccessibility] =
    useState<DesktopPermissionState | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [windows, setWindows] = useState<AppSnapshotWindow[] | null>(null);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [copiedWindow, setCopiedWindow] = useState<string | null>(null);

  const addWindowToChat = (window: AppSnapshotWindow) => {
    if (!navigate) return;
    if (
      !setPendingAppSnapshot({
        dataUrl: window.thumbnail,
        windowName: window.name,
      })
    ) {
      return;
    }
    navigate("agent", buildHomeAgentParams());
    toast.success(t("settings.appSnapshots.addToChatQueued"));
  };

  const load = async () => {
    setError(false);
    try {
      const snapshot = await readDesktopPermissions();
      setState(
        snapshot.permissions.find(
          (permission) => permission.id === "screenCapture",
        )?.state ?? "unavailable",
      );
      setAccessibility(
        snapshot.permissions.find(
          (permission) => permission.id === "accessibility",
        )?.state ?? "unavailable",
      );
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if ((state === null || accessibility === null) && !error) {
    return <SettingsLoading />;
  }

  const status = state ?? "unknown";
  return (
    <SettingsPageBody>
      <div className="flex flex-col gap-2">
        <SettingsPageHeader title={t("settings.appSnapshots.title")} />
        <p className="text-[13px] text-muted-foreground">
          {t("settings.appSnapshots.description")}
        </p>
      </div>
      <SettingsSection title={t("settings.appSnapshots.shortcut")}>
        <SettingsGroup>
          <SettingsRow
            targetId="app-snapshots-shortcut"
            label={t("settings.appSnapshots.shortcutLabel")}
            description={t("settings.appSnapshots.shortcutDescription")}
          >
            <span className="rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground">
              ⌘ + ⌘
            </span>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.appSnapshots.target")}>
        <SettingsGroup>
          <SettingsRow
            targetId="app-snapshots-target"
            label={t("settings.appSnapshots.targetLabel")}
            description={t("settings.appSnapshots.targetDescription")}
          >
            <span className="text-[12px] text-muted-foreground">
              {t("settings.appSnapshots.targetLabel")}
            </span>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.appSnapshots.sound")}>
        <SettingsGroup>
          <SettingsRow
            targetId="app-snapshots-sound"
            label={t("settings.appSnapshots.sound")}
            description={t("settings.appSnapshots.soundDescription")}
          >
            <SettingsSwitch
              aria-labelledby="app-snapshots-sound-label"
              aria-describedby="app-snapshots-sound-description"
              checked={snapshotPreferences.soundEnabled}
              onCheckedChange={(soundEnabled) =>
                setAppSnapshotPreferences({ soundEnabled })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.appSnapshots.permission")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.appSnapshots.screenCapture")}
            description={t("settings.appSnapshots.screenCaptureDescription")}
            targetId="app-snapshots-screen-capture"
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">
                {t(`settings.appSnapshots.state.${status}`)}
              </span>
              {status === "granted" ? null : (
                <SettingsAction
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      if (status === "notDetermined") {
                        const snapshot =
                          await requestDesktopPermission("screenCapture");
                        setState(
                          snapshot.permissions.find(
                            (permission) => permission.id === "screenCapture",
                          )?.state ?? "unavailable",
                        );
                      } else {
                        await openDesktopPermissionSettings("screenCapture");
                      }
                    } catch {
                      setError(true);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {status === "notDetermined"
                    ? t("settings.appSnapshots.request")
                    : t("settings.appSnapshots.openSettings")}
                </SettingsAction>
              )}
            </div>
          </SettingsRow>
          <SettingsRow
            label={t("settings.appSnapshots.accessibility")}
            description={t("settings.appSnapshots.accessibilityDescription")}
            targetId="app-snapshots-accessibility"
          >
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">
                {t(`settings.appSnapshots.state.${accessibility ?? "unknown"}`)}
              </span>
              {accessibility === "granted" ? null : (
                <SettingsAction
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      if (accessibility === "notDetermined") {
                        const snapshot =
                          await requestDesktopPermission("accessibility");
                        setAccessibility(
                          snapshot.permissions.find(
                            (permission) => permission.id === "accessibility",
                          )?.state ?? "unavailable",
                        );
                      } else {
                        await openDesktopPermissionSettings("accessibility");
                      }
                    } catch {
                      setError(true);
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {accessibility === "notDetermined"
                    ? t("settings.appSnapshots.request")
                    : t("settings.appSnapshots.openSettings")}
                </SettingsAction>
              )}
            </div>
          </SettingsRow>
        </SettingsGroup>
        {error ? (
          <div
            role="alert"
            className="flex items-center gap-3 text-[12px] text-destructive"
          >
            {t("settings.appSnapshots.loadFailed")}
            <SettingsAction type="button" onClick={() => void load()}>
              {t("settings.appSnapshots.retry")}
            </SettingsAction>
          </div>
        ) : null}
      </SettingsSection>
      <SettingsSection title={t("settings.appSnapshots.windows")}>
        <div className="flex flex-col gap-3">
          <SettingsAction
            type="button"
            disabled={loadingWindows}
            onClick={async () => {
              setLoadingWindows(true);
              try {
                setWindows(await listAppSnapshotWindows());
              } catch {
                setError(true);
              } finally {
                setLoadingWindows(false);
              }
            }}
          >
            {loadingWindows
              ? t("settings.appSnapshots.loadingWindows")
              : t("settings.appSnapshots.refreshWindows")}
          </SettingsAction>
          {windows?.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              {t("settings.appSnapshots.noWindows")}
            </p>
          ) : null}
          {windows && windows.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {windows.map((window) => (
                <figure
                  key={window.id}
                  className="overflow-hidden rounded-xl border border-border bg-muted/20"
                >
                  <img
                    src={window.thumbnail}
                    alt={window.name}
                    className="aspect-video w-full object-cover"
                  />
                  <figcaption className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-muted-foreground">
                    <span className="truncate">{window.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-40"
                        disabled={!navigate}
                        onClick={() => addWindowToChat(window)}
                      >
                        {t("settings.appSnapshots.addToChat")}
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 hover:bg-muted"
                        onClick={async () => {
                          try {
                            const response = await fetch(window.thumbnail);
                            const blob = await response.blob();
                            await navigator.clipboard.write([
                              new ClipboardItem({ [blob.type]: blob }),
                            ]);
                            setCopiedWindow(window.id);
                            globalThis.setTimeout(
                              () => setCopiedWindow(null),
                              1500,
                            );
                          } catch {
                            setError(true);
                          }
                        }}
                      >
                        {copiedWindow === window.id
                          ? t("settings.appSnapshots.copied")
                          : t("settings.appSnapshots.copy")}
                      </button>
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </SettingsPageBody>
  );
}
