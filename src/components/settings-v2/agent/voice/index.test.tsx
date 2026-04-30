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
  mockListVoiceModelCatalog,
  mockGetVoiceModelInstallState,
  mockDownloadVoiceModel,
  mockDeleteVoiceModel,
  mockSetDefaultVoiceModel,
  mockTestTranscribeVoiceModelFile,
  mockOpenDialog,
  mockValidateShortcut,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockGetVoiceInputConfig: vi.fn(),
  mockSaveVoiceInputConfig: vi.fn(),
  mockGetAsrCredentials: vi.fn(),
  mockGetVoiceShortcutRuntimeStatus: vi.fn(),
  mockListVoiceModelCatalog: vi.fn(),
  mockGetVoiceModelInstallState: vi.fn(),
  mockDownloadVoiceModel: vi.fn(),
  mockDeleteVoiceModel: vi.fn(),
  mockSetDefaultVoiceModel: vi.fn(),
  mockTestTranscribeVoiceModelFile: vi.fn(),
  mockOpenDialog: vi.fn(),
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

vi.mock("@/lib/api/voiceModels", () => ({
  listVoiceModelCatalog: mockListVoiceModelCatalog,
  getVoiceModelInstallState: mockGetVoiceModelInstallState,
  downloadVoiceModel: mockDownloadVoiceModel,
  deleteVoiceModel: mockDeleteVoiceModel,
  setDefaultVoiceModel: mockSetDefaultVoiceModel,
  testTranscribeVoiceModelFile: mockTestTranscribeVoiceModelFile,
}));

