import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsGroup,
  SettingsLoading,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsSection,
} from "../../SettingsPrimitives";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { VoiceModelSection } from "./VoiceModelSection";
import { VoiceProcessingSettings } from "./VoiceProcessingSettings";
import { VoiceServiceSettings } from "./VoiceServiceSettings";
import { useVoiceSettings } from "./useVoiceSettings";

export function VoiceSettings() {
  const { t } = useTranslation("settings");
  const settings = useVoiceSettings();
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  const refreshCapability = useCallback(
    () => setCapabilityRevision((revision) => revision + 1),
    [],
  );
  if (settings.loading) return <SettingsLoading />;
  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.voice.page.title")} />
      {settings.loadError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-4 text-[13px]"
        >
          {t("settings.voice.message.loadFailed")}
          <SettingsAction type="button" onClick={() => void settings.reload()}>
            {t("settings.voice.page.retry")}
          </SettingsAction>
        </div>
      ) : (
        <>
          <SettingsSection title={t("settings.voice.page.general")}>
            <SettingsGroup>
              <MicrophoneSettings
                value={settings.voiceConfig?.selected_device_id}
                disabled={!settings.voiceConfig || settings.saving}
                onChange={settings.handleMicrophoneChange}
              />
            </SettingsGroup>
          </SettingsSection>
          <VoiceProcessingSettings
            settings={settings}
            capabilityRevision={capabilityRevision}
          />
          <VoiceModelSection
            showMessage={settings.showMessage}
            onCapabilityChange={refreshCapability}
          />
          <VoiceServiceSettings settings={settings} />
        </>
      )}
      {settings.message ? (
        <p
          role={settings.message.type === "error" ? "alert" : "status"}
          className={
            settings.message.type === "error"
              ? "text-[13px] text-destructive"
              : "text-[13px] text-muted-foreground"
          }
        >
          {settings.message.text}
        </p>
      ) : null}
    </SettingsPageBody>
  );
}
