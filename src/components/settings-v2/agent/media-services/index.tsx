import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Pencil } from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getConfig,
  saveConfig,
  type Config,
  type ServiceModelPreferenceConfig,
  type ServiceModelsConfig,
} from "@/lib/api/appConfig";
import { modelSupportsTaskFamily } from "@/lib/model/inferModelCapabilities";
import type { ModelTaskFamily } from "@/lib/types/modelRegistry";
import {
  buildPersistedServiceModelPreference,
  normalizeServiceModelPreference,
} from "@/lib/serviceModels";
import { cn } from "@/lib/utils";
import { ImageGenSettings } from "../image-gen";
import { SettingModelSelectorField } from "../shared/SettingModelSelectorField";
import { VideoGenSettings } from "../video-gen";
import { VoiceSettings } from "../voice";

const DEFAULT_IMAGE_COUNT = 2;
const MIN_IMAGE_COUNT = 1;
const MAX_IMAGE_COUNT = 6;

type ServiceModelKey =
  | "topic"
  | "generation_topic"
  | "translation"
  | "history_compress"
  | "agent_meta"
  | "input_completion"
  | "prompt_rewrite"
  | "resource_prompt_rewrite";

interface ServiceModelSectionDefinition {
  key: ServiceModelKey;
  title: string;
  description: string;
  modelHint: string;
  taskFamilies: ModelTaskFamily[];
  supportsModelSelection?: boolean;
  allowDisable?: boolean;
  allowCustomPrompt?: boolean;
  emptyHint?: string;
}

const SERVICE_MODEL_SECTIONS: ServiceModelSectionDefinition[] = [
  {
    key: "topic",
    title: "话题自动命名助理",
    description: "指定用于会话话题自动命名的模型。",
    modelHint: "默认使用对话或推理模型；未显式指定时沿用自动选择。",
    taskFamilies: ["chat", "reasoning"],
  },
  {
    key: "generation_topic",
    title: "AI 图片话题命名助理",
    description: "指定用于图片任务自动命名话题的模型，优先使用视觉理解模型。",
    modelHint:
      "优先展示视觉理解模型；若当前没有 VLM，会自动回退到通用对话模型。",
    taskFamilies: ["vision_understanding", "chat", "reasoning"],
  },
  {
    key: "translation",
    title: "消息内容翻译助理",
    description: "指定用于翻译消息内容的模型。",
    modelHint: "适合选择稳定的对话或推理模型。",
    taskFamilies: ["chat", "reasoning"],
  },
  {
    key: "history_compress",
    title: "会话历史压缩助理",
    description: "指定用于压缩会话历史上下文的模型。",
    modelHint: "适合选择长上下文、稳定输出的对话模型。",
    taskFamilies: ["chat", "reasoning"],
  },
  {
    key: "agent_meta",
    title: "助理信息生成助理",
    description: "指定用于生成助理名称、简介与标签等信息的模型。",
    modelHint: "适合选择善于总结与命名的通用模型。",
    taskFamilies: ["chat", "reasoning"],
  },
  {
    key: "input_completion",
    title: "输入自动补全助理",
    description: "控制输入联想、补全面板与快捷能力提示是否启用。",
    modelHint: "当前主链只消费启停开关，不再展示未接入执行面的模型选择。",
    taskFamilies: ["chat", "reasoning"],
    supportsModelSelection: false,
    allowDisable: true,
  },
  {
    key: "prompt_rewrite",
    title: "提示词重写助理",
    description: "指定用于重写与润色提示词的模型。",
    modelHint: "关闭后，将直接使用原始输入，不再自动重写提示词。",
    taskFamilies: ["chat", "reasoning"],
    allowDisable: true,
  },
  {
    key: "resource_prompt_rewrite",
    title: "项目资料提词重写助理",
    description: "指定用于基于项目资料上下文改写提问的模型。",
    modelHint: "关闭后，项目资料提问不会再自动补全上下文重写。",
    taskFamilies: ["chat", "reasoning"],
    allowDisable: true,
    allowCustomPrompt: true,
  },
];

function getSectionPreference(
  config: Config | null,
  key: ServiceModelKey,
): ServiceModelPreferenceConfig {
  return normalizeServiceModelPreference(
    config?.workspace_preferences?.service_models?.[key],
  );
}

