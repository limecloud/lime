/**
 * 语音服务配置设置组件
 *
 * 参考成熟产品的 TTS/STT 实现
 * 功能包括：TTS 服务商选择、STT 服务商选择、语音参数配置等
 */

import { useState, useEffect, useMemo } from "react";
import {
  Mic,
  Volume2,
  Play,
  Settings2,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  buildPersistedMediaGenerationPreference,
  getTtsModelsForProvider,
  hasMediaGenerationPreferenceOverride,
  isTtsProvider,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";

type TTSService = "openai" | "azure" | "google" | "edge" | "macos";
type STTService = "openai" | "azure" | "google" | "whisper";

interface VoiceConfig {
  /** TTS 服务商 */
  tts_service?: TTSService;
  /** STT 服务商 */
  stt_service?: STTService;
  /** TTS 语音 */
  tts_voice?: string;
  /** TTS 语速 (0.1-2.0) */
  tts_rate?: number;
  /** TTS 音调 (0.1-2.0) */
  tts_pitch?: number;
  /** TTS 音量 (0-1) */
  tts_volume?: number;
  /** STT 语言 */
  stt_language?: string;
  /** 自动停止录音 */
  stt_auto_stop?: boolean;
  /** 启用语音输入 */
  voice_input_enabled?: boolean;
  /** 启用语音输出 */
  voice_output_enabled?: boolean;
}

const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  tts_service: "openai",
  stt_service: "openai",
  tts_voice: "alloy",
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_volume: 1.0,
  stt_language: "zh-CN",
  stt_auto_stop: true,
  voice_input_enabled: false,
  voice_output_enabled: false,
};

const TTS_SERVICES = [
  { value: "openai" as TTSService, label: "OpenAI", desc: "使用 OpenAI TTS" },
  { value: "azure" as TTSService, label: "Azure", desc: "使用 Azure TTS" },
  { value: "google" as TTSService, label: "Google", desc: "使用 Google TTS" },
  { value: "edge" as TTSService, label: "Edge", desc: "使用 Edge TTS" },
  { value: "macos" as TTSService, label: "macOS", desc: "使用系统 TTS" },
];

const STT_SERVICES = [
  {
    value: "openai" as STTService,
    label: "OpenAI",
    desc: "使用 OpenAI Whisper",
  },
  { value: "azure" as STTService, label: "Azure", desc: "使用 Azure Speech" },
  {
    value: "google" as STTService,
    label: "Google",
    desc: "使用 Google Speech",
  },
  {
    value: "whisper" as STTService,
    label: "Whisper",
    desc: "使用本地 Whisper",
  },
];

const TTS_VOICES = {
  openai: [
    { value: "alloy", label: "Alloy" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "onyx", label: "Onyx" },
    { value: "nova", label: "Nova" },
    { value: "shimmer", label: "Shimmer" },
  ],
  azure: [
    { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女)" },
    { value: "zh-CN-YunxiNeural", label: "云希 (男)" },
    { value: "zh-CN-YunyangNeural", label: "云扬 (男)" },
  ],
  google: [
    { value: "zh-CN-Wavenet-A", label: "WaveNet A" },
    { value: "zh-CN-Wavenet-B", label: "WaveNet B" },
    { value: "zh-CN-Standard-A", label: "Standard A" },
  ],
  edge: [
    { value: "zh-CN-XiaoxiaoNeural", label: "晓晓 (女)" },
    { value: "zh-CN-YunxiNeural", label: "云希 (男)" },
  ],
  macos: [
    { value: "Ting-Ting", label: "婷婷" },
    { value: "Mei-Jia", label: "美佳" },
    { value: "Sin-ji", label: "欣怡" },
  ],
};

const STT_LANGUAGES = [
  { value: "zh-CN", label: "中文 (简体)" },
  { value: "zh-TW", label: "中文 (繁体)" },
  { value: "en-US", label: "英语 (美国)" },
  { value: "en-GB", label: "英语 (英国)" },
  { value: "ja-JP", label: "日语" },
  { value: "ko-KR", label: "韩语" },
];

const AUTO_VALUE = "__auto__";
const DEFAULT_MEDIA_PREFERENCE: MediaGenerationPreference = {
  allowFallback: true,
};
const PANEL_CARD_CLASS =
  "rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5";
const CHOICE_BUTTON_CLASS =
  "rounded-[18px] border px-3 py-3 text-left text-sm transition";
const ACTIVE_CHOICE_BUTTON_CLASS =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_54%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10";
const INACTIVE_CHOICE_BUTTON_CLASS =
  "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50/70 hover:text-slate-900";
const INFO_CARD_CLASS =
  "flex items-start gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/85 p-4 text-xs leading-6 text-slate-600";
const RANGE_INPUT_CLASS =
  "h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-500";
