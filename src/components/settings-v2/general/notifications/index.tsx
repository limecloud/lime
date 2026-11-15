import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  openDesktopPermissionSettings,
  readDesktopPermissions,
  type DesktopPermissionState,
} from "@/lib/api/desktopPermissions";
import {
  NOTIFICATION_SOUNDS,
  setNotificationPreferences,
  useNotificationPreferences,
  type NotificationSoundChoice,
} from "@/lib/notificationPreferences";
import {
  clearCustomNotificationSound,
  importCustomNotificationSound,
  playCustomNotificationSound,
  readCustomNotificationSound,
  type CustomNotificationSound,
} from "@/lib/notificationSound";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSwitch,
  SettingsValueMenu,
} from "../../SettingsPrimitives";

export function NotificationsSettings() {
  const { t } = useTranslation("settings");
  const notifications = useNotificationPreferences();
  const [permission, setPermission] = useState<DesktopPermissionState | null>(
    null,
  );
  const [customSound, setCustomSound] =
    useState<CustomNotificationSound | null>(readCustomNotificationSound);
  const [soundError, setSoundError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readDesktopPermissions()
      .then((snapshot) => {
        if (!active) return;
        setPermission(
          snapshot.permissions.find((item) => item.id === "notifications")
            ?.state ?? null,
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const notificationsOff =
    permission === "denied" ||
    permission === "notDetermined" ||
    permission === "restricted";

  const changeSound = async (value: string) => {
    setSoundError(null);
    if (value === "custom-preview") {
      playCustomNotificationSound();
      return;
    }
    if (value === "custom-remove") {
      clearCustomNotificationSound();
      setCustomSound(null);
      setNotificationPreferences({ sound: "default" });
      return;
    }
    if (value === "custom" && customSound) {
      setNotificationPreferences({ sound: "custom" });
      return;
    }
    if (value === "custom" || value === "custom-import") {
      try {
        const imported = await importCustomNotificationSound({
          title: t("settings.notifications.soundChooseTitle"),
        });
        if (!imported) return;
        setCustomSound(imported);
        setNotificationPreferences({ sound: "custom" });
      } catch {
        setSoundError(t("settings.notifications.soundImportFailed"));
      }
      return;
    }
    setNotificationPreferences({ sound: value as NotificationSoundChoice });
  };

  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.notifications.title")} />
      <SettingsGroup>
        <SettingsRow
          label={
            notificationsOff
              ? t("settings.notifications.disabled")
              : t("settings.notifications.system")
          }
          description={t("settings.notifications.systemDescription")}
          targetId="general-system-notifications"
        >
          <SettingsAction
            type="button"
            onClick={() => void openDesktopPermissionSettings("notifications")}
          >
            {t("settings.notifications.openSystemSettings")}
          </SettingsAction>
        </SettingsRow>
        <SettingsRow
          label={t("settings.notifications.turnComplete")}
          description={t("settings.notifications.turnCompleteDescription")}
          targetId="general-turn-notifications"
        >
          <SettingsValueMenu
            targetId="general-turn-notifications"
            described
            value={notifications.turnComplete}
            disabled={notificationsOff}
            options={(["unfocused", "always", "never"] as const).map(
              (value) => ({
                value,
                label: t(`settings.notifications.turnComplete.${value}`),
              }),
            )}
            onChange={(value) =>
              setNotificationPreferences({ turnComplete: value })
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.notifications.permissions")}
          description={t("settings.notifications.permissionsDescription")}
          targetId="general-permission-notifications"
        >
          <SettingsSwitch
            aria-labelledby="general-permission-notifications-label"
            aria-describedby="general-permission-notifications-description"
            checked={notifications.permissions}
            disabled={notificationsOff}
            onCheckedChange={(permissions) =>
              setNotificationPreferences({ permissions })
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.notifications.questions")}
          description={t("settings.notifications.questionsDescription")}
          targetId="general-question-notifications"
        >
          <SettingsSwitch
            aria-labelledby="general-question-notifications-label"
            aria-describedby="general-question-notifications-description"
            checked={notifications.questions}
            disabled={notificationsOff}
            onCheckedChange={(questions) =>
              setNotificationPreferences({ questions })
            }
          />
        </SettingsRow>
        <SettingsRow
          label={t("settings.notifications.sound")}
          description={t("settings.notifications.soundDescription")}
          targetId="general-notification-sound"
        >
          <div className="flex min-w-0 flex-col items-end gap-1">
            <SettingsValueMenu
              targetId="general-notification-sound"
              described
              value={notifications.sound}
              disabled={notificationsOff}
              options={[
                ...NOTIFICATION_SOUNDS.map((sound) => ({
                  value: sound,
                  label:
                    sound === "default"
                      ? t("settings.notifications.soundDefault")
                      : sound === "none"
                        ? t("settings.notifications.soundNone")
                        : sound === "classic"
                          ? t("settings.notifications.soundClassic")
                          : sound,
                })),
                ...(customSound
                  ? [
                      { value: "custom" as const, label: customSound.name },
                      {
                        value: "custom-preview" as const,
                        label: t("settings.notifications.soundPreview"),
                      },
                      {
                        value: "custom-import" as const,
                        label: t("settings.notifications.soundCustomReplace"),
                      },
                      {
                        value: "custom-remove" as const,
                        label: t("settings.notifications.soundRemove"),
                      },
                    ]
                  : [
                      {
                        value: "custom" as const,
                        label: t("settings.notifications.soundCustom"),
                      },
                    ]),
              ]}
              onChange={(value) => void changeSound(value)}
            />
            {soundError ? (
              <span role="alert" className="text-[11px] text-destructive">
                {soundError}
              </span>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPageBody>
  );
}