function SettingCard({
  title,
  description,
  children,
  headerExtra,
  dimmed = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  headerExtra?: ReactNode;
  dimmed?: boolean;
}) {
  return (
    <section
      className={cn(
        "overflow-visible rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5",
        dimmed && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            {title}
          </h3>
          <WorkbenchInfoTip
            ariaLabel={`${title}说明`}
            content={description}
            tone="slate"
          />
        </div>
        {headerExtra}
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
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-800">{label}</Label>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MediaServicesSettings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [promptEditors, setPromptEditors] = useState<
    Partial<Record<ServiceModelKey, boolean>>
  >({});
  const [promptDrafts, setPromptDrafts] = useState<
    Partial<Record<ServiceModelKey, string>>
  >({});
  const [imageCountDraft, setImageCountDraft] = useState(DEFAULT_IMAGE_COUNT);
  const [imageCountInput, setImageCountInput] = useState(
    String(DEFAULT_IMAGE_COUNT),
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextConfig = await getConfig();
        if (cancelled) {
          return;
        }

        setConfig(nextConfig);
        const nextImageCount =
          nextConfig.image_gen?.default_count ?? DEFAULT_IMAGE_COUNT;
        setImageCountDraft(nextImageCount);
        setImageCountInput(String(nextImageCount));
        setPromptDrafts({
          resource_prompt_rewrite:
            nextConfig.workspace_preferences?.service_models
              ?.resource_prompt_rewrite?.customPrompt ?? "",
        });
      } catch (error) {
        console.error("加载服务模型配置失败:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const persistConfig = async (updater: (current: Config) => Config) => {
    if (!config) {
      return;
    }

    try {
      const nextConfig = updater(config);
      await saveConfig(nextConfig);
      setConfig(nextConfig);
      showMessage("success", "设置已保存");
    } catch (error) {
      console.error("保存服务模型配置失败:", error);
      showMessage("error", "保存失败");
    }
  };

  const updateServiceModelPreference = (
    key: ServiceModelKey,
    nextPreference: ServiceModelPreferenceConfig,
  ) => {
    void persistConfig((currentConfig) => {
      const nextServiceModels: ServiceModelsConfig = {
        ...(currentConfig.workspace_preferences?.service_models ?? {}),
      };
      const persistedPreference =
        buildPersistedServiceModelPreference(nextPreference);

      if (persistedPreference) {
        nextServiceModels[key] = persistedPreference;
      } else {
        delete nextServiceModels[key];
      }

      return {
        ...currentConfig,
        workspace_preferences: {
          ...currentConfig.workspace_preferences,
          service_models: nextServiceModels,
        },
      };
    });
  };

  const updateImageGenConfig = (
    patch: Partial<NonNullable<Config["image_gen"]>>,
  ) => {
    void persistConfig((currentConfig) => ({
      ...currentConfig,
      image_gen: {
        ...currentConfig.image_gen,
        ...patch,
      },
    }));
  };

  const clampImageCount = (value: number) =>
    Math.min(MAX_IMAGE_COUNT, Math.max(MIN_IMAGE_COUNT, Math.round(value)));

  const commitImageCount = (rawValue: string | number) => {
    const parsed =
      typeof rawValue === "number" ? rawValue : Number.parseInt(rawValue, 10);
    const nextCount = Number.isFinite(parsed)
      ? clampImageCount(parsed)
      : (config?.image_gen?.default_count ?? DEFAULT_IMAGE_COUNT);

    setImageCountDraft(nextCount);
    setImageCountInput(String(nextCount));
    updateImageGenConfig({ default_count: nextCount });
  };

  const sectionViews = useMemo(() => {
    return SERVICE_MODEL_SECTIONS.map((section) => {
      const preference = getSectionPreference(config, section.key);

      return {
        section,
        preference,
        disabled: Boolean(section.allowDisable && preference.enabled === false),
      };
    });
  }, [config]);

  return (
    <div className="max-w-[860px] space-y-5 pb-8">
      <section className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
            服务模型
          </h1>
          <WorkbenchInfoTip
            ariaLabel="服务模型总览说明"
            content="统一管理当前已经接入主链的命名、翻译、提词重写与媒体生成默认模型，继续复用本地、自管云端和品牌云端同一套模型 taxonomy。"
            tone="mint"
          />
        </div>
        <p className="text-sm text-slate-500">
          只保留当前已接入调用链的服务模型默认项，整页统一复用同一套模型选择组件。
        </p>
      </section>

      {sectionViews.map(({ section, preference, disabled }) => {
        const promptVisible =
          Boolean(section.allowCustomPrompt) &&
          (Boolean(preference.customPrompt) || promptEditors[section.key]);
        const promptDraft =
          promptDrafts[section.key] ?? preference.customPrompt ?? "";

        return (
          <SettingCard
            key={section.key}
            title={section.title}
            description={section.description}
            dimmed={disabled}
            headerExtra={
              section.allowDisable ? (
                <Switch
                  checked={preference.enabled ?? true}
                  disabled={!config}
                  onCheckedChange={(enabled) => {
                    updateServiceModelPreference(section.key, {
                      ...preference,
                      enabled,
                    });
                  }}
                />
              ) : undefined
            }
          >
            {section.supportsModelSelection === false ? (
              <SettingRow label="当前行为" description={section.modelHint}>
                <div className="rounded-[18px] border border-slate-200/80 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
                  当前输入补全链只消费启停开关，避免继续暴露未接入执行面的模型选择。
                </div>
              </SettingRow>
            ) : (
              <SettingModelSelectorField
                label="服务模型"
                description={section.modelHint}
                disabled={!config || disabled}
                emptyStateTitle="暂无可用服务模型"
                emptyStateDescription={
                  section.emptyHint ??
                  "当前没有符合该能力的模型；请先在 AI 服务商里配置对应模型。"
                }
                providerType={preference.preferredProviderId ?? ""}
                setProviderType={(value) => {
                  const preferredProviderId = value.trim() || undefined;
                  updateServiceModelPreference(section.key, {
                    ...preference,
                    preferredProviderId,
                    preferredModelId:
                      preferredProviderId &&
                      preferredProviderId === preference.preferredProviderId
                        ? preference.preferredModelId
                        : undefined,
                  });
                }}
                model={preference.preferredModelId ?? ""}
                setModel={(value) => {
                  updateServiceModelPreference(section.key, {
                    ...preference,
                    preferredModelId: value.trim() || undefined,
                  });
                }}
                modelFilter={(model) =>
                  section.taskFamilies.some((taskFamily) =>
                    modelSupportsTaskFamily(model, taskFamily),
                  )
                }
              />
            )}

            {section.allowCustomPrompt ? (
              <SettingRow
                label="自定义提示词"
                description="填写后，系统助理将在生成内容时继续使用这里的自定义提示词。"
              >
                {promptVisible ? (
                  <Textarea
                    value={promptDraft}
                    disabled={!config || disabled}
                    placeholder="输入自定义提示词"
                    className="min-h-[120px] rounded-2xl border-slate-200 bg-white text-sm text-slate-900 shadow-none focus-visible:ring-slate-300"
                    onChange={(event) => {
                      setPromptDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [section.key]: event.target.value,
                      }));
                    }}
                    onBlur={(event) => {
                      const nextPrompt = event.target.value.trim() || undefined;
                      updateServiceModelPreference(section.key, {
                        ...preference,
                        customPrompt: nextPrompt,
                      });
                      setPromptEditors((currentEditors) => ({
                        ...currentEditors,
                        [section.key]: Boolean(nextPrompt),
                      }));
                    }}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!config || disabled}
                    className="h-11 w-full rounded-2xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setPromptEditors((currentEditors) => ({
                        ...currentEditors,
                        [section.key]: true,
                      }));
                      setPromptDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [section.key]: preference.customPrompt ?? "",
                      }));
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    添加自定义提示词
                  </Button>
                )}
              </SettingRow>
            ) : null}
          </SettingCard>
        );
      })}

      <SettingCard
        title="AI 图片设置"
        description="统一管理图片生成任务的默认数量。"
      >
        <SettingRow
          label="默认图片数量"
          description="设置图像生成面板在创建新任务时的默认图片数量。"
        >
          <div className="flex items-center gap-4">
            <Slider
              value={[imageCountDraft]}
              min={MIN_IMAGE_COUNT}
              max={MAX_IMAGE_COUNT}
              step={1}
              disabled={!config}
              className="flex-1"
              onValueChange={(values) => {
                const nextCount = values[0] ?? DEFAULT_IMAGE_COUNT;
                setImageCountDraft(nextCount);
                setImageCountInput(String(nextCount));
              }}
              onValueCommit={(values) => {
                commitImageCount(values[0] ?? DEFAULT_IMAGE_COUNT);
              }}
            />
            <Input
              type="number"
              min={MIN_IMAGE_COUNT}
              max={MAX_IMAGE_COUNT}
              inputMode="numeric"
              value={imageCountInput}
              disabled={!config}
              className="h-11 w-20 rounded-2xl border-slate-200 bg-white text-center text-slate-900 shadow-none focus-visible:ring-slate-300"
              onChange={(event) => {
                const rawValue = event.target.value;
                setImageCountInput(rawValue);

                if (!rawValue.trim()) {
                  return;
                }

                const parsed = Number.parseInt(rawValue, 10);
                if (Number.isFinite(parsed)) {
                  setImageCountDraft(clampImageCount(parsed));
                }
              }}
              onBlur={(event) => {
                commitImageCount(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </div>
        </SettingRow>
      </SettingCard>

      <ImageGenSettings />
      <VideoGenSettings />
      <VoiceSettings />

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
