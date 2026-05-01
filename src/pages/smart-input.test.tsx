import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetCurrentWindow,
  mockSendScreenshotChat,
  mockSafeEmit,
  mockSafeInvoke,
  mockSafeListen,
  mockOnVoiceStartRecording,
  mockOnVoiceStopRecording,
  mockGetVoiceInputConfig,
  mockStartRecording,
  mockStopRecording,
  mockTranscribeAudio,
  mockPolishVoiceText,
  mockCancelRecording,
  mockGetRecordingSegment,
  mockGetRecordingStatus,
  mockGetDefaultLocalVoiceModelReadiness,
} = vi.hoisted(() => {
  const mocks = {
    mockGetCurrentWindow: vi.fn(() => ({
      close: vi.fn(async () => undefined),
      startDragging: vi.fn(async () => undefined),
    })),
    mockSendScreenshotChat: vi.fn(async () => undefined),
    mockSafeEmit: vi.fn(async () => undefined),
    mockSafeListen: vi.fn(async () => vi.fn()),
    mockOnVoiceStartRecording: vi.fn(async () => vi.fn()),
    mockOnVoiceStopRecording: vi.fn(async () => vi.fn()),
    mockGetVoiceInputConfig: vi.fn(async () => ({
      enabled: true,
      shortcut: "Fn",
      processor: {
        polish_enabled: true,
        default_instruction_id: "default",
      },
      output: {
        mode: "type",
        type_delay_ms: 0,
      },
      instructions: [],
      sound_enabled: false,
      translate_instruction_id: "",
    })),
    mockStartRecording: vi.fn(async () => undefined),
    mockStopRecording: vi.fn(async () => ({
      audio_data: [1, 2, 3, 4],
      sample_rate: 16000,
      duration: 1.4,
    })),
    mockTranscribeAudio: vi.fn(async () => ({
      text: "原始识别文本",
      provider: "mock",
    })),
    mockPolishVoiceText: vi.fn(async () => ({
      text: "润色后的文本",
      instruction_name: "默认润色",
    })),
    mockCancelRecording: vi.fn(async () => undefined),
    mockGetRecordingSegment: vi.fn(async () => ({
      audio_data: [1, 2, 3, 4],
      sample_rate: 16000,
      duration: 0.8,
      start_sample: 0,
      end_sample: 12800,
      total_samples: 12800,
    })),
    mockGetRecordingStatus: vi.fn(async () => ({
      is_recording: true,
      volume: 68,
      duration: 2.2,
    })),
    mockGetDefaultLocalVoiceModelReadiness: vi.fn(async () => ({
      ready: true,
    })),
  };

  const mockSafeInvoke = vi.fn(async (command: string) => {
    switch (command) {
      case "get_voice_input_config":
        return mocks.mockGetVoiceInputConfig();
      case "cancel_recording":
        return mocks.mockCancelRecording();
      case "start_recording":
        return mocks.mockStartRecording();
      case "get_recording_status":
        return mocks.mockGetRecordingStatus();
      case "get_recording_segment":
        return mocks.mockGetRecordingSegment();
      case "stop_recording":
        return mocks.mockStopRecording();
      case "transcribe_audio":
        return mocks.mockTranscribeAudio();
      case "polish_voice_text":
        return mocks.mockPolishVoiceText();
      default:
        return undefined;
    }
  });

  return {
    ...mocks,
    mockSafeInvoke,
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mockGetCurrentWindow,
}));

vi.mock("@/lib/api/screenshotChat", () => ({
  sendScreenshotChat: mockSendScreenshotChat,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeEmit: mockSafeEmit,
  safeInvoke: mockSafeInvoke,
  safeListen: mockSafeListen,
}));

vi.mock("@/lib/api/voiceShortcutEvents", () => ({
  onVoiceStartRecording: mockOnVoiceStartRecording,
  onVoiceStopRecording: mockOnVoiceStopRecording,
}));

vi.mock("@/hooks/useVoiceSound", () => ({
  useVoiceSound: () => ({
    playStartSound: vi.fn(),
    playStopSound: vi.fn(),
  }),
}));

vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: mockGetVoiceInputConfig,
  startRecording: mockStartRecording,
  stopRecording: mockStopRecording,
  transcribeAudio: mockTranscribeAudio,
  polishVoiceText: mockPolishVoiceText,
  cancelRecording: mockCancelRecording,
  getRecordingSegment: mockGetRecordingSegment,
  getRecordingStatus: mockGetRecordingStatus,
}));

vi.mock("@/lib/api/voiceModels", () => ({
  getDefaultLocalVoiceModelReadiness: mockGetDefaultLocalVoiceModelReadiness,
}));

import { SmartInputPage } from "./smart-input";
import { OPEN_VOICE_MODEL_SETTINGS_EVENT } from "@/lib/voiceModelSettingsNavigation";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function flushEffects(times = 4) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

async function flushAsyncWork(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
}

async function renderSmartInput(path = "/smart-input") {
  window.history.pushState({}, "", path);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<SmartInputPage />);
  });
  await flushEffects(6);

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  window.history.pushState({}, "", "/");
  vi.useRealTimers();
});

describe("SmartInputPage", () => {
  it("语音模式应自动录音、显示实时状态，并支持停止识别回填文本", async () => {
    const container = await renderSmartInput("/smart-input?voice=true");

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });
    expect(container.textContent).toContain("录音中");

    const stopButton = container.querySelector(
      'button[aria-label="停止录音"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    });
    await flushAsyncWork(4);

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
    expect(mockPolishVoiceText).toHaveBeenCalledWith("原始识别文本");
    expect(
      (container.querySelector("textarea") as HTMLTextAreaElement | null)
        ?.value,
    ).toBe("润色后的文本");
  });

  it("录音中应展示实时识别文本", async () => {
    const container = await renderSmartInput("/smart-input?voice=true");

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetRecordingSegment).toHaveBeenCalledWith(0, 1.2);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]),
      16000,
    );
    expect(container.textContent).toContain("原始识别文本");
  });

  it("录音中遇到静音片段时不应触发实时识别", async () => {
    mockGetRecordingSegment.mockResolvedValueOnce({
      audio_data: [0, 0, 0, 0],
      sample_rate: 16000,
      duration: 0.8,
      start_sample: 0,
      end_sample: 12800,
      total_samples: 12800,
    });
    const container = await renderSmartInput("/smart-input?voice=true");

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetRecordingSegment).toHaveBeenCalledWith(0, 1.2);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("原始识别文本");
  });

  it("本地语音模型未安装时不应自动开始录音", async () => {
    mockGetDefaultLocalVoiceModelReadiness.mockResolvedValueOnce({
      ready: false,
      model_id: "sensevoice-small-int8-2024-07-17",
      installed: false,
      message: "先下载语音模型",
    } as any);

    const container = await renderSmartInput("/smart-input?voice=true");

    await flushAsyncWork(2);

    expect(mockGetDefaultLocalVoiceModelReadiness).toHaveBeenCalledTimes(1);
    expect(mockStartRecording).not.toHaveBeenCalled();
    expect(mockSafeEmit).toHaveBeenCalledWith(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      expect.objectContaining({
        source: "smart-input",
        reason: "missing-model",
        modelId: "sensevoice-small-int8-2024-07-17",
      }),
    );
    expect(container.textContent).toContain("先下载语音模型");
    expect(container.querySelector('button[aria-label="停止录音"]')).toBeNull();
  });
});
