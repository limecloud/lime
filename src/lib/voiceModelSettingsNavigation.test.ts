import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeEmit, mockSafeListen } = vi.hoisted(() => ({
  mockSafeEmit: vi.fn(async () => undefined),
  mockSafeListen: vi.fn(
    async (
      _event: string,
      _handler: (event: { payload: unknown }) => void,
    ) => vi.fn(),
  ),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeEmit: mockSafeEmit,
  safeListen: mockSafeListen,
}));

import {
  broadcastOpenVoiceModelSettingsRequest,
  consumeVoiceModelSettingsFocusRequest,
  listenOpenVoiceModelSettingsRequest,
  OPEN_VOICE_MODEL_SETTINGS_EVENT,
  persistVoiceModelSettingsFocusRequest,
  VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY,
  requestOpenVoiceModelSettings,
  type VoiceModelSettingsNavigationDetail,
} from "./voiceModelSettingsNavigation";

describe("voiceModelSettingsNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeListen.mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    window.sessionStorage.removeItem(VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY);
    vi.clearAllMocks();
  });

  it("同窗口请求应派发语音模型设置页事件", () => {
    const handler = vi.fn();
    const cleanup = listenOpenVoiceModelSettingsRequest(handler);

    requestOpenVoiceModelSettings({
      source: "inputbar",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });

    expect(handler).toHaveBeenCalledWith({
      source: "inputbar",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });
    expect(mockSafeEmit).not.toHaveBeenCalled();
    expect(consumeVoiceModelSettingsFocusRequest()).toEqual({
      source: "inputbar",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });

    cleanup();
  });

  it("应持久化并消费语音模型设置页聚焦请求", () => {
    persistVoiceModelSettingsFocusRequest({
      source: "smart-input",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });

    expect(window.sessionStorage.getItem(VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY))
      .toContain("sensevoice-small-int8-2024-07-17");
    expect(consumeVoiceModelSettingsFocusRequest()).toEqual({
      source: "smart-input",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });
    expect(
      window.sessionStorage.getItem(VOICE_MODEL_SETTINGS_FOCUS_STORAGE_KEY),
    ).toBeNull();
  });

  it("跨窗口请求应通过 Tauri 事件桥广播", async () => {
    await broadcastOpenVoiceModelSettingsRequest({
      source: "smart-input",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });

    expect(mockSafeEmit).toHaveBeenCalledWith(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      {
        source: "smart-input",
        reason: "missing-model",
        modelId: "sensevoice-small-int8-2024-07-17",
      },
    );
  });

  it("监听器应接收 Tauri 事件桥请求", async () => {
    const bridgeHandlers: Array<
      (event: { payload: VoiceModelSettingsNavigationDetail }) => void
    > = [];
    mockSafeListen.mockImplementationOnce(async (_event, handler) => {
      bridgeHandlers.push(
        handler as (event: {
          payload: VoiceModelSettingsNavigationDetail;
        }) => void,
      );
      return vi.fn();
    });
    const handler = vi.fn();
    const cleanup = listenOpenVoiceModelSettingsRequest(handler);

    await Promise.resolve();
    expect(bridgeHandlers).toHaveLength(1);
    bridgeHandlers[0]?.({
      payload: {
        source: "smart-input",
        reason: "missing-model",
        modelId: "sensevoice-small-int8-2024-07-17",
      },
    });

    expect(mockSafeListen).toHaveBeenCalledWith(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith({
      source: "smart-input",
      reason: "missing-model",
      modelId: "sensevoice-small-int8-2024-07-17",
    });

    cleanup();
  });
});
