import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  HardDrive,
  Loader2,
  Mic,
  Trash2,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { ShortcutSettings } from "@/components/smart-input/ShortcutSettings";
import { MicrophoneTest } from "@/components/voice/MicrophoneTest";
import { InstructionEditor } from "@/components/voice/InstructionEditor";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  getAsrCredentials,
  getVoiceInputConfig,
  saveVoiceInputConfig,
  type AsrCredentialEntry,
  type VoiceInputConfig,
  type VoiceInstruction,
} from "@/lib/api/asrProvider";
import { validateShortcut } from "@/lib/api/experimentalFeatures";
import {
  getVoiceShortcutRuntimeStatus,
  type VoiceShortcutRuntimeStatus,
} from "@/lib/api/hotkeys";
import {
  deleteVoiceModel,
  downloadVoiceModel,
  getVoiceModelInstallState,
  listVoiceModelCatalog,
  setDefaultVoiceModel,
  testTranscribeVoiceModelFile,
  type VoiceModelCatalogEntry,
  type VoiceModelInstallState,
  type VoiceModelTestTranscribeResult,
} from "@/lib/api/voiceModels";
import {
  buildPersistedMediaGenerationPreference,
  getTtsModelsForProvider,
  hasMediaGenerationPreferenceOverride,
  isTtsProvider,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import { modelSupportsTaskFamily } from "@/lib/model/inferModelCapabilities";
import { cn } from "@/lib/utils";
import {
  findConfiguredProviderBySelection,
  useConfiguredProviders,
} from "@/hooks/useConfiguredProviders";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";
import { SettingModelSelectorField } from "../shared/SettingModelSelectorField";

const DEFAULT_MEDIA_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};

type PillTone = "neutral" | "success" | "warning";
type VoiceModelAction = "download" | "delete" | "default" | "test";

const PRIMARY_MODEL_FILE_NAME = "model.int8.onnx";

