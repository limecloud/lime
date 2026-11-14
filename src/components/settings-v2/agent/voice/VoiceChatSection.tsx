import { useTranslation } from "react-i18next";
import type { VoiceInputConfig } from "@/lib/api/asrProvider";
import {
  SettingsAction,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "../../SettingsPrimitives";
import { useRealtimeVoiceCapability } from "./useRealtimeVoiceCapability";
import { useRealtimeVoiceSession } from "./useRealtimeVoiceSession";

const BLOCKER_KEYS = {
  providerRealtimeUnsupported:
    "settings.voice.chat.blocker.providerRealtimeUnsupported",
  providerKeyMissing: "settings.voice.chat.blocker.providerKeyMissing",
  realtimeModelUnconfigured:
    "settings.voice.chat.blocker.realtimeModelUnconfigured",
  realtimeModelUnsupported:
    "settings.voice.chat.blocker.realtimeModelUnsupported",
  realtimeVoiceUnconfigured:
    "settings.voice.chat.blocker.realtimeVoiceUnconfigured",
  realtimeVoiceUnsupported:
    "settings.voice.chat.blocker.realtimeVoiceUnsupported",
  realtimeTransportUnimplemented:
    "settings.voice.chat.blocker.realtimeTransportUnimplemented",
} as const;

const CONNECTION_KEYS = {
  idle: "settings.voice.chat.connection.idle",
  "requesting-secret": "settings.voice.chat.connection.requestingSecret",
  "requesting-microphone":
    "settings.voice.chat.connection.requestingMicrophone",
  connecting: "settings.voice.chat.connection.connecting",
  connected: "settings.voice.chat.connection.connected",
  stopping: "settings.voice.chat.connection.stopping",
  closed: "settings.voice.chat.connection.closed",
  error: "settings.voice.chat.connection.error",
} as const;

const ACTIVE_STATES = new Set([
  "requesting-secret",
  "requesting-microphone",
  "connecting",
  "connected",
  "stopping",
]);

interface VoiceChatSectionProps {
  voiceConfig?: VoiceInputConfig | null;
  saving?: boolean;
  onRealtimeSelectionChange?: (
    field: "realtime_model" | "realtime_voice",
    value: string | undefined,
  ) => Promise<boolean>;
}

/**
 * Voice 设置中的实时语音（语音聊天）分区。
 *
 * 只有 App Server 显式返回 `realtime=true` 时才渲染开始控制；模型/音色只在
 * provider wire 可用时展示。开始后由浏览器建立 RTCPeerConnection，App Server
 * 只兑换短时 client secret，标准 OpenAI key 不进入 renderer。
 */
export function VoiceChatSection({
  voiceConfig: _voiceConfig,
  saving = false,
  onRealtimeSelectionChange,
}: VoiceChatSectionProps) {
  const { t } = useTranslation("settings");
  const { state, reload } = useRealtimeVoiceCapability();
  const { snapshot, start, stop } = useRealtimeVoiceSession();
  const capability = state.status === "ready" ? state.capability : null;
  const blockers = capability?.blockers ?? [];
  const available = capability?.available === true;
  const providerBlocked = blockers.some(
    (blocker) =>
      blocker === "providerRealtimeUnsupported" ||
      blocker === "providerKeyMissing",
  );
  const canConfigure =
    Boolean(capability && capability.models.length > 0) && !providerBlocked;
  const sessionActive = ACTIVE_STATES.has(snapshot.state);
  const connectionText = t(CONNECTION_KEYS[snapshot.state]);
  const locked = saving || sessionActive;

  const handleSelection = async (
    field: "realtime_model" | "realtime_voice",
    value: string,
  ) => {
    const saved = await onRealtimeSelectionChange?.(field, value);
    if (saved !== false) await reload();
  };

  return (
    <SettingsSection title={t("settings.voice.chat.title")}>
      <SettingsGroup>
        <SettingsRow
          targetId="voice-chat"
          label={t("settings.voice.chat.label")}
          description={
            <>
              <p>{t("settings.voice.chat.description")}</p>
              <p>{t("settings.voice.chat.security")}</p>
              {blockers.map((blocker) => (
                <p key={blocker} className="text-muted-foreground">
                  {t(BLOCKER_KEYS[blocker])}
                </p>
              ))}
              {state.status === "error" ? (
                <p role="alert" className="text-destructive">
                  {t("settings.voice.chat.status.loadError")}
                </p>
              ) : null}
            </>
          }
        >
          <span
            role="status"
            data-realtime-voice-availability={available ? "true" : "false"}
            className="text-[13px] text-muted-foreground"
          >
            {state.status === "loading"
              ? t("settings.voice.chat.status.checking")
              : state.status === "error"
                ? t("settings.voice.chat.status.loadError")
                : available
                  ? t("settings.voice.chat.status.available")
                  : t("settings.voice.chat.status.unavailable")}
          </span>
          {state.status === "loading" ? null : (
            <SettingsAction type="button" onClick={() => void reload()}>
              {t("settings.voice.chat.action.checkAgain")}
            </SettingsAction>
          )}
        </SettingsRow>

        {canConfigure ? (
          <>
            <SettingsRow
              targetId="voice-chat-model"
              label={t("settings.voice.chat.model.label")}
              description={t("settings.voice.chat.model.description")}
            >
              <SettingsSelect
                aria-label={t("settings.voice.chat.model.label")}
                value={capability?.model ?? ""}
                disabled={locked}
                onChange={(event) => {
                  void handleSelection("realtime_model", event.target.value);
                }}
              >
                <option value="">
                  {t("settings.voice.chat.notConfigured")}
                </option>
                {optionValues(capability?.models ?? [], capability?.model).map(
                  (model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ),
                )}
              </SettingsSelect>
            </SettingsRow>
            <SettingsRow
              targetId="voice-chat-voice"
              label={t("settings.voice.chat.voice.label")}
              description={t("settings.voice.chat.voice.description")}
            >
              <SettingsSelect
                aria-label={t("settings.voice.chat.voice.label")}
                value={capability?.voice ?? ""}
                disabled={locked}
                onChange={(event) => {
                  void handleSelection("realtime_voice", event.target.value);
                }}
              >
                <option value="">
                  {t("settings.voice.chat.notConfigured")}
                </option>
                {optionValues(capability?.voices ?? [], capability?.voice).map(
                  (voice) => (
                    <option key={voice} value={voice}>
                      {voice}
                    </option>
                  ),
                )}
              </SettingsSelect>
            </SettingsRow>
          </>
        ) : null}

        {available || sessionActive ? (
          <SettingsRow
            targetId="voice-chat-session"
            label={t("settings.voice.chat.session.label")}
            description={
              <>
                <p
                  role="status"
                  data-realtime-voice-connection={snapshot.state}
                >
                  {connectionText}
                </p>
                {snapshot.error ? (
                  <p role="alert" className="text-destructive">
                    {t("settings.voice.chat.error.startFailed")}
                  </p>
                ) : null}
              </>
            }
          >
            {sessionActive ? (
              <SettingsAction type="button" onClick={stop}>
                {t("settings.voice.chat.action.stop")}
              </SettingsAction>
            ) : (
              <SettingsAction
                type="button"
                disabled={!available || saving}
                onClick={() => {
                  void start();
                }}
              >
                {t("settings.voice.chat.action.start")}
              </SettingsAction>
            )}
          </SettingsRow>
        ) : null}

        {snapshot.transcripts.length > 0 ? (
          <div
            role="log"
            aria-live="polite"
            aria-label={t("settings.voice.chat.transcript.title")}
            data-realtime-voice-transcript="true"
            className="space-y-2 py-3 text-[13px]"
          >
            {snapshot.transcripts.map((line) => (
              <p key={line.id}>
                <span className="font-medium">
                  {t(
                    line.role === "user"
                      ? "settings.voice.chat.speaker.user"
                      : "settings.voice.chat.speaker.assistant",
                  )}
                  :{" "}
                </span>
                <span className="whitespace-pre-wrap">{line.text}</span>
              </p>
            ))}
          </div>
        ) : null}
        {snapshot.error ? (
          <p role="alert" className="py-2 text-[12px] text-destructive">
            {snapshot.error}
          </p>
        ) : null}
      </SettingsGroup>
    </SettingsSection>
  );
}

function optionValues(
  options: readonly string[],
  selected: string | undefined,
): readonly string[] {
  return selected && !options.includes(selected)
    ? [selected, ...options]
    : options;
}
