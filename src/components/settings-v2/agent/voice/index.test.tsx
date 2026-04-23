import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetConfig,
  mockSaveConfig,
  mockGetVoiceInputConfig,
  mockSaveVoiceInputConfig,
  mockGetAsrCredentials,
  mockGetVoiceShortcutRuntimeStatus,
  mockValidateShortcut,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetVoiceInputConfig: vi.fn(),
  mockSaveVoiceInputConfig: vi.fn(),
  mockGetAsrCredentials: vi.fn(),
  mockGetVoiceShortcutRuntimeStatus: vi.fn(),
  mockValidateShortcut: vi.fn(),
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  saveConfig: mockSaveConfig,
}));

vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: mockGetVoiceInputConfig,
  saveVoiceInputConfig: mockSaveVoiceInputConfig,
  getAsrCredentials: mockGetAsrCredentials,
}));

vi.mock("@/lib/api/hotkeys", () => ({
  getVoiceShortcutRuntimeStatus: mockGetVoiceShortcutRuntimeStatus,
}));

vi.mock("@/lib/api/experimentalFeatures", () => ({
  validateShortcut: mockValidateShortcut,
}));

vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: () => ({
    providers: [
      {
        key: "openai",
        label: "OpenAI",
        registryId: "openai",
        type: "openai",
        providerId: "openai",
        customModels: ["gpt-4.1-mini", "gpt-4o-mini-tts"],
      },
    ],
    loading: false,
  }),
  findConfiguredProviderBySelection: (
    providers: Array<{
      key: string;
      providerId?: string;
    }>,
    selection?: string,
  ) =>
    providers.find(
      (provider) =>
        provider.key === selection || provider.providerId === selection,
    ) ?? null,
}));

vi.mock("@/components/input-kit", () => ({
  ModelSelector: ({
    providerType,
    model,
  }: {
    providerType: string;
    model: string;
  }) => (
    <div data-testid="voice-model-selector">
      {providerType || "自动选择"} / {model || "自动选择"}
    </div>
  ),
}));

vi.mock("@/components/smart-input/ShortcutSettings", () => ({
  ShortcutSettings: ({
    currentShortcut,
    onShortcutChange,
    emptyLabel,
  }: {
    currentShortcut: string;
    onShortcutChange: (shortcut: string) => Promise<void>;
    emptyLabel?: string;
  }) => (
    <div data-testid={`shortcut-${currentShortcut || "empty"}`}>
      <span>{currentShortcut || emptyLabel || "未设置快捷键"}</span>
      <button
        type="button"
        onClick={() =>
          void onShortcutChange(
            currentShortcut
              ? `${currentShortcut}-updated`
              : "CommandOrControl+Shift+T",
          )
        }
      >
        更新快捷键
      </button>
      {!currentShortcut ? (
        <button type="button" onClick={() => void onShortcutChange("")}>
          清空快捷键
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/voice/MicrophoneTest", () => ({
  MicrophoneTest: ({
    selectedDeviceId,
    onDeviceChange,
  }: {
    selectedDeviceId?: string;
    onDeviceChange: (deviceId?: string) => void;
  }) => (
    <div data-testid="microphone-test">
      <span>{selectedDeviceId || "系统默认"}</span>
      <button type="button" onClick={() => onDeviceChange("usb-mic")}>
        切换设备
      </button>
    </div>
  ),
}));

vi.mock("@/components/voice/InstructionEditor", () => ({
  InstructionEditor: ({
    defaultInstructionId,
    onDefaultChange,
    onInstructionsChange,
  }: {
    defaultInstructionId?: string;
    onDefaultChange?: (id: string) => void;
    onInstructionsChange?: (
      instructions: Array<{
        id: string;
        name: string;
        prompt: string;
        is_preset: boolean;
      }>,
    ) => void;
  }) => (
    <div data-testid="instruction-editor">
      <span>{defaultInstructionId}</span>
      <button type="button" onClick={() => onDefaultChange?.("email")}>
        设置默认指令
      </button>
      <button
        type="button"
        onClick={() =>
          onInstructionsChange?.([
            {
              id: "default",
              name: "默认润色",
              prompt: "{{text}}",
              is_preset: true,
            },
            {
              id: "email",
              name: "邮件格式",
              prompt: "{{text}}",
              is_preset: false,
            },
          ])
        }
      >
        同步指令
      </button>
    </div>
  ),
}));

import { VoiceSettings } from ".";

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function renderComponent(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<VoiceSettings />);
  });
  mounted.push({ container, root });
  return container;
}

