import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Mic, Wand2, type LucideIcon } from "lucide-react";
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

  const nextTranslateInstructionId = hasInstruction(config.translate_instruction_id)
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
    runtimeStatus.registered_translate_shortcut === voiceConfig.translate_shortcut
  ) {
    return { text: "翻译模式快捷键已注册", tone: "success" };
  }

  return { text: "翻译模式配置已保存，但运行时尚未注册", tone: "warning" };
}

export function VoiceSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [voiceConfig, setVoiceConfig] = useState<VoiceInputConfig | null>(null);
  const [voiceShortcutStatus, setVoiceShortcutStatus] =
    useState<VoiceShortcutRuntimeStatus | null>(null);
  const [asrCredentials, setAsrCredentials] = useState<AsrCredentialEntry[]>([]);
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
      const [nextConfig, nextVoiceConfig, nextVoiceShortcutStatus, nextAsr] =
        await Promise.all([
          getConfig(),
          getVoiceInputConfig(),
          getVoiceShortcutRuntimeStatus().catch(() => null),
          getAsrCredentials().catch(() => []),
        ]);

      const normalizedVoiceConfig =
        ensureValidVoiceInstructionSelection(nextVoiceConfig);

      setConfig(nextConfig);
      setVoiceConfig(normalizedVoiceConfig);
      setVoiceShortcutStatus(nextVoiceShortcutStatus);
      setAsrCredentials(nextAsr);
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
        showMessage("success", "语音设置已保存");
      } catch (error) {
        console.error("保存语音设置失败:", error);
        showMessage("error", "保存语音设置失败");
      }
    },
    [showMessage, voiceConfig],
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

  const voiceInstructions = voiceConfig?.instructions ?? [];
  const defaultInstructionId = voiceConfig?.processor.default_instruction_id ?? "";
  const translateInstructionId = voiceConfig?.translate_instruction_id ?? "";

  const defaultInstructionLabel =
    voiceInstructions.find((instruction) => instruction.id === defaultInstructionId)
      ?.name ?? "请选择默认润色指令";

  const translateInstructionLabel =
    voiceInstructions.find(
      (instruction) => instruction.id === translateInstructionId,
    )?.name ?? "请选择翻译模式指令";

  const providerHint = providersLoading
    ? "正在识别当前可用于配音 / TTS 的 Provider。"
    : voiceProviders.length === 0
      ? "当前没有可用语音生成 Provider；请先在凭证管理中配置支持 TTS 的服务。"
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

  if (loading) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="max-w-[820px] space-y-4">
      {voiceConfig?.enabled && !defaultAsrCredential ? (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50/85 px-4 py-3 text-sm text-amber-800">
          语音输入已启用，但当前没有默认的语音识别凭证；请先在凭证管理的“语音服务”里设置默认 ASR 服务。
        </div>
      ) : null}

      <SettingCard
        title="语音输入"
        description="管理语音输入的启用状态、全局快捷键、麦克风设备和录音音效。这里的改动会直接影响输入栏听写、悬浮语音窗和翻译模式。"
        icon={Mic}
      >
        <SettingRow
          label="启用语音输入"
          description="关闭后不会注册语音相关全局快捷键，输入栏听写和语音悬浮窗也不会继续工作。"
        >
          <div className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-800">
                当前默认识别服务
              </p>
              <p className="text-xs leading-5 text-slate-500">
                {defaultAsrCredential
                  ? `${defaultAsrCredential.name || defaultAsrCredential.provider}（已设为默认）`
                  : "尚未配置默认语音识别凭证"}
              </p>
            </div>
            <Switch
              checked={voiceConfig?.enabled ?? false}
              onCheckedChange={handleVoiceEnabledChange}
              disabled={!voiceConfig}
              aria-label="切换语音输入"
            />
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
        resetDisabled={!hasMediaGenerationPreferenceOverride(globalVoicePreference)}
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