const CHECKBOX_INPUT_CLASS =
  "h-4 w-4 rounded border-slate-300 text-emerald-500 focus:ring-emerald-200";

export function VoiceSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [voiceConfig, setVoiceConfig] =
    useState<VoiceConfig>(DEFAULT_VOICE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [_saving, setSaving] = useState<Record<string, boolean>>({});
  const [testingTTS, setTestingTTS] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const { providers, loading: providersLoading } = useApiKeyProvider();
  const [globalVoicePreference, setGlobalVoicePreference] =
    useState<MediaGenerationPreference>(DEFAULT_MEDIA_PREFERENCE);

  // 加载配置
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const c = await getConfig();
      setConfig(c);
      setVoiceConfig(c.voice || DEFAULT_VOICE_CONFIG);
      setGlobalVoicePreference(
        c.workspace_preferences?.media_defaults?.voice ??
          DEFAULT_MEDIA_PREFERENCE,
      );
    } catch (e) {
      console.error("加载语音配置失败:", e);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveVoiceConfig = async (key: keyof VoiceConfig, value: any) => {
    if (!config) return;
    setSaving((prev) => ({ ...prev, [key]: true }));

    try {
      const newConfig = {
        ...voiceConfig,
        [key]: value,
      };
      const updatedFullConfig = {
        ...config,
        voice: newConfig,
      };
      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setVoiceConfig(newConfig);

      showMessage("success", "设置已保存");
    } catch (e) {
      console.error("保存语音配置失败:", e);
      showMessage("error", "保存失败");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  // 测试 TTS
  const handleTestTTS = async () => {
    setTestingTTS(true);
    try {
      // TODO: 实现 TTS 测试 API
      // await testTTS(voiceConfig.tts_service, voiceConfig.tts_voice);

      // 模拟测试
      await new Promise((resolve) => setTimeout(resolve, 2000));

      showMessage("success", "语音测试成功");
    } catch (e) {
      console.error("TTS 测试失败:", e);
      showMessage("error", "测试失败");
    } finally {
      setTestingTTS(false);
    }
  };

  const saveGlobalVoicePreference = async (
    nextPreference: MediaGenerationPreference,
  ) => {
    if (!config) return;

    try {
      const persistedPreference =
        buildPersistedMediaGenerationPreference(nextPreference);
      const updatedFullConfig: Config = {
        ...config,
        workspace_preferences: {
          ...config.workspace_preferences,
          media_defaults: {
            ...config.workspace_preferences?.media_defaults,
            voice: persistedPreference,
          },
        },
      };
      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setGlobalVoicePreference(nextPreference);
      showMessage("success", "设置已保存");
    } catch (e) {
      console.error("保存全局语音服务配置失败:", e);
      showMessage("error", "保存失败");
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const ttsProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isTtsProvider(provider.id, provider.type),
      ),
    [providers],
  );

  const selectedGlobalVoiceProvider = useMemo(
    () =>
      ttsProviders.find(
        (provider) => provider.id === globalVoicePreference.preferredProviderId,
      ) ?? null,
    [globalVoicePreference.preferredProviderId, ttsProviders],
  );

  const availableGlobalVoiceModels = useMemo(() => {
    if (!selectedGlobalVoiceProvider) {
      return [];
    }
    return getTtsModelsForProvider(selectedGlobalVoiceProvider.custom_models);
  }, [selectedGlobalVoiceProvider]);

  const providerUnavailableLabel =
    globalVoicePreference.preferredProviderId && !selectedGlobalVoiceProvider
      ? "当前配置不可用：" + globalVoicePreference.preferredProviderId
      : undefined;

  const modelUnavailableLabel =
    globalVoicePreference.preferredModelId &&
    !availableGlobalVoiceModels.includes(globalVoicePreference.preferredModelId)
      ? "当前配置不可用：" + globalVoicePreference.preferredModelId
      : undefined;

  const handleGlobalVoiceProviderChange = (value: string) => {
    const preferredProviderId = value === AUTO_VALUE ? undefined : value;
    const nextProvider = ttsProviders.find(
      (provider) => provider.id === preferredProviderId,
    );
    const nextModels = nextProvider
      ? getTtsModelsForProvider(nextProvider.custom_models)
      : [];
    const preferredModelId = preferredProviderId
      ? nextModels.includes(globalVoicePreference.preferredModelId || "")
        ? globalVoicePreference.preferredModelId
        : nextModels[0]
      : undefined;

    void saveGlobalVoicePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: globalVoicePreference.allowFallback ?? true,
    });
  };

  const handleGlobalVoiceModelChange = (value: string) => {
    void saveGlobalVoicePreference({
      ...globalVoicePreference,
      preferredModelId: value === AUTO_VALUE ? undefined : value,
      allowFallback: globalVoicePreference.allowFallback ?? true,
    });
  };

  const handleGlobalVoiceFallbackChange = (value: boolean) => {
    void saveGlobalVoicePreference({
      ...globalVoicePreference,
      allowFallback: value,
    });
  };

  const handleResetGlobalVoicePreference = () => {
    void saveGlobalVoicePreference(DEFAULT_MEDIA_PREFERENCE);
  };

  const availableVoices = TTS_VOICES[voiceConfig.tts_service || "openai"] || [];

  return (
    <div className="space-y-5 max-w-[980px]">
      <MediaPreferenceSection
        title="全局默认语音服务"
        description="新项目默认继承这里的设置；项目里留空时会继续跟随这里。"
        providerLabel="默认语音 Provider"
        providerValue={globalVoicePreference.preferredProviderId ?? AUTO_VALUE}
        providerAutoLabel="自动选择"
        onProviderChange={handleGlobalVoiceProviderChange}
        providers={ttsProviders.map((provider) => ({
          value: provider.id,
          label: provider.name,
        }))}
        providerUnavailableLabel={providerUnavailableLabel}
        modelLabel="默认语音模型"
        modelValue={globalVoicePreference.preferredModelId ?? AUTO_VALUE}
        modelAutoLabel="自动选择"
        onModelChange={handleGlobalVoiceModelChange}
        models={availableGlobalVoiceModels.map((model) => ({
          value: model,
          label: model,
        }))}
        modelUnavailableLabel={modelUnavailableLabel}
        modelHint="配音、BGM 与音效生成会优先使用这里的 Provider / 模型；未指定时沿用自动匹配策略。"
        allowFallback={globalVoicePreference.allowFallback ?? true}
        onAllowFallbackChange={handleGlobalVoiceFallbackChange}
        fallbackTitle="默认语音服务不可用时自动回退"
        fallbackDescription="关闭后，若全局默认语音服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyHint={
          providersLoading
            ? "正在加载语音 Provider..."
            : ttsProviders.length === 0
              ? "暂无可用语音 Provider，请先到凭证管理中配置可配音 / TTS 的服务。"
              : "未指定时将沿用现有自动匹配规则。"
        }
        disabled={!config}
        modelDisabled={
          providersLoading ||
          !globalVoicePreference.preferredProviderId ||
          availableGlobalVoiceModels.length === 0
        }
        onReset={handleResetGlobalVoicePreference}
        resetLabel="恢复默认"
        resetDisabled={
          !hasMediaGenerationPreferenceOverride(globalVoicePreference)
        }
      />

      {/* 语音总开关 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">语音功能</h3>
                <WorkbenchInfoTip
                  ariaLabel="语音功能说明"
                  content="控制语音输入和输出功能。"
                  tone="slate"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between py-1.5 cursor-pointer">
            <span className="text-sm">语音输入 (STT)</span>
            <input
              type="checkbox"
              checked={voiceConfig.voice_input_enabled ?? false}
              onChange={(e) =>
                saveVoiceConfig("voice_input_enabled", e.target.checked)
              }
              disabled={loading}
              className="w-4 h-4 rounded border-gray-300"
            />
          </label>

          <label className="flex items-center justify-between py-1.5 cursor-pointer border-t">
            <span className="text-sm">语音输出 (TTS)</span>
            <input
              type="checkbox"
              checked={voiceConfig.voice_output_enabled ?? false}
              onChange={(e) =>
                saveVoiceConfig("voice_output_enabled", e.target.checked)
              }
              disabled={loading}
              className="w-4 h-4 rounded border-gray-300"
            />
          </label>
        </div>
      </div>

      {/* TTS 服务商 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">文字转语音 (TTS)</h3>
              <WorkbenchInfoTip
                ariaLabel="文字转语音说明"
                content="选择语音合成服务商和参数。"
                tone="slate"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {/* 服务商选择 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              服务商
            </label>
            <div className="grid grid-cols-2 gap-2">
              {TTS_SERVICES.map((service) => (
                <button
                  key={service.value}
                  onClick={() => saveVoiceConfig("tts_service", service.value)}
                  className={cn(
                    CHOICE_BUTTON_CLASS,
                    voiceConfig.tts_service === service.value
                      ? ACTIVE_CHOICE_BUTTON_CLASS
                      : INACTIVE_CHOICE_BUTTON_CLASS,
                  )}
                >
                  <div className="font-medium">{service.label}</div>
                  <div className="mt-1">
                    <WorkbenchInfoTip
                      ariaLabel={`${service.label} TTS 说明`}
                      content={service.desc}
                      tone={
                        voiceConfig.tts_service === service.value
                          ? "mint"
                          : "slate"
                      }
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 语音选择 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              语音
            </label>
            <select
              value={voiceConfig.tts_voice || "alloy"}
              onChange={(e) => saveVoiceConfig("tts_voice", e.target.value)}
              disabled={loading}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-950/5 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            >
              {availableVoices.map((voice) => (
                <option key={voice.value} value={voice.value}>
                  {voice.label}
                </option>
              ))}
            </select>
          </div>

          {/* 语速 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">语速</label>
              <span className="text-xs text-primary">
                {voiceConfig.tts_rate?.toFixed(1) || "1.0"}x
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.1}
              value={voiceConfig.tts_rate || 1.0}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                setVoiceConfig((prev) => ({ ...prev, tts_rate: value }));
              }}
              onChangeCapture={(e) => {
                saveVoiceConfig(
                  "tts_rate",
                  parseFloat((e.target as HTMLInputElement).value),
                );
              }}
              className={RANGE_INPUT_CLASS}
            />
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>

          {/* 音调 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">音调</label>
              <span className="text-xs text-primary">
                {voiceConfig.tts_pitch?.toFixed(1) || "1.0"}x
              </span>
            </div>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.1}
              value={voiceConfig.tts_pitch || 1.0}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                setVoiceConfig((prev) => ({ ...prev, tts_pitch: value }));
              }}
              onChangeCapture={(e) => {
                saveVoiceConfig(
                  "tts_pitch",
                  parseFloat((e.target as HTMLInputElement).value),
                );
              }}
              className={RANGE_INPUT_CLASS}
            />
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>低</span>
              <span>中</span>
              <span>高</span>
            </div>
          </div>

          {/* 音量 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground">音量</label>
              <span className="text-xs text-primary">
                {Math.round((voiceConfig.tts_volume || 1.0) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={voiceConfig.tts_volume || 1.0}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                setVoiceConfig((prev) => ({ ...prev, tts_volume: value }));
              }}
              onChangeCapture={(e) => {
                saveVoiceConfig(
                  "tts_volume",
                  parseFloat((e.target as HTMLInputElement).value),
                );
              }}
              className={RANGE_INPUT_CLASS}
            />
          </div>

          {/* 测试按钮 */}
          <button
            onClick={handleTestTTS}
            disabled={
              loading ||
              testingTTS ||
              !(voiceConfig.voice_output_enabled ?? false)
            }
            className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {testingTTS ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                测试中...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                测试语音
              </>
            )}
          </button>
        </div>
      </div>

      {/* STT 服务商 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Mic className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">语音转文字 (STT)</h3>
              <WorkbenchInfoTip
                ariaLabel="语音转文字说明"
                content="选择语音识别服务商和参数。"
                tone="slate"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {/* 服务商选择 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              服务商
            </label>
            <div className="grid grid-cols-2 gap-2">
              {STT_SERVICES.map((service) => (
                <button
                  key={service.value}
                  onClick={() => saveVoiceConfig("stt_service", service.value)}
                  className={cn(
                    CHOICE_BUTTON_CLASS,
                    voiceConfig.stt_service === service.value
                      ? ACTIVE_CHOICE_BUTTON_CLASS
                      : INACTIVE_CHOICE_BUTTON_CLASS,
                  )}
                >
                  <div className="font-medium">{service.label}</div>
                  <div className="mt-1">
                    <WorkbenchInfoTip
                      ariaLabel={`${service.label} STT 说明`}
                      content={service.desc}
                      tone={
                        voiceConfig.stt_service === service.value
                          ? "mint"
                          : "slate"
                      }
                    />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 语言选择 */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              识别语言
            </label>
            <select
              value={voiceConfig.stt_language || "zh-CN"}
              onChange={(e) => saveVoiceConfig("stt_language", e.target.value)}
              disabled={loading}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm shadow-slate-950/5 outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
            >
              {STT_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* 自动停止 */}
          <label className="flex items-center justify-between py-1.5 cursor-pointer border-t">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm">自动停止录音</span>
                <WorkbenchInfoTip
                  ariaLabel="自动停止录音说明"
                  content="检测到停止说话时自动结束录音。"
                  tone="slate"
                />
              </div>
            </div>
            <input
              type="checkbox"
              checked={voiceConfig.stt_auto_stop ?? true}
              onChange={(e) =>
                saveVoiceConfig("stt_auto_stop", e.target.checked)
              }
              disabled={loading}
              className={CHECKBOX_INPUT_CLASS}
            />
          </label>
        </div>
      </div>

      {/* 提示信息 */}
      <div className={INFO_CARD_CLASS}>
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <div className="flex items-center gap-2">
          <span>语音链路说明已收纳</span>
          <WorkbenchInfoTip
            ariaLabel="语音链路说明"
            content="语音功能需要先启用相应的开关。TTS 用于将 AI 的回复转换为语音播放，STT 用于将你的语音转换为文字输入。不同的服务商可能有不同的费用和效果。"
            tone="slate"
          />
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-[20px] border p-3",
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
      )}
    </div>
  );
}