async function flushEffects(times = 4) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.clearAllMocks();

  mockGetConfig.mockResolvedValue({
    workspace_preferences: {
      media_defaults: {
        voice: {
          preferredProviderId: "openai",
          preferredModelId: "gpt-4o-mini-tts",
          allowFallback: false,
        },
      },
    },
  });

  mockGetVoiceInputConfig.mockResolvedValue({
    enabled: true,
    shortcut: "CommandOrControl+Shift+V",
    translate_shortcut: "CommandOrControl+Shift+T",
    processor: {
      polish_enabled: true,
      polish_provider: "openai",
      polish_model: "gpt-4.1-mini",
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 10,
    },
    instructions: [
      {
        id: "default",
        name: "默认润色",
        prompt: "{{text}}",
        is_preset: true,
      },
      {
        id: "translate_en",
        name: "翻译为英文",
        prompt: "{{text}}",
        is_preset: true,
      },
      {
        id: "email",
        name: "邮件格式",
        prompt: "{{text}}",
        is_preset: false,
      },
    ],
    selected_device_id: undefined,
    sound_enabled: true,
    translate_instruction_id: "translate_en",
  });

  mockGetAsrCredentials.mockResolvedValue([
    {
      id: "openai-default",
      provider: "openai",
      name: "OpenAI Whisper 默认凭证",
      is_default: true,
      disabled: false,
      language: "zh-CN",
    },
  ]);

  mockGetVoiceShortcutRuntimeStatus.mockResolvedValue({
    shortcut_registered: true,
    registered_shortcut: "CommandOrControl+Shift+V",
    translate_shortcut_registered: true,
    registered_translate_shortcut: "CommandOrControl+Shift+T",
  });

  mockValidateShortcut.mockResolvedValue(true);
  mockSaveConfig.mockResolvedValue(undefined);
  mockSaveVoiceInputConfig.mockResolvedValue(undefined);
});

afterEach(() => {
  while (mounted.length > 0) {
    const target = mounted.pop();
    if (!target) {
      break;
    }
    act(() => {
      target.root.unmount();
    });
    target.container.remove();
  }
});

describe("VoiceSettings", () => {
  it("应同时渲染语音输入、语音处理和语音服务模型设置", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const text = container.textContent ?? "";
    expect(text).toContain("语音输入");
    expect(text).toContain("语音处理");
    expect(text).toContain("语音服务模型");
    expect(text).toContain("OpenAI Whisper 默认凭证");
    expect(text).toContain("openai / gpt-4.1-mini");
    expect(text).toContain("openai / gpt-4o-mini-tts");
    expect(text).toContain("运行时已注册");
    expect(text).toContain("翻译模式快捷键已注册");
  });

  it("切换语音输入开关时应保存 voice_input 配置", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const toggle = container.querySelector(
      "button[aria-label='切换语音输入']",
    );
    expect(toggle).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(2);
    });

    expect(mockSaveVoiceInputConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveVoiceInputConfig.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        enabled: false,
        shortcut: "CommandOrControl+Shift+V",
      }),
    );
  });

  it("切换麦克风设备时应保存 selected_device_id", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("切换设备"),
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(2);
    });

    expect(mockSaveVoiceInputConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveVoiceInputConfig.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        selected_device_id: "usb-mic",
      }),
    );
  });

  it("切换默认润色指令时应保存 processor.default_instruction_id", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const select = container.querySelector(
      "select[aria-label='默认润色指令']",
    ) as HTMLSelectElement | null;
    expect(select).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      if (select) {
        select.value = "email";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await flushEffects(2);
    });

    expect(mockSaveVoiceInputConfig).toHaveBeenCalledTimes(1);
    expect(mockSaveVoiceInputConfig.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        processor: expect.objectContaining({
          default_instruction_id: "email",
        }),
      }),
    );
  });

  it("恢复默认后应清空语音生成任务覆盖", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const resetButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("恢复默认"),
    );
    expect(resetButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      resetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(2);
    });

    expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveConfig.mock.calls[0][0];
    expect(
      savedConfig.workspace_preferences.media_defaults.voice,
    ).toBeUndefined();
  });
});
