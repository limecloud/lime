import { safeEmit, safeListen } from "@/lib/dev-bridge";

export const OPEN_VOICE_MODEL_SETTINGS_EVENT =
  "lime-open-voice-model-settings";
export const VOICE_MODEL_SETTINGS_SECTION_ID = "lime-voice-model-settings";
export const VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY =
  "lime:voice-model-settings-focus";

export interface VoiceModelSettingsNavigationDetail {
  source?: "inputbar" | "smart-input" | string;
  reason?: "missing-model" | string;
  modelId?: string | null;
}

function normalizeDetail(
  detail?: VoiceModelSettingsNavigationDetail | null,
): VoiceModelSettingsNavigationDetail {
  return {
    source: detail?.source,
    reason: detail?.reason,
    modelId: detail?.modelId ?? null,
  };
}

export function persistVoiceModelSettingsFocusRequest(
  detail?: VoiceModelSettingsNavigationDetail | null,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY,
      JSON.stringify({
        ...normalizeDetail(detail),
        requestedAt: Date.now(),
      }),
    );
  } catch {
    // 浏览器隐私模式或测试环境可能禁用 sessionStorage；跳过即可。
  }
}

export function consumeVoiceModelSettingsFocusRequest(): VoiceModelSettingsNavigationDetail | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(
      VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY,
    );
    window.sessionStorage.removeItem(VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeDetail(JSON.parse(raw) as VoiceModelSettingsNavigationDetail);
  } catch {
    return null;
  }
}

export function requestOpenVoiceModelSettings(
  detail?: VoiceModelSettingsNavigationDetail,
): void {
  if (typeof window === "undefined") {
    return;
  }

  persistVoiceModelSettingsFocusRequest(detail);
  window.dispatchEvent(
    new CustomEvent<VoiceModelSettingsNavigationDetail>(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      {
        detail: normalizeDetail(detail),
      },
    ),
  );
}

export async function broadcastOpenVoiceModelSettingsRequest(
  detail?: VoiceModelSettingsNavigationDetail,
): Promise<void> {
  await safeEmit(OPEN_VOICE_MODEL_SETTINGS_EVENT, normalizeDetail(detail));
}

export function listenOpenVoiceModelSettingsRequest(
  handler: (detail: VoiceModelSettingsNavigationDetail) => void,
): () => void {
  let disposed = false;
  let tauriUnlisten: (() => void) | null = null;

  const handleWindowEvent = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      handler(normalizeDetail());
      return;
    }

    handler(normalizeDetail(event.detail));
  };

  window.addEventListener(OPEN_VOICE_MODEL_SETTINGS_EVENT, handleWindowEvent);

  void safeListen<VoiceModelSettingsNavigationDetail>(
    OPEN_VOICE_MODEL_SETTINGS_EVENT,
    (event) => {
      if (disposed) {
        return;
      }
      handler(normalizeDetail(event.payload));
    },
  )
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      tauriUnlisten = unlisten;
    })
    .catch((error) => {
      console.warn("[语音模型] 监听设置页跳转事件失败:", error);
    });

  return () => {
    disposed = true;
    window.removeEventListener(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      handleWindowEvent,
    );
    tauriUnlisten?.();
  };
}
