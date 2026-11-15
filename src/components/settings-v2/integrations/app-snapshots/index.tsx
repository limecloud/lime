import { useTranslation } from "react-i18next";
import {
  setAppSnapshotPreferences,
  useAppSnapshotPreferences,
} from "@/lib/appSnapshotPreferences";
import { PreferenceMenu } from "@/components/settings-v2/general/browser/PreferenceMenu";
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "../../SettingsPrimitives";

export function AppSnapshotsSettings() {
  const { t } = useTranslation("settings");
  const snapshotPreferences = useAppSnapshotPreferences();

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
              {t("settings.appSnapshots.shortcutKeys")}
            </span>
          </SettingsRow>
          <SettingsRow
            targetId="app-snapshots-hotkey"
            label={t("settings.appSnapshots.hotkey")}
            description={t("settings.appSnapshots.hotkeyDescription")}
          >
            <SettingsSwitch
              checked={snapshotPreferences.hotkeyEnabled}
              onCheckedChange={(hotkeyEnabled) =>
                setAppSnapshotPreferences({ hotkeyEnabled })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title={t("settings.appSnapshots.target")}>
        <SettingsGroup>
          <PreferenceMenu
            targetId="app-snapshots-target"
            label={t("settings.appSnapshots.targetLabel")}
            description={t("settings.appSnapshots.targetDescription")}
            value={snapshotPreferences.destination}
            options={(["automatic", "lastChat", "newChat"] as const).map(
              (value) => ({
                value,
                label: t(`settings.appSnapshots.destination.${value}`),
                description: t(
                  `settings.appSnapshots.destination.${value}Description`,
                ),
              }),
            )}
            disabled={false}
            onChange={(destination) =>
              setAppSnapshotPreferences({ destination })
            }
          />
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
              checked={snapshotPreferences.soundEnabled}
              onCheckedChange={(soundEnabled) =>
                setAppSnapshotPreferences({ soundEnabled })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