vi.mock("@/lib/api/experimentalFeatures", () => ({
  validateShortcut: mockValidateShortcut,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mockOpenDialog,
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createVoiceInputConfig(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
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

  mockGetVoiceInputConfig.mockResolvedValue(createVoiceInputConfig());

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
    fn_supported: false,
    fn_registered: false,
    fn_fallback_shortcut: "CommandOrControl+Shift+V",
    fn_note: "Fn 按住录音当前仅支持 macOS；已使用普通语音快捷键回退。",
  });

  mockListVoiceModelCatalog.mockResolvedValue([
    {
      id: "sensevoice-small-int8-2024-07-17",
      name: "SenseVoice Small INT8",
      provider: "FunAudioLLM / sherpa-onnx",
      description: "本地离线 ASR",
      version: "2024-07-17",
      languages: ["zh", "en", "ja", "ko", "yue"],
      size_bytes: 262144000,
      download_url: "https://example.test/sensevoice.tar.bz2",
      vad_model_id: "silero-vad-onnx",
      vad_download_url: "https://example.test/silero_vad.onnx",
      runtime: "sherpa-onnx",
      bundled: false,
      checksum_sha256: null,
    },
  ]);
  mockGetVoiceModelInstallState.mockResolvedValue({
    model_id: "sensevoice-small-int8-2024-07-17",
    installed: false,
    installing: false,
    install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
    model_file: null,
    tokens_file: null,
    vad_file: null,
    installed_bytes: 0,
    last_verified_at: 1,
    missing_files: ["model.int8.onnx", "tokens.txt", "silero_vad.onnx"],
    default_credential_id: null,
  });
  mockDownloadVoiceModel.mockResolvedValue({
    state: {
      model_id: "sensevoice-small-int8-2024-07-17",
      installed: true,
      installing: false,
      install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
      model_file: "/mock/model.int8.onnx",
      tokens_file: "/mock/tokens.txt",
      vad_file: "/mock/silero_vad.onnx",
      installed_bytes: 262144000,
      last_verified_at: 2,
      missing_files: [],
      default_credential_id: null,
    },
  });
  mockDeleteVoiceModel.mockResolvedValue({
    model_id: "sensevoice-small-int8-2024-07-17",
    installed: false,
    installing: false,
    install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
    model_file: null,
    tokens_file: null,
    vad_file: null,
    installed_bytes: 0,
    last_verified_at: 3,
    missing_files: ["model.int8.onnx", "tokens.txt", "silero_vad.onnx"],
    default_credential_id: null,
  });
  mockSetDefaultVoiceModel.mockResolvedValue({
    id: "sensevoice-local-sensevoice-small-int8-2024-07-17",
    provider: "sensevoice_local",
    name: "SenseVoice Small 本地",
    is_default: true,
    disabled: false,
    language: "auto",
  });
  mockTestTranscribeVoiceModelFile.mockResolvedValue({
    text: "这是测试音频的本地转写结果。",
    duration_secs: 2.5,
    sample_rate: 16000,
    language: "auto",
  });
  mockOpenDialog.mockResolvedValue("/tmp/interview.wav");
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
  it("应同时渲染语音输入、语音模型、语音处理和语音服务模型设置", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const text = container.textContent ?? "";
    expect(text).toContain("语音输入");
    expect(text).toContain("语音模型");
    expect(text).toContain("语音输入快捷键");
    expect(text).toContain("按住录音，松开识别");
    expect(text).toContain("🌐 Fn");
    expect(text).toContain("SenseVoice Small");
    expect(text).toContain("本地");
    expect(text).toContain("未安装（ONNX int8 量化");
    expect(text).toContain("下载并设为默认后可离线转写");
    expect(text).toContain("下载模型");
    expect(text).toContain("当前平台不支持 Fn，已使用快捷键回退");
    expect(text).toContain("语音处理");
    expect(text).toContain("语音服务模型");
    expect(text).toContain("OpenAI Whisper 默认凭证");
    expect(text).toContain("openai / gpt-4.1-mini");
    expect(text).toContain("openai / gpt-4o-mini-tts");
    expect(text).toContain("运行时已注册");
    expect(text).toContain("翻译模式快捷键已注册");
  });

  it("关闭语音输入时应展示 Fn 快捷键未开启状态", async () => {
    mockGetVoiceInputConfig.mockResolvedValueOnce(
      createVoiceInputConfig({ enabled: false }),
    );

    const container = renderComponent();
    await flushEffects(6);

    const text = container.textContent ?? "";
    expect(text).toContain("语音输入未开启，不会注册 Fn 或全局快捷键");
    expect(text).toContain("未启用，不会注册全局快捷键");
  });

  it("点击下载模型时应调用本地模型下载命令", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("下载模型"));
    expect(downloadButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(4);
    });

    expect(mockDownloadVoiceModel).toHaveBeenCalledWith(
      "sensevoice-small-int8-2024-07-17",
    );
    expect(container.textContent ?? "").toContain("已安装");
  });

  it("模型下载中应展示下载状态占位进度", async () => {
    const pendingDownload = createDeferred<{
      state: {
        model_id: string;
        installed: boolean;
        installing: boolean;
        install_dir: string;
        model_file: string;
        tokens_file: string;
        vad_file: string;
        installed_bytes: number;
        last_verified_at: number;
        missing_files: string[];
        default_credential_id: null;
      };
    }>();
    mockDownloadVoiceModel.mockReturnValueOnce(pendingDownload.promise);

    const container = renderComponent();
    await flushEffects(6);

    const downloadButton = Array.from(
      container.querySelectorAll("button"),
    ).find((element) => element.textContent?.includes("下载模型"));
    expect(downloadButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent ?? "").toContain(
      "正在下载 model.int8.onnx (1/2)",
    );
    expect(container.textContent ?? "").toContain("完成后自动校验并安装");

    pendingDownload.resolve({
      state: {
        model_id: "sensevoice-small-int8-2024-07-17",
        installed: true,
        installing: false,
        install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
        model_file: "/mock/model.int8.onnx",
        tokens_file: "/mock/tokens.txt",
        vad_file: "/mock/silero_vad.onnx",
        installed_bytes: 262144000,
        last_verified_at: 2,
        missing_files: [],
        default_credential_id: null,
      },
    });
    await flushEffects(6);
  });

  it("模型已安装时应支持设为默认", async () => {
    mockGetVoiceModelInstallState.mockResolvedValue({
      model_id: "sensevoice-small-int8-2024-07-17",
      installed: true,
      installing: false,
      install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
      model_file: "/mock/model.int8.onnx",
      tokens_file: "/mock/tokens.txt",
      vad_file: "/mock/silero_vad.onnx",
      installed_bytes: 262144000,
      last_verified_at: 4,
      missing_files: [],
      default_credential_id: null,
    });

    const container = renderComponent();
    await flushEffects(6);

    const defaultButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("设为默认"),
    );
    expect(defaultButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      defaultButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(6);
    });

    expect(mockSetDefaultVoiceModel).toHaveBeenCalledWith(
      "sensevoice-small-int8-2024-07-17",
    );
  });

  it("模型已安装时应支持选择 WAV 文件并测试转写", async () => {
    mockGetVoiceModelInstallState.mockResolvedValue({
      model_id: "sensevoice-small-int8-2024-07-17",
      installed: true,
      installing: false,
      install_dir: "/mock/lime/models/voice/sensevoice-small-int8-2024-07-17",
      model_file: "/mock/model.int8.onnx",
      tokens_file: "/mock/tokens.txt",
      vad_file: "/mock/silero_vad.onnx",
      installed_bytes: 262144000,
      last_verified_at: 4,
      missing_files: [],
      default_credential_id: null,
    });

    const container = renderComponent();
    await flushEffects(6);

    const input = container.querySelector(
      "input[aria-label='WAV 文件路径']",
    ) as HTMLInputElement | null;
    expect(input).toBeInstanceOf(HTMLInputElement);

    const selectButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("选择 WAV"),
    );
    expect(selectButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      selectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(4);
    });

    expect(mockOpenDialog).toHaveBeenCalledWith({
      title: "选择 WAV 测试音频",
      multiple: false,
      directory: false,
      filters: [{ name: "WAV 音频", extensions: ["wav"] }],
    });
    expect(input?.value).toBe("/tmp/interview.wav");

    const testButton = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("测试转写"),
    );
    expect(testButton).toBeInstanceOf(HTMLButtonElement);
    expect((testButton as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects(6);
    });

    expect(mockTestTranscribeVoiceModelFile).toHaveBeenCalledWith(
      "sensevoice-small-int8-2024-07-17",
      "/tmp/interview.wav",
    );
    expect(container.textContent ?? "").toContain(
      "这是测试音频的本地转写结果。",
    );
  });

  it("切换语音输入开关时应保存 voice_input 配置", async () => {
    const container = renderComponent();
    await flushEffects(6);

    const toggle = container.querySelector("button[aria-label='切换语音输入']");
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
