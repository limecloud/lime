import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsRow,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import { useMicrophoneDevices } from "./useMicrophoneDevices";

export function MicrophoneSettings({
  value,
  disabled,
  onChange,
}: {
  value?: string;
  disabled: boolean;
  onChange: (deviceId: string) => void;
}) {
  const { t } = useTranslation("settings");
  const { devices, supported, loading, error, refresh } =
    useMicrophoneDevices();
  const options = [
    { value: "", label: t("settings.voice.microphone.systemDefault") },
    ...devices.map((device, index) => ({
      value: device.deviceId,
      label:
        device.label ||
        t("settings.voice.microphone.fallbackLabel", { index: index + 1 }),
    })),
  ];
  const unavailable = Boolean(
    value && !devices.some((device) => device.deviceId === value),
  );
  if (unavailable)
    options.push({
      value: value!,
      label: t(
        loading || error
          ? "settings.voice.microphone.selected"
          : "settings.voice.microphone.unavailable",
      ),
    });
  const status = !supported
    ? t("settings.voice.microphone.unsupported")
    : loading
      ? t("settings.voice.microphone.loading")
      : error === "permission"
        ? t("settings.voice.microphone.permissionError")
        : error
          ? t("settings.voice.microphone.loadError")
          : unavailable
            ? t("settings.voice.microphone.unavailable")
            : devices.length === 0
              ? t("settings.voice.microphone.empty")
              : null;
  return (
    <SettingsRow
      targetId="voice-microphone"
      label={t("settings.voice.microphone.label")}
      description={
        <>
          {t("settings.voice.microphone.description")}
          {status ? (
            <div role={error ? "alert" : "status"}>{status}</div>
          ) : null}
        </>
      }
    >
      <SettingsValueMenu
        targetId="voice-microphone"
        described
        value={value ?? ""}
        options={options}
        disabled={disabled || !supported || loading}
        onChange={onChange}
      />
      <SettingsAction
        type="button"
        aria-label={t("settings.voice.microphone.refresh")}
        title={t("settings.voice.microphone.refresh")}
        disabled={disabled || !supported || loading}
        onClick={() => void refresh()}
      >
        <RefreshCw aria-hidden="true" />
      </SettingsAction>
    </SettingsRow>
  );
}