function normalizeOptionalText(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function ensureValidVoiceInstructionSelection(
  config: VoiceInputConfig,
): VoiceInputConfig {
  if (config.instructions.length === 0) {
    return config;
  }

  const hasInstruction = (id?: string | null) =>
    Boolean(
      id && config.instructions.some((instruction) => instruction.id === id),
    );

  const fallbackDefaultInstructionId = hasInstruction("default")
    ? "default"
    : (config.instructions[0]?.id ?? config.processor.default_instruction_id);

  const nextDefaultInstructionId = hasInstruction(
    config.processor.default_instruction_id,
  )
    ? config.processor.default_instruction_id
    : fallbackDefaultInstructionId;

  const fallbackTranslateInstructionId = hasInstruction("translate_en")
    ? "translate_en"
    : nextDefaultInstructionId;

  const nextTranslateInstructionId = hasInstruction(
    config.translate_instruction_id,
  )
    ? config.translate_instruction_id
    : fallbackTranslateInstructionId;

  if (
    nextDefaultInstructionId === config.processor.default_instruction_id &&
    nextTranslateInstructionId === config.translate_instruction_id
  ) {
    return config;
  }

  return {
    ...config,
    processor: {
      ...config.processor,
      default_instruction_id: nextDefaultInstructionId,
    },
    translate_instruction_id: nextTranslateInstructionId,
  };
}

function StatusPill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
        tone === "success" &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "neutral" && "border-slate-200 bg-slate-50 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

function SettingCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <section className="overflow-visible rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-sky-600" />
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            {title}
          </h3>
          <WorkbenchInfoTip
            ariaLabel={`${title}说明`}
            content={description}
            tone="slate"
          />
        </div>
      </div>
      <div className="divide-y divide-slate-200/80 border-t border-slate-200/80">
        {children}
      </div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-800">{label}</Label>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="max-w-[820px] space-y-4">
      <div className="h-[220px] animate-pulse rounded-[24px] border border-slate-200/80 bg-slate-50" />
      <div className="h-[260px] animate-pulse rounded-[24px] border border-slate-200/80 bg-white" />
      <div className="h-[200px] animate-pulse rounded-[24px] border border-slate-200/80 bg-white" />
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  const mb = value / 1024 / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(0)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

function getVoiceModelDisplayName(entry: VoiceModelCatalogEntry): string {
  return entry.name.replace(/\s+INT8$/i, "").trim() || entry.name;
}

function getVoiceModelInstallStatusText(
  entry: VoiceModelCatalogEntry,
  state: VoiceModelInstallState | null,
  action: VoiceModelAction | null,
): string {
  if (action === "download") {
    return `正在下载 ${PRIMARY_MODEL_FILE_NAME} (1/2)`;
  }

  const modelSize = entry.size_bytes
    ? `约 ${formatBytes(entry.size_bytes)}`
    : "大小待目录返回";

  if (state?.installed) {
    return `已安装（ONNX int8 量化，${modelSize}）`;
  }

  return `未安装（ONNX int8 量化，${modelSize}）`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallback;
}

function buildPrimaryShortcutStatus(
  voiceConfig: VoiceInputConfig | null,
  runtimeStatus: VoiceShortcutRuntimeStatus | null,
): { text: string; tone: PillTone } {
  if (!voiceConfig) {
    return { text: "加载中", tone: "neutral" };
  }

  if (!voiceConfig.enabled) {
    return { text: "未启用，不会注册全局快捷键", tone: "neutral" };
  }

  if (
    runtimeStatus?.shortcut_registered &&
    runtimeStatus.registered_shortcut === voiceConfig.shortcut
  ) {
    return { text: "运行时已注册", tone: "success" };
  }

  return { text: "配置已保存，但运行时尚未注册", tone: "warning" };
}

function buildTranslateShortcutStatus(
  voiceConfig: VoiceInputConfig | null,
  runtimeStatus: VoiceShortcutRuntimeStatus | null,
): { text: string; tone: PillTone } {
  if (!voiceConfig) {
    return { text: "加载中", tone: "neutral" };
  }

  if (!voiceConfig.translate_shortcut) {
    return { text: "未设置翻译模式快捷键", tone: "neutral" };
  }

  if (!voiceConfig.enabled) {
    return { text: "需先启用语音输入", tone: "warning" };
  }

  const hasInstruction = voiceConfig.instructions.some(
    (instruction) => instruction.id === voiceConfig.translate_instruction_id,
  );
  if (!hasInstruction) {
    return { text: "请先选择翻译模式指令", tone: "warning" };
  }

  if (
    runtimeStatus?.translate_shortcut_registered &&
    runtimeStatus.registered_translate_shortcut ===
      voiceConfig.translate_shortcut
  ) {
    return { text: "翻译模式快捷键已注册", tone: "success" };
  }

  return { text: "翻译模式配置已保存，但运行时尚未注册", tone: "warning" };
}

function buildFnShortcutStatus(
  runtimeStatus: VoiceShortcutRuntimeStatus | null,
): { text: string; tone: PillTone } {
  if (!runtimeStatus) {
    return { text: "Fn 状态加载中", tone: "neutral" };
  }

  if (runtimeStatus.fn_registered) {
    return { text: "Fn 按住录音已注册", tone: "success" };
  }

  if (runtimeStatus.fn_supported) {
    return { text: "Fn 支持可用，等待运行时注册", tone: "warning" };
  }

  return { text: "当前平台不支持 Fn，已使用快捷键回退", tone: "warning" };
}

export function VoiceSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceInputConfig | null>(null);
  const [voiceShortcutStatus, setVoiceShortcutStatus] =
    useState<VoiceShortcutRuntimeStatus | null>(null);
  const [asrCredentials, setAsrCredentials] = useState<AsrCredentialEntry[]>(
    [],
  );
  const [voiceModelCatalog, setVoiceModelCatalog] = useState<
    VoiceModelCatalogEntry[]
  >([]);
  const [voiceModelState, setVoiceModelState] =
    useState<VoiceModelInstallState | null>(null);
  const [voiceModelAction, setVoiceModelAction] =
    useState<VoiceModelAction | null>(null);
  const [voiceModelTestPath, setVoiceModelTestPath] = useState("");
  const [voiceModelTestResult, setVoiceModelTestResult] =
    useState<VoiceModelTestTranscribeResult | null>(null);
  const [voiceModelTestError, setVoiceModelTestError] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [globalVoicePreference, setGlobalVoicePreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);
  const { providers, loading: providersLoading } = useConfiguredProviders();

  const loadVoiceSettings = useCallback(async () => {
    setLoading(true);

    try {
      const [
        nextConfig,
        nextVoiceConfig,
        nextVoiceShortcutStatus,
        nextAsr,
        nextVoiceModelCatalog,
      ] = await Promise.all([
        getConfig(),
        getVoiceInputConfig(),
        getVoiceShortcutRuntimeStatus().catch(() => null),
        getAsrCredentials().catch(() => []),
        listVoiceModelCatalog().catch(() => []),
      ]);
      const primaryVoiceModel = nextVoiceModelCatalog[0] ?? null;
      const nextVoiceModelState = primaryVoiceModel
        ? await getVoiceModelInstallState(primaryVoiceModel.id).catch(
            () => null,
          )
        : null;

      const normalizedVoiceConfig =
        ensureValidVoiceInstructionSelection(nextVoiceConfig);

      setConfig(nextConfig);
      setVoiceConfig(normalizedVoiceConfig);
      setVoiceShortcutStatus(nextVoiceShortcutStatus);
      setAsrCredentials(nextAsr);
      setVoiceModelCatalog(nextVoiceModelCatalog);
      setVoiceModelState(nextVoiceModelState);
      setGlobalVoicePreference(
        nextConfig.workspace_preferences?.media_defaults?.voice ??
          DEFAULT_MEDIA_PREFERENCE,
      );
    } catch (error) {
      console.error("加载语音设置失败:", error);
      setMessage({ type: "error", text: "加载语音设置失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVoiceSettings();
  }, [loadVoiceSettings]);

  const showMessage = useCallback((type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  const persistVoiceConfig = useCallback(
    async (updater: (current: VoiceInputConfig) => VoiceInputConfig) => {
      if (!voiceConfig) {
        return;
      }

      try {
        const nextVoiceConfig = ensureValidVoiceInstructionSelection(
          updater(voiceConfig),
        );
        await saveVoiceInputConfig(nextVoiceConfig);
        setVoiceConfig(nextVoiceConfig);
        const nextRuntimeStatus = await getVoiceShortcutRuntimeStatus().catch(
          () => null,
        );
        setVoiceShortcutStatus(nextRuntimeStatus);
        if (nextVoiceConfig.enabled !== voiceConfig.enabled) {
          await loadVoiceSettings();
        }
        showMessage("success", "语音设置已保存");
      } catch (error) {
        console.error("保存语音设置失败:", error);
        showMessage("error", "保存语音设置失败");
      }
    },
    [loadVoiceSettings, showMessage, voiceConfig],
  );

  const persistGlobalVoicePreference = useCallback(
    async (nextPreference: MediaGenerationPreference) => {
      if (!config) {
        return;
      }

      try {
        const persistedPreference =
          buildPersistedMediaGenerationPreference(nextPreference);
        const nextConfig: Config = {
          ...config,
          workspace_preferences: {
            ...config.workspace_preferences,
            media_defaults: {
              ...config.workspace_preferences?.media_defaults,
              voice: persistedPreference,
            },
          },
        };
        await saveConfig(nextConfig);
        setConfig(nextConfig);
        setGlobalVoicePreference(nextPreference);
        showMessage("success", "语音生成偏好已保存");
      } catch (error) {
        console.error("保存语音生成偏好失败:", error);
        showMessage("error", "保存语音生成偏好失败");
      }
    },
    [config, showMessage],
  );

  const enabledAsrCredentials = useMemo(
    () => asrCredentials.filter((credential) => !credential.disabled),
    [asrCredentials],
  );
  const defaultAsrCredential = useMemo(
    () =>
      enabledAsrCredentials.find((credential) => credential.is_default) ?? null,
    [enabledAsrCredentials],
  );

  const voiceProviders = useMemo(
    () =>
      providers.filter((provider) =>
        isTtsProvider(provider.providerId ?? provider.key, provider.type),
      ),
    [providers],
  );

  const polishProvider = useMemo(
    () =>
      voiceConfig
        ? findConfiguredProviderBySelection(
            providers,
            voiceConfig.processor.polish_provider,
          )
        : null,
    [providers, voiceConfig],
  );

  const polishProviderWarning = voiceConfig?.processor.polish_provider
    ? !polishProvider
      ? `当前润色 Provider 不可用：${voiceConfig.processor.polish_provider}`
      : undefined
    : undefined;

  const polishModelWarning =
    voiceConfig?.processor.polish_model &&
    polishProvider?.customModels?.length &&
    !polishProvider.customModels.includes(voiceConfig.processor.polish_model)
      ? `当前润色模型不在 ${polishProvider.label} 的已配置模型中：${voiceConfig.processor.polish_model}`
      : undefined;

  const primaryShortcutStatus = useMemo(
    () => buildPrimaryShortcutStatus(voiceConfig, voiceShortcutStatus),
    [voiceConfig, voiceShortcutStatus],
  );

  const translateShortcutStatus = useMemo(
    () => buildTranslateShortcutStatus(voiceConfig, voiceShortcutStatus),
    [voiceConfig, voiceShortcutStatus],
  );

  const fnShortcutStatus = useMemo(
    () => buildFnShortcutStatus(voiceShortcutStatus),
    [voiceShortcutStatus],
  );

  const primaryVoiceModel = voiceModelCatalog[0] ?? null;
  const isVoiceModelDefault = Boolean(
    voiceModelState?.default_credential_id ||
    defaultAsrCredential?.provider === "sensevoice_local",
  );

  const voiceInstructions = voiceConfig?.instructions ?? [];
  const defaultInstructionId =
    voiceConfig?.processor.default_instruction_id ?? "";
  const translateInstructionId = voiceConfig?.translate_instruction_id ?? "";

  const defaultInstructionLabel =
    voiceInstructions.find(
      (instruction) => instruction.id === defaultInstructionId,
    )?.name ?? "请选择默认润色指令";

  const translateInstructionLabel =
    voiceInstructions.find(
      (instruction) => instruction.id === translateInstructionId,
    )?.name ?? "请选择翻译模式指令";

  const providerHint = providersLoading
    ? "正在识别当前可用于配音 / TTS 的 Provider。"
    : voiceProviders.length === 0
      ? "当前没有可用语音生成 Provider；请先在设置 -> AI 服务商中配置支持 TTS 的服务。"
      : "这里只配置配音 / 语音生成任务的默认 Provider、模型与回退策略。";

  const llmModelHint = providersLoading
    ? "正在加载可用的润色模型。"
    : providers.length === 0
      ? "当前没有可用的对话模型；请先配置至少一个 LLM Provider。"
      : "默认润色和翻译模式共用同一组模型选择；统一复用聊天页的模型选择器。";

  const handleVoiceEnabledChange = (enabled: boolean) => {
    void persistVoiceConfig((current) => ({
      ...current,
      enabled,
    }));
  };

  const handleSoundEnabledChange = (soundEnabled: boolean) => {
    void persistVoiceConfig((current) => ({
      ...current,
      sound_enabled: soundEnabled,
    }));
  };

  const handleDeviceChange = (selectedDeviceId?: string) => {
    void persistVoiceConfig((current) => ({
      ...current,
      selected_device_id: selectedDeviceId,
    }));
  };

  const handlePrimaryShortcutChange = async (shortcut: string) => {
    const normalizedShortcut = shortcut.trim();
    if (!normalizedShortcut) {
      return;
    }

    await persistVoiceConfig((current) => ({
      ...current,
      shortcut: normalizedShortcut,
    }));
  };

  const handleTranslateShortcutChange = async (shortcut: string) => {
    await persistVoiceConfig((current) => ({
      ...current,
      translate_shortcut: normalizeOptionalText(shortcut),
    }));
  };

  const handlePolishEnabledChange = (enabled: boolean) => {
    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        polish_enabled: enabled,
      },
    }));
  };

  const handlePolishProviderChange = (value: string) => {
    const nextProviderId = normalizeOptionalText(value);

    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        polish_provider: nextProviderId,
        polish_model:
          nextProviderId === current.processor.polish_provider
            ? current.processor.polish_model
            : undefined,
      },
    }));
  };

  const handlePolishModelChange = (value: string) => {
    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        polish_model: normalizeOptionalText(value),
      },
    }));
  };

  const handleDefaultInstructionChange = (instructionId: string) => {
    void persistVoiceConfig((current) => ({
      ...current,
      processor: {
        ...current.processor,
        default_instruction_id: instructionId,
      },
    }));
  };

  const handleTranslateInstructionChange = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const instructionId = event.target.value;
    void persistVoiceConfig((current) => ({
      ...current,
      translate_instruction_id: instructionId,
    }));
  };

  const handleInstructionSnapshot = (instructions: VoiceInstruction[]) => {
    setVoiceConfig((current) => {
      if (!current) {
        return current;
      }

      return ensureValidVoiceInstructionSelection({
        ...current,
        instructions,
      });
    });
  };

  const handleDefaultInstructionSelect = (
    event: ChangeEvent<HTMLSelectElement>,
  ) => {
    const instructionId = event.target.value;
    handleDefaultInstructionChange(instructionId);
  };

  const handleMediaProviderChange = (value: string) => {
    const preferredProviderId = normalizeOptionalText(value);
    const nextProvider = findConfiguredProviderBySelection(
      voiceProviders,
      preferredProviderId,
    );
    const nextModels = nextProvider
      ? getTtsModelsForProvider(nextProvider.customModels)
      : [];
    const preferredModelId = preferredProviderId
      ? nextModels.includes(globalVoicePreference.preferredModelId || "")
        ? globalVoicePreference.preferredModelId
        : undefined
      : undefined;

    void persistGlobalVoicePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: globalVoicePreference.allowFallback ?? true,
    });
  };

  const handleMediaModelChange = (value: string) => {
    void persistGlobalVoicePreference({
      ...globalVoicePreference,
      preferredModelId: normalizeOptionalText(value),
      allowFallback: globalVoicePreference.allowFallback ?? true,
    });
  };

  const handleFallbackChange = (value: boolean) => {
    void persistGlobalVoicePreference({
      ...globalVoicePreference,
      allowFallback: value,
    });
  };

  const handleResetPreference = () => {
    void persistGlobalVoicePreference(DEFAULT_MEDIA_PREFERENCE);
  };

  const handleDownloadVoiceModel = async () => {
    if (!primaryVoiceModel) {
      return;
    }

    setVoiceModelAction("download");
    try {
      const result = await downloadVoiceModel(primaryVoiceModel.id);
      setVoiceModelState(result.state);
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
      showMessage("success", "SenseVoice Small 模型已下载");
    } catch (error) {
      console.error("下载 SenseVoice Small 模型失败:", error);
      showMessage("error", "下载 SenseVoice Small 模型失败");
    } finally {
      setVoiceModelAction(null);
    }
  };

  const handleDeleteVoiceModel = async () => {
    if (!primaryVoiceModel) {
      return;
    }

    setVoiceModelAction("delete");
    try {
      const state = await deleteVoiceModel(primaryVoiceModel.id);
      setVoiceModelState(state);
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
      await loadVoiceSettings();
      showMessage("success", "SenseVoice Small 模型已删除");
    } catch (error) {
      console.error("删除 SenseVoice Small 模型失败:", error);
      showMessage("error", "删除 SenseVoice Small 模型失败");
    } finally {
      setVoiceModelAction(null);
    }
  };

  const handleSetDefaultVoiceModel = async () => {
    if (!primaryVoiceModel) {
      return;
    }

    setVoiceModelAction("default");
    try {
      await setDefaultVoiceModel(primaryVoiceModel.id);
      await loadVoiceSettings();
      showMessage("success", "SenseVoice Small 已设为默认识别服务");
    } catch (error) {
      console.error("设置 SenseVoice Small 默认模型失败:", error);
      showMessage("error", "设置 SenseVoice Small 默认模型失败");
    } finally {
      setVoiceModelAction(null);
    }
  };

  const handleSelectVoiceModelTestFile = async () => {
    if (!voiceModelState?.installed || voiceModelAction !== null) {
      return;
    }

    try {
      const selected = await openDialog({
        title: "选择 WAV 测试音频",
        multiple: false,
        directory: false,
        filters: [{ name: "WAV 音频", extensions: ["wav"] }],
      });
      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) {
        return;
      }
      setVoiceModelTestPath(filePath);
      setVoiceModelTestError(null);
      setVoiceModelTestResult(null);
    } catch (error) {
      console.error("选择 SenseVoice Small 测试文件失败:", error);
      setVoiceModelTestError(getErrorMessage(error, "选择 WAV 文件失败"));
      showMessage("error", "选择 WAV 文件失败");
    }
  };

  const handleTestVoiceModel = async () => {
    if (!primaryVoiceModel || !voiceModelState?.installed) {
      return;
    }

    const filePath = voiceModelTestPath.trim();
    if (!filePath) {
      setVoiceModelTestError("请先输入本机 WAV 文件路径");
      return;
    }

    setVoiceModelAction("test");
    setVoiceModelTestError(null);
    setVoiceModelTestResult(null);
    try {
      const result = await testTranscribeVoiceModelFile(
        primaryVoiceModel.id,
        filePath,
      );
      setVoiceModelTestResult(result);
      showMessage("success", "SenseVoice Small 测试转写完成");
    } catch (error) {
      console.error("SenseVoice Small 测试转写失败:", error);
      const errorMessage = getErrorMessage(error, "测试转写失败");
      setVoiceModelTestError(errorMessage);
      showMessage("error", "测试转写失败");
    } finally {
      setVoiceModelAction(null);
    }
  };

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="max-w-[820px] space-y-4">
      {voiceConfig?.enabled && !defaultAsrCredential ? (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-800">
          语音输入已启用，但当前没有默认的语音识别凭证；请先在设置的“语音服务”里设置默认
          ASR 服务。
        </div>
      ) : null}

      <SettingCard
        title="语音输入"
        description="管理语音输入的启用状态、全局快捷键、麦克风设备和录音音效。这里的改动会直接影响输入栏听写、悬浮语音窗和翻译模式。"
        icon={Mic}
      >
        <SettingRow
          label="语音输入快捷键"
          description="开启后可在输入栏或全局快捷键中按住录音、松开停止；macOS 优先使用 Fn，其他平台使用主快捷键回退。"
        >
          <div
            className={cn(
              "space-y-3 rounded-[20px] border px-4 py-4 transition-colors",
              voiceConfig?.enabled
                ? "border-emerald-200 bg-emerald-50/80"
                : "border-slate-200/80 bg-slate-50/80",
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-slate-900">
                  按住录音，松开识别
                </p>
                <p className="text-xs leading-5 text-slate-500">
                  {defaultAsrCredential
                    ? `${defaultAsrCredential.name || defaultAsrCredential.provider}（默认识别服务）`
                    : "尚未配置默认语音识别凭证"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {voiceConfig?.enabled ? (
                  <span className="inline-flex h-7 items-center rounded-full border border-emerald-200 bg-white px-2.5 text-xs font-semibold text-emerald-800 shadow-sm">
                    🌐 Fn
                  </span>
                ) : null}
                <Switch
                  checked={voiceConfig?.enabled ?? false}
                  onCheckedChange={handleVoiceEnabledChange}
                  disabled={!voiceConfig}
                  aria-label="切换语音输入"
                  className={
                    voiceConfig?.enabled
                      ? "!bg-emerald-800"
                      : "!bg-slate-300"
                  }
                />
              </div>
            </div>
            {voiceConfig?.enabled ? (
              <div className="rounded-[16px] border border-slate-200/80 bg-slate-100/90 px-3 py-2.5 text-xs leading-5 text-slate-600">
                <span className="mr-2 inline-flex h-6 items-center rounded-md border border-slate-300 bg-white px-2 font-semibold text-slate-700">
                  Fn
                </span>
                {voiceShortcutStatus?.fn_note ??
                  "按住 Fn 开始录音，松开后停止并识别。"}
                {voiceShortcutStatus?.fn_fallback_shortcut
                  ? ` 回退快捷键：${voiceShortcutStatus.fn_fallback_shortcut}`
                  : ""}
              </div>
            ) : (
              <p className="text-xs leading-5 text-slate-500">
                语音输入未开启，不会注册 Fn 或全局快捷键。
              </p>
            )}
          </div>
        </SettingRow>

        <SettingRow
          label="主快捷键"
          description="用于唤起语音输入的全局快捷键。保存时会同步更新运行时注册状态。"
        >
          <div className="space-y-3">
            <ShortcutSettings
              currentShortcut={voiceConfig?.shortcut ?? ""}
              onShortcutChange={handlePrimaryShortcutChange}
              onValidate={validateShortcut}
              disabled={!voiceConfig}
            />
            <StatusPill tone={primaryShortcutStatus.tone}>
              {primaryShortcutStatus.text}
            </StatusPill>
          </div>
        </SettingRow>

        <SettingRow
          label="翻译模式快捷键"
          description="可选。设置后会直接以翻译模式启动语音输入，并使用下方指定的翻译指令。"
        >
          <div className="space-y-3">
            <ShortcutSettings
              currentShortcut={voiceConfig?.translate_shortcut ?? ""}
              onShortcutChange={handleTranslateShortcutChange}
              onValidate={validateShortcut}
              disabled={!voiceConfig}
              emptyLabel="未设置翻译模式快捷键"
              allowClear
            />
            <StatusPill tone={translateShortcutStatus.tone}>
              {translateShortcutStatus.text}
            </StatusPill>
          </div>
        </SettingRow>

        <SettingRow
          label="Fn 按住录音"
          description="macOS 下通过原生 FlagsChanged 监听 Fn 按住/松开；权限不足或第三方键盘不可用时继续使用主快捷键回退。"
        >
          <div className="space-y-3 rounded-[18px] bg-slate-50/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700">
                Fn
              </span>
              <StatusPill tone={fnShortcutStatus.tone}>
                {fnShortcutStatus.text}
              </StatusPill>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              {voiceShortcutStatus?.fn_note ?? "正在读取 Fn 快捷键运行时状态。"}
              {voiceShortcutStatus?.fn_fallback_shortcut
                ? ` 回退快捷键：${voiceShortcutStatus.fn_fallback_shortcut}`
                : ""}
            </p>
          </div>
        </SettingRow>

        <SettingRow
          label="麦克风设备"
          description="录音时优先使用这里选定的设备；如果留空则回退到系统默认输入设备。"
        >
          <MicrophoneTest
            selectedDeviceId={voiceConfig?.selected_device_id}
            onDeviceChange={handleDeviceChange}
            disabled={!voiceConfig}
          />
        </SettingRow>

        <SettingRow
          label="交互音效"
          description="控制开始录音、结束录音等反馈音效；会同时影响输入栏和悬浮语音窗。"
        >
          <div className="flex items-center justify-end">
            <Switch
              checked={voiceConfig?.sound_enabled ?? true}
              onCheckedChange={handleSoundEnabledChange}
              disabled={!voiceConfig}
              aria-label="切换交互音效"
            />
          </div>
        </SettingRow>
      </SettingCard>

      <SettingCard
        title="语音模型"
        description="管理本地 ASR 模型的按需下载、安装状态和默认识别服务；模型文件只写入用户数据目录，不进入应用安装包。"
        icon={HardDrive}
      >
        <SettingRow
          label="SenseVoice Small"
          description="基于 sherpa-onnx 的本地离线 ASR 模型。下载并设为默认后可离线转写；模型文件按需写入用户数据目录。"
        >
          {primaryVoiceModel ? (
            <div className="space-y-4 rounded-[20px] bg-slate-50/80 px-4 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 gap-3">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border",
                      voiceModelState?.installed
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500",
                    )}
                  >
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {getVoiceModelDisplayName(primaryVoiceModel)}
                      </p>
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                        本地
                      </span>
                      {isVoiceModelDefault ? (
                        <StatusPill tone="success">默认识别服务</StatusPill>
                      ) : null}
                    </div>
                    <p className="text-xs leading-5 text-slate-500">
                      {primaryVoiceModel.description ||
                        "本地离线 ASR，模型按需下载到用户数据目录。"}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-slate-500">
                      <span>
                        {getVoiceModelInstallStatusText(
                          primaryVoiceModel,
                          voiceModelState,
                          voiceModelAction,
                        )}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span>{primaryVoiceModel.runtime}</span>
                      {primaryVoiceModel.version ? (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>{primaryVoiceModel.version}</span>
                        </>
                      ) : null}
                      {primaryVoiceModel.languages.length ? (
                        <>
                          <span className="text-slate-300">·</span>
                          <span>{primaryVoiceModel.languages.join(" / ")}</span>
                        </>
                      ) : null}
                    </div>
                    {voiceModelAction === "download" ? (
                      <div className="space-y-2">
                        <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100">
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-700" />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-4 text-slate-500">
                          <span>正在下载模型包与 VAD 文件</span>
                          <span>完成后自动校验并安装</span>
                        </div>
                      </div>
                    ) : null}
                    <p className="break-all text-xs leading-5 text-slate-500">
                      {voiceModelState?.installed
                        ? voiceModelState.install_dir
                        : "模型未内置，点击下载后写入 Lime 应用数据目录。"}
                    </p>
                    {!voiceModelState?.installed &&
                    voiceModelState?.missing_files.length &&
                    voiceModelAction !== "download" ? (
                      <p className="text-xs leading-5 text-amber-700">
                        缺失文件：{voiceModelState.missing_files.join("、")}
                      </p>
                    ) : null}
                    {voiceModelState?.installed ? (
                      <p className="text-xs leading-5 text-slate-500">
                        已安装大小：{formatBytes(voiceModelState.installed_bytes)}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2 lg:justify-end">
                  {voiceModelState?.installed ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleSetDefaultVoiceModel()}
                        disabled={
                          voiceModelAction !== null || isVoiceModelDefault
                        }
                      >
                        设为默认
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDeleteVoiceModel()}
                        disabled={voiceModelAction !== null}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        删除
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleDownloadVoiceModel()}
                      disabled={voiceModelAction !== null}
                      className="!border-emerald-800 !bg-emerald-800 text-white hover:!bg-emerald-900"
                    >
                      {voiceModelAction === "download" ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-1 h-4 w-4" />
                      )}
                      {voiceModelAction === "download" ? "下载中" : "下载模型"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t border-slate-200/80 pt-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-800">测试转写</p>
                  <p className="text-xs leading-5 text-slate-500">
                    选择或输入本机 16-bit PCM WAV 文件路径，直接验证当前
                    SenseVoice Small
                    安装与本地推理链路；多声道音频仅使用第一声道。
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSelectVoiceModelTestFile()}
                    disabled={
                      !voiceModelState?.installed || voiceModelAction !== null
                    }
                  >
                    <FolderOpen className="mr-1 h-4 w-4" />
                    选择 WAV
                  </Button>
                  <input
                    aria-label="WAV 文件路径"
                    className="h-10 min-w-0 flex-1 rounded-[14px] border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-400"
                    value={voiceModelTestPath}
                    onChange={(event) =>
                      setVoiceModelTestPath(event.target.value)
                    }
                    placeholder="选择或输入 /Users/me/audio.wav"
                    disabled={
                      !voiceModelState?.installed || voiceModelAction !== null
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleTestVoiceModel()}
                    disabled={
                      !voiceModelState?.installed ||
                      voiceModelAction !== null ||
                      !voiceModelTestPath.trim()
                    }
                  >
                    {voiceModelAction === "test" ? "转写中" : "测试转写"}
                  </Button>
                </div>
                {!voiceModelState?.installed ? (
                  <p className="text-xs leading-5 text-amber-700">
                    请先下载并安装模型后再测试转写。
                  </p>
                ) : null}
                {voiceModelTestError ? (
                  <div className="rounded-[16px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
                    {voiceModelTestError}
                  </div>
                ) : null}
                {voiceModelTestResult ? (
                  <div className="space-y-2 rounded-[16px] border border-emerald-200 bg-emerald-50 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone="success">转写完成</StatusPill>
                      <span className="text-xs text-emerald-700">
                        {voiceModelTestResult.sample_rate} Hz ·{" "}
                        {voiceModelTestResult.duration_secs.toFixed(2)} 秒 ·{" "}
                        {voiceModelTestResult.language || "auto"}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">
                      {voiceModelTestResult.text || "未识别到文本"}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
              当前没有可用的本地语音模型清单。
            </div>
          )}
        </SettingRow>
      </SettingCard>

      <SettingCard
        title="语音处理"
        description="统一管理默认润色、翻译模式和语音指令。润色与翻译共用同一组 LLM 模型选择，继续复用聊天页的模型选择器。"
        icon={Wand2}
      >
        <SettingRow
          label="默认启用 AI 润色"
          description="开启后，普通语音输入会自动按默认润色指令进行后处理；翻译模式不受这个开关影响。"
        >
          <div className="flex items-center justify-end">
            <Switch
              checked={voiceConfig?.processor.polish_enabled ?? true}
              onCheckedChange={handlePolishEnabledChange}
              disabled={!voiceConfig}
              aria-label="切换 AI 润色"
            />
          </div>
        </SettingRow>

        <SettingModelSelectorField
          label="润色与翻译模型"
          description={llmModelHint}
          warningText={polishProviderWarning ?? polishModelWarning}
          providerType={voiceConfig?.processor.polish_provider ?? ""}
          setProviderType={handlePolishProviderChange}
          model={voiceConfig?.processor.polish_model ?? ""}
          setModel={handlePolishModelChange}
          providerFilter={() => true}
          modelFilter={(model) =>
            modelSupportsTaskFamily(model, "chat") ||
            modelSupportsTaskFamily(model, "reasoning")
          }
          emptyStateTitle="暂无可用润色模型"
          emptyStateDescription={llmModelHint}
          disabled={!voiceConfig}
        />

        <SettingRow
          label="默认润色指令"
          description="普通语音输入在开启 AI 润色时会使用这里指定的指令。"
        >
          <select
            aria-label="默认润色指令"
            className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-sky-400"
            value={defaultInstructionId}
            onChange={handleDefaultInstructionSelect}
            disabled={!voiceConfig || voiceInstructions.length === 0}
          >
            <option value="" disabled>
              {defaultInstructionLabel}
            </option>
            {voiceInstructions.map((instruction) => (
              <option key={instruction.id} value={instruction.id}>
                {instruction.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="翻译模式指令"
          description="翻译模式快捷键会执行这里选择的指令；建议指向“翻译为英文”或自定义翻译模板。"
        >
          <select
            aria-label="翻译模式指令"
            className="h-11 w-full rounded-[16px] border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-sky-400"
            value={translateInstructionId}
            onChange={handleTranslateInstructionChange}
            disabled={!voiceConfig || voiceInstructions.length === 0}
          >
            <option value="" disabled>
              {translateInstructionLabel}
            </option>
            {voiceInstructions.map((instruction) => (
              <option key={instruction.id} value={instruction.id}>
                {instruction.name}
              </option>
            ))}
          </select>
        </SettingRow>

        <div className="px-5 py-4">
          <InstructionEditor
            defaultInstructionId={defaultInstructionId}
            onDefaultChange={handleDefaultInstructionChange}
            onInstructionsChange={handleInstructionSnapshot}
            disabled={!voiceConfig}
          />
        </div>
      </SettingCard>

      <MediaPreferenceSection
        title="语音服务模型"
        description="这里只配置配音 / 语音生成任务的默认 Provider、模型与回退策略；语音输入本身的识别、快捷键和润色逻辑请在上方设置。"
        selectorLabel="默认模型"
        selectorDescription="统一使用聊天页同款模型选择器；未指定时沿用自动匹配策略。"
        providerType={globalVoicePreference.preferredProviderId ?? ""}
        setProviderType={handleMediaProviderChange}
        model={globalVoicePreference.preferredModelId ?? ""}
        setModel={handleMediaModelChange}
        providerFilter={(provider) =>
          isTtsProvider(provider.providerId ?? provider.key, provider.type)
        }
        modelFilter={(model, provider) =>
          getTtsModelsForProvider(provider.customModels).includes(model.id)
        }
        allowFallback={globalVoicePreference.allowFallback ?? true}
        onAllowFallbackChange={handleFallbackChange}
        fallbackTitle="Provider 不可用时自动回退"
        fallbackDescription="关闭后，若当前默认语音服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyStateTitle="暂无可用语音模型"
        emptyStateDescription={providerHint}
        disabled={!config}
        onReset={handleResetPreference}
        resetLabel="恢复默认"
        resetDisabled={
          !hasMediaGenerationPreferenceOverride(globalVoicePreference)
        }
      />

      {message ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border px-4 py-3",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700",
          )}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <span className="text-sm">{message.text}</span>
        </div>
      ) : null}
    </div>
  );
}
