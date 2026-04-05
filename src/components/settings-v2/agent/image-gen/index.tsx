/**
 * 绘画服务集成设置组件
 *
 * 参考成熟产品的图像能力实现
 * 功能包括：图像生成服务商选择、默认参数配置等
 */

import { useState, useEffect, useMemo } from "react";
import {
  Image as ImageIcon,
  Palette,
  Settings2,
  Info,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import {
  buildPersistedMediaGenerationPreference,
  hasMediaGenerationPreferenceOverride,
  type MediaGenerationPreference,
} from "@/lib/mediaGeneration";
import {
  getImageModelsForProvider,
  isImageProvider,
} from "@/lib/imageGeneration";
import { MediaPreferenceSection } from "../shared/MediaPreferenceSection";

type ImageService = "dall_e" | "midjourney" | "stable_diffusion" | "flux";

interface ImageGenConfig {
  /** 默认图像生成服务 */
  default_service?: ImageService;
  /** 默认图像数量 */
  default_count?: number;
  /** 默认图像尺寸 */
  default_size?:
    | "256x256"
    | "512x512"
    | "1024x1024"
    | "1792x1024"
    | "1024x1792";
  /** 默认图像质量 */
  default_quality?: "standard" | "hd";
  /** 默认图像风格 */
  default_style?: "vivid" | "natural";
  /** 启用图像增强 */
  enable_enhancement?: boolean;
  /** 自动下载生成的图像 */
  auto_download?: boolean;
}

const DEFAULT_IMAGE_GEN_CONFIG: ImageGenConfig = {
  default_service: "dall_e",
  default_count: 1,
  default_size: "1024x1024",
  default_quality: "standard",
  default_style: "vivid",
  enable_enhancement: false,
  auto_download: false,
};

const IMAGE_SERVICES = [
  {
    value: "dall_e" as ImageService,
    label: "DALL·E",
    desc: "OpenAI 的图像生成模型",
  },
  {
    value: "midjourney" as ImageService,
    label: "Midjourney",
    desc: "高质量艺术图像生成",
  },
  {
    value: "stable_diffusion" as ImageService,
    label: "Stable Diffusion",
    desc: "开源图像生成模型",
  },
  { value: "flux" as ImageService, label: "Flux", desc: "新一代图像生成模型" },
];

const IMAGE_SIZES = [
  { value: "256x256", label: "256×256", desc: "小尺寸" },
  { value: "512x512", label: "512×512", desc: "中等尺寸" },
  { value: "1024x1024", label: "1024×1024", desc: "标准尺寸" },
  { value: "1792x1024", label: "1792×1024", desc: "横向宽屏" },
  { value: "1024x1792", label: "1024×1792", desc: "纵向竖屏" },
];

const IMAGE_QUALITIES = [
  { value: "standard", label: "标准", desc: "标准质量，生成速度快" },
  { value: "hd", label: "高清", desc: "高清质量，细节更丰富" },
];

const IMAGE_STYLES = [
  { value: "vivid", label: "生动", desc: "更鲜艳、更富有表现力" },
  { value: "natural", label: "自然", desc: "更自然、更真实" },
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
  "border-slate-900 bg-slate-900 text-white shadow-sm shadow-slate-950/10";
const INACTIVE_CHOICE_BUTTON_CLASS =
  "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
const INFO_CARD_CLASS =
  "flex items-start gap-2 rounded-[22px] border border-slate-200/80 bg-slate-50/85 p-4 text-xs leading-6 text-slate-600";

export function ImageGenSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [imageConfig, setImageConfig] = useState<ImageGenConfig>(
    DEFAULT_IMAGE_GEN_CONFIG,
  );
  const [loading, setLoading] = useState(true);
  const [_saving, setSaving] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const { providers, loading: providersLoading } = useApiKeyProvider();
  const [globalImagePreference, setGlobalImagePreference] =
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
      setImageConfig(c.image_gen || DEFAULT_IMAGE_GEN_CONFIG);
      setGlobalImagePreference(
        c.workspace_preferences?.media_defaults?.image ??
          DEFAULT_MEDIA_PREFERENCE,
      );
    } catch (e) {
      console.error("加载绘画服务配置失败:", e);
    } finally {
      setLoading(false);
    }
  };

  // 保存配置
  const saveImageConfig = async (key: keyof ImageGenConfig, value: any) => {
    if (!config) return;
    setSaving((prev) => ({ ...prev, [key]: true }));

    try {
      const newConfig = {
        ...imageConfig,
        [key]: value,
      };
      const updatedFullConfig = {
        ...config,
        image_gen: newConfig,
      };
      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setImageConfig(newConfig);

      showMessage("success", "设置已保存");
    } catch (e) {
      console.error("保存绘画服务配置失败:", e);
      showMessage("error", "保存失败");
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const saveGlobalImagePreference = async (
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
            image: persistedPreference,
          },
        },
      };
      await saveConfig(updatedFullConfig);
      setConfig(updatedFullConfig);
      setGlobalImagePreference(nextPreference);
      showMessage("success", "设置已保存");
    } catch (e) {
      console.error("保存全局图片服务配置失败:", e);
      showMessage("error", "保存失败");
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const imageProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isImageProvider(provider.id, provider.type),
      ),
    [providers],
  );

  const selectedGlobalImageProvider = useMemo(
    () =>
      imageProviders.find(
        (provider) => provider.id === globalImagePreference.preferredProviderId,
      ) ?? null,
    [globalImagePreference.preferredProviderId, imageProviders],
  );

  const availableGlobalImageModels = useMemo(() => {
    if (!selectedGlobalImageProvider) {
      return [];
    }
    return getImageModelsForProvider(
      selectedGlobalImageProvider.id,
      selectedGlobalImageProvider.type,
      selectedGlobalImageProvider.custom_models,
      selectedGlobalImageProvider.api_host,
    );
  }, [selectedGlobalImageProvider]);

  const providerUnavailableLabel =
    globalImagePreference.preferredProviderId && !selectedGlobalImageProvider
      ? "当前配置不可用：" + globalImagePreference.preferredProviderId
      : undefined;

  const modelUnavailableLabel =
    globalImagePreference.preferredModelId &&
    !availableGlobalImageModels.some(
      (model) => model.id === globalImagePreference.preferredModelId,
    )
      ? "当前配置不可用：" + globalImagePreference.preferredModelId
      : undefined;

  const handleGlobalImageProviderChange = (value: string) => {
    const preferredProviderId = value === AUTO_VALUE ? undefined : value;
    const nextProvider = imageProviders.find(
      (provider) => provider.id === preferredProviderId,
    );
    const nextModels = nextProvider
      ? getImageModelsForProvider(
          nextProvider.id,
          nextProvider.type,
          nextProvider.custom_models,
          nextProvider.api_host,
        )
      : [];
    const preferredModelId = preferredProviderId
      ? nextModels.some(
          (model) => model.id === globalImagePreference.preferredModelId,
        )
        ? globalImagePreference.preferredModelId
        : nextModels[0]?.id
      : undefined;

    void saveGlobalImagePreference({
      preferredProviderId,
      preferredModelId,
      allowFallback: globalImagePreference.allowFallback ?? true,
    });
  };

  const handleGlobalImageModelChange = (value: string) => {
    void saveGlobalImagePreference({
      ...globalImagePreference,
      preferredModelId: value === AUTO_VALUE ? undefined : value,
      allowFallback: globalImagePreference.allowFallback ?? true,
    });
  };

  const handleGlobalImageFallbackChange = (value: boolean) => {
    void saveGlobalImagePreference({
      ...globalImagePreference,
      allowFallback: value,
    });
  };

  const handleResetGlobalImagePreference = () => {
    void saveGlobalImagePreference(DEFAULT_MEDIA_PREFERENCE);
  };

  return (
    <div className="space-y-5 max-w-[980px]">
      <div className={INFO_CARD_CLASS}>
        <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <p>
          这里配置的是全局默认图片服务与常用出图参数。新项目会优先继承这些默认值，未单独覆盖时也会继续跟随这里。
        </p>
      </div>

      <MediaPreferenceSection
        title="全局默认图片服务"
        description="新项目默认继承这里的设置；项目里留空时会继续跟随这里。"
        providerLabel="默认图片 Provider"
        providerValue={globalImagePreference.preferredProviderId ?? AUTO_VALUE}
        providerAutoLabel="自动选择"
        onProviderChange={handleGlobalImageProviderChange}
        providers={imageProviders.map((provider) => ({
          value: provider.id,
          label: provider.name,
        }))}
        providerUnavailableLabel={providerUnavailableLabel}
        modelLabel="默认图片模型"
        modelValue={globalImagePreference.preferredModelId ?? AUTO_VALUE}
        modelAutoLabel="自动选择"
        onModelChange={handleGlobalImageModelChange}
        models={availableGlobalImageModels.map((model) => ({
          value: model.id,
          label: model.name,
        }))}
        modelUnavailableLabel={modelUnavailableLabel}
        modelHint="仅在指定全局默认图片 Provider 时生效；未指定模型时沿用自动匹配策略。"
        allowFallback={globalImagePreference.allowFallback ?? true}
        onAllowFallbackChange={handleGlobalImageFallbackChange}
        fallbackTitle="默认图片服务不可用时自动回退"
        fallbackDescription="关闭后，若全局默认图片服务缺失、被禁用或无可用 Key，将直接提示错误。"
        emptyHint={
          providersLoading
            ? "正在加载图片 Provider..."
            : imageProviders.length === 0
              ? "暂无可用图片 Provider，请先到凭证管理中配置可出图服务。"
              : "未指定时将沿用现有自动匹配规则。"
        }
        disabled={!config}
        modelDisabled={
          providersLoading ||
          !globalImagePreference.preferredProviderId ||
          availableGlobalImageModels.length === 0
        }
        onReset={handleResetGlobalImagePreference}
        resetLabel="恢复默认"
        resetDisabled={
          !hasMediaGenerationPreferenceOverride(globalImagePreference)
        }
      />

      {/* 服务商选择 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">默认图像生成服务</h3>
            <p className="text-xs text-muted-foreground">
              选择默认使用的图像生成服务商
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {IMAGE_SERVICES.map((service) => (
            <button
              key={service.value}
              onClick={() => saveImageConfig("default_service", service.value)}
              className={cn(
                "px-3 py-2 rounded-lg text-sm font-medium transition-colors border text-left",
                CHOICE_BUTTON_CLASS,
                imageConfig.default_service === service.value
                  ? ACTIVE_CHOICE_BUTTON_CLASS
                  : INACTIVE_CHOICE_BUTTON_CLASS,
              )}
            >
              <div className="font-medium">{service.label}</div>
              <div className="text-xs opacity-80">{service.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 默认图像数量 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-medium">默认图像数量</h3>
              <p className="text-xs text-muted-foreground">
                每次生成的图像数量
              </p>
            </div>
          </div>
          <span className="text-sm font-semibold text-slate-900">
            {imageConfig.default_count || 1}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((count) => (
            <button
              key={count}
              onClick={() => saveImageConfig("default_count", count)}
              className={cn(
                CHOICE_BUTTON_CLASS,
                imageConfig.default_count === count
                  ? ACTIVE_CHOICE_BUTTON_CLASS
                  : INACTIVE_CHOICE_BUTTON_CLASS,
              )}
            >
              {count}
            </button>
          ))}
        </div>
      </div>

      {/* 默认图像尺寸 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-medium">默认图像尺寸</h3>
            <p className="text-xs text-muted-foreground">
              选择生成图像的默认尺寸
            </p>
          </div>
          <span className="text-sm font-semibold text-slate-900">
            {imageConfig.default_size || "1024x1024"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {IMAGE_SIZES.map((size) => (
            <button
              key={size.value}
              onClick={() => saveImageConfig("default_size", size.value)}
              className={cn(
                CHOICE_BUTTON_CLASS,
                imageConfig.default_size === size.value
                  ? ACTIVE_CHOICE_BUTTON_CLASS
                  : INACTIVE_CHOICE_BUTTON_CLASS,
              )}
            >
              <div className="font-medium">{size.label}</div>
              <div className="text-xs opacity-80">{size.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 图像质量 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">图像质量</h3>
            <p className="text-xs text-muted-foreground">
              选择生成图像的质量级别
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {IMAGE_QUALITIES.map((quality) => (
            <button
              key={quality.value}
              onClick={() => saveImageConfig("default_quality", quality.value)}
              className={cn(
                CHOICE_BUTTON_CLASS,
                imageConfig.default_quality === quality.value
                  ? ACTIVE_CHOICE_BUTTON_CLASS
                  : INACTIVE_CHOICE_BUTTON_CLASS,
              )}
            >
              <div className="font-medium">{quality.label}</div>
              <div className="text-xs opacity-80">{quality.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 图像风格 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">图像风格</h3>
            <p className="text-xs text-muted-foreground">
              选择生成图像的默认风格
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {IMAGE_STYLES.map((style) => (
            <button
              key={style.value}
              onClick={() => saveImageConfig("default_style", style.value)}
              className={cn(
                CHOICE_BUTTON_CLASS,
                imageConfig.default_style === style.value
                  ? ACTIVE_CHOICE_BUTTON_CLASS
                  : INACTIVE_CHOICE_BUTTON_CLASS,
              )}
            >
              <div className="font-medium">{style.label}</div>
              <div className="text-xs opacity-80">{style.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 其他选项 */}
      <div className={PANEL_CARD_CLASS}>
        <div className="flex items-center gap-2 mb-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">其他选项</h3>
            <p className="text-xs text-muted-foreground">
              配置图像生成的其他行为
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between py-1.5 cursor-pointer">
            <div>
              <span className="text-sm">启用图像增强</span>
              <p className="text-xs text-muted-foreground">
                自动对生成的图像进行增强处理
              </p>
            </div>
            <input
              type="checkbox"
              checked={imageConfig.enable_enhancement ?? false}
              onChange={(e) =>
                saveImageConfig("enable_enhancement", e.target.checked)
              }
              disabled={loading}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
          </label>

          <label className="flex items-center justify-between py-1.5 cursor-pointer border-t">
            <div>
              <span className="text-sm">自动下载图像</span>
              <p className="text-xs text-muted-foreground">
                生成完成后自动下载到本地
              </p>
            </div>
            <input
              type="checkbox"
              checked={imageConfig.auto_download ?? false}
              onChange={(e) =>
                saveImageConfig("auto_download", e.target.checked)
              }
              disabled={loading}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
          </label>
        </div>
      </div>

      {/* 提示信息 */}
      <div className={INFO_CARD_CLASS}>
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <p>
          不同的图像生成服务商支持的功能和参数可能不同。某些服务商可能不支持特定的尺寸或质量选项。
          实际生成的效果取决于所选服务商的能力。
        </p>
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
