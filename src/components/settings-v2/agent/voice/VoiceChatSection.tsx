import { useTranslation } from "react-i18next";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";
import { useRealtimeVoiceCapability } from "./useRealtimeVoiceCapability";

const BLOCKER_KEYS = {
  providerRealtimeUnsupported:
    "settings.voice.chat.blocker.providerRealtimeUnsupported",
  realtimeTransportUnimplemented:
    "settings.voice.chat.blocker.realtimeTransportUnimplemented",
} as const;

/**
 * Voice 设置中的实时语音（语音聊天）分区。
 *
 * Codex 的实时语音依赖真实音视频 transport 与 provider 实时 wire；在 Lime 两者
 * 尚未落地前，这里只呈现可用性和具体阻断原因，不渲染开始/停止、音色或语言等
 * 伪控制，也不采集或播放任何音频。
 */
export function VoiceChatSection() {
  const { t } = useTranslation("settings");
  const { state, reload } = useRealtimeVoiceCapability();
  const available =
    state.status === "ready" ? state.capability.available : false;
  const blockers =
    state.status === "ready" && !available ? state.capability.blockers : [];
  const statusText =
    state.status === "loading"
      ? t("settings.voice.chat.status.checking")
      : state.status === "error"
        ? t("settings.voice.chat.status.loadError")
        : available
          ? t("settings.voice.chat.status.available")
          : t("settings.voice.chat.status.unavailable");
  return (
    <SettingsSection title={t("settings.voice.chat.title")}>
      <SettingsGroup>
        <SettingsRow
          targetId="voice-chat"
          label={t("settings.voice.chat.label")}
          description={
            <>
              <p>{t("settings.voice.chat.description")}</p>
              {blockers.map((blocker) => (
                <p key={blocker} className="text-muted-foreground">
                  {t(BLOCKER_KEYS[blocker])}
                </p>
              ))}
            </>
          }
        >
          <span
            role="status"
            data-realtime-voice-availability={available ? "true" : "false"}
            className="text-[13px] text-muted-foreground"
          >
            {statusText}
          </span>
          {state.status === "loading" ? null : (
            <SettingsAction type="button" onClick={() => void reload()}>
              {t("settings.voice.chat.action.checkAgain")}
            </SettingsAction>
          )}
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
