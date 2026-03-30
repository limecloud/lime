/**
 * @file SettingsTab.tsx
 * @description 项目设置 Tab 组件，管理项目基本设置
 * @module components/projects/tabs/SettingsTab
 * @requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import { useState, useEffect, useMemo } from "react";
import { useProject } from "@/hooks/useProject";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { usePersonas } from "@/hooks/usePersonas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SaveIcon, ArchiveIcon, AlertTriangleIcon } from "lucide-react";
import type { WorkspaceSettings } from "@/types/workspace";
import {
  getImageModelsForProvider,
  isImageProvider,
} from "@/lib/imageGeneration";
import {
  getTtsModelsForProvider,
  getVideoModelsForProvider,
  isTtsProvider,
  isVideoProvider,
} from "@/lib/mediaGeneration";

export interface SettingsTabProps {
  /** 项目 ID */
  projectId: string;
  /** 项目类型 */
  workspaceType?: string;
}

/** 项目图标选项 */
const ICON_OPTIONS = [
  { value: "📝", label: "📝 笔记" },
  { value: "📚", label: "📚 书籍" },
  { value: "💡", label: "💡 创意" },
  { value: "🎯", label: "🎯 目标" },
  { value: "🚀", label: "🚀 项目" },
  { value: "🎨", label: "🎨 设计" },
  { value: "📱", label: "📱 应用" },
  { value: "🌟", label: "🌟 精选" },
];

const AUTO_IMAGE_PROVIDER_VALUE = "__auto_image_provider__";
const AUTO_IMAGE_MODEL_VALUE = "__auto_image_model__";

/**
 * 项目设置 Tab 组件
 *
 * 管理项目基本信息、默认人设、归档。
 */
export function SettingsTab({ projectId, workspaceType }: SettingsTabProps) {
  const { project, loading, update, archive } = useProject(projectId);
  const { providers, loading: providersLoading } = useApiKeyProvider();
  const { personas } = usePersonas(projectId);

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("📝");
  const [defaultPersonaId, setDefaultPersonaId] = useState("");
  const [preferredImageProviderId, setPreferredImageProviderId] = useState(
    AUTO_IMAGE_PROVIDER_VALUE,
  );
  const [preferredImageModelId, setPreferredImageModelId] = useState(
    AUTO_IMAGE_MODEL_VALUE,
  );
  const [imageAllowFallback, setImageAllowFallback] = useState(true);
  const [preferredVideoProviderId, setPreferredVideoProviderId] = useState(
    AUTO_IMAGE_PROVIDER_VALUE,
  );
  const [preferredVideoModelId, setPreferredVideoModelId] = useState(
    AUTO_IMAGE_MODEL_VALUE,
  );
  const [videoAllowFallback, setVideoAllowFallback] = useState(true);
  const [preferredVoiceProviderId, setPreferredVoiceProviderId] = useState(
    AUTO_IMAGE_PROVIDER_VALUE,
  );
  const [preferredVoiceModelId, setPreferredVoiceModelId] = useState(
    AUTO_IMAGE_MODEL_VALUE,
  );
  const [voiceAllowFallback, setVoiceAllowFallback] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const selectedImageProviderAvailable = useMemo(
    () =>
      imageProviders.some(
        (provider) => provider.id === preferredImageProviderId,
      ),
    [imageProviders, preferredImageProviderId],
  );

  const selectedImageProvider = useMemo(
    () =>
      imageProviders.find(
        (provider) => provider.id === preferredImageProviderId,
      ) ?? null,
    [imageProviders, preferredImageProviderId],
  );

  const availableImageModels = useMemo(() => {
    if (!selectedImageProvider) {
      return [];
    }

    return getImageModelsForProvider(
      selectedImageProvider.id,
      selectedImageProvider.type,
      selectedImageProvider.custom_models,
      selectedImageProvider.api_host,
    );
  }, [selectedImageProvider]);

  const selectedImageModelAvailable = useMemo(
    () =>
      availableImageModels.some((model) => model.id === preferredImageModelId),
    [availableImageModels, preferredImageModelId],
  );

  const videoProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isVideoProvider(provider.id),
      ),
    [providers],
  );

  const selectedVideoProviderAvailable = useMemo(
    () =>
      videoProviders.some(
        (provider) => provider.id === preferredVideoProviderId,
      ),
    [preferredVideoProviderId, videoProviders],
  );

  const selectedVideoProvider = useMemo(
    () =>
      videoProviders.find(
        (provider) => provider.id === preferredVideoProviderId,
      ) ?? null,
    [preferredVideoProviderId, videoProviders],
  );

  const availableVideoModels = useMemo(() => {
    if (!selectedVideoProvider) {
      return [];
    }
    return getVideoModelsForProvider(
      selectedVideoProvider.id,
      selectedVideoProvider.custom_models,
    );
  }, [selectedVideoProvider]);

  const selectedVideoModelAvailable = useMemo(
    () => availableVideoModels.some((model) => model === preferredVideoModelId),
    [availableVideoModels, preferredVideoModelId],
  );

  const voiceProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          provider.enabled &&
          provider.api_key_count > 0 &&
          isTtsProvider(provider.id, provider.type),
      ),
    [providers],
  );

  const selectedVoiceProviderAvailable = useMemo(
    () =>
      voiceProviders.some(
        (provider) => provider.id === preferredVoiceProviderId,
      ),
    [preferredVoiceProviderId, voiceProviders],
  );

  const selectedVoiceProvider = useMemo(
    () =>
      voiceProviders.find(
        (provider) => provider.id === preferredVoiceProviderId,
      ) ?? null,
    [preferredVoiceProviderId, voiceProviders],
  );

  const availableVoiceModels = useMemo(() => {
    if (!selectedVoiceProvider) {
      return [];
    }
    return getTtsModelsForProvider(selectedVoiceProvider.custom_models);
  }, [selectedVoiceProvider]);

  const selectedVoiceModelAvailable = useMemo(
    () => availableVoiceModels.some((model) => model === preferredVoiceModelId),
    [availableVoiceModels, preferredVoiceModelId],
  );

  // 同步项目数据到表单
  useEffect(() => {
    if (project) {
      setName(project.name);
      setIcon(project.icon || "📝");
      setDefaultPersonaId(project.defaultPersonaId || "");
      setPreferredImageProviderId(
        project.settings?.imageGeneration?.preferredProviderId ||
          AUTO_IMAGE_PROVIDER_VALUE,
      );
      setPreferredImageModelId(
        project.settings?.imageGeneration?.preferredModelId ||
          AUTO_IMAGE_MODEL_VALUE,
      );
      setImageAllowFallback(
        project.settings?.imageGeneration?.allowFallback ?? true,
      );
      setPreferredVideoProviderId(
        project.settings?.videoGeneration?.preferredProviderId ||
          AUTO_IMAGE_PROVIDER_VALUE,
      );
      setPreferredVideoModelId(
        project.settings?.videoGeneration?.preferredModelId ||
          AUTO_IMAGE_MODEL_VALUE,
      );
      setVideoAllowFallback(
        project.settings?.videoGeneration?.allowFallback ?? true,
      );
      setPreferredVoiceProviderId(
        project.settings?.voiceGeneration?.preferredProviderId ||
          AUTO_IMAGE_PROVIDER_VALUE,
      );
      setPreferredVoiceModelId(
        project.settings?.voiceGeneration?.preferredModelId ||
          AUTO_IMAGE_MODEL_VALUE,
      );
      setVoiceAllowFallback(
        project.settings?.voiceGeneration?.allowFallback ?? true,
      );
    }
  }, [project]);

  useEffect(() => {
    if (preferredImageProviderId === AUTO_IMAGE_PROVIDER_VALUE) {
      if (preferredImageModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredImageModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    if (availableImageModels.length === 0) {
      if (preferredImageModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredImageModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    const hasSelectedModel = availableImageModels.some(
      (model) => model.id === preferredImageModelId,
    );
    if (!hasSelectedModel) {
      setPreferredImageModelId(
        availableImageModels[0]?.id ?? AUTO_IMAGE_MODEL_VALUE,
      );
    }
  }, [availableImageModels, preferredImageModelId, preferredImageProviderId]);

  useEffect(() => {
    if (preferredVideoProviderId === AUTO_IMAGE_PROVIDER_VALUE) {
      if (preferredVideoModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredVideoModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    if (availableVideoModels.length === 0) {
      if (preferredVideoModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredVideoModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    if (!availableVideoModels.includes(preferredVideoModelId)) {
      setPreferredVideoModelId(
        availableVideoModels[0] ?? AUTO_IMAGE_MODEL_VALUE,
      );
    }
  }, [availableVideoModels, preferredVideoModelId, preferredVideoProviderId]);

  useEffect(() => {
    if (preferredVoiceProviderId === AUTO_IMAGE_PROVIDER_VALUE) {
      if (preferredVoiceModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredVoiceModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    if (availableVoiceModels.length === 0) {
      if (preferredVoiceModelId !== AUTO_IMAGE_MODEL_VALUE) {
        setPreferredVoiceModelId(AUTO_IMAGE_MODEL_VALUE);
      }
      return;
    }

    if (!availableVoiceModels.includes(preferredVoiceModelId)) {
      setPreferredVoiceModelId(
        availableVoiceModels[0] ?? AUTO_IMAGE_MODEL_VALUE,
      );
    }
  }, [availableVoiceModels, preferredVoiceModelId, preferredVoiceProviderId]);

  const handleSave = async () => {
    if (!project) return;
    setSaving(true);
    try {
      const nextSettings: WorkspaceSettings = {
        ...(project.settings || {}),
      };

      if (
        preferredImageProviderId !== AUTO_IMAGE_PROVIDER_VALUE ||
        !imageAllowFallback
      ) {
        nextSettings.imageGeneration = {
          preferredProviderId:
            preferredImageProviderId !== AUTO_IMAGE_PROVIDER_VALUE
              ? preferredImageProviderId
              : undefined,
          preferredModelId:
            preferredImageProviderId !== AUTO_IMAGE_PROVIDER_VALUE &&
            preferredImageModelId !== AUTO_IMAGE_MODEL_VALUE
              ? preferredImageModelId
              : undefined,
          allowFallback: imageAllowFallback,
        };
      } else {
        delete nextSettings.imageGeneration;
      }

      if (
        preferredVideoProviderId !== AUTO_IMAGE_PROVIDER_VALUE ||
        !videoAllowFallback
      ) {
        nextSettings.videoGeneration = {
          preferredProviderId:
            preferredVideoProviderId !== AUTO_IMAGE_PROVIDER_VALUE
              ? preferredVideoProviderId
              : undefined,
          preferredModelId:
            preferredVideoProviderId !== AUTO_IMAGE_PROVIDER_VALUE &&
            preferredVideoModelId !== AUTO_IMAGE_MODEL_VALUE
              ? preferredVideoModelId
              : undefined,
          allowFallback: videoAllowFallback,
        };
      } else {
        delete nextSettings.videoGeneration;
      }

      if (
        preferredVoiceProviderId !== AUTO_IMAGE_PROVIDER_VALUE ||
        !voiceAllowFallback
      ) {
        nextSettings.voiceGeneration = {
          preferredProviderId:
            preferredVoiceProviderId !== AUTO_IMAGE_PROVIDER_VALUE
              ? preferredVoiceProviderId
              : undefined,
          preferredModelId:
            preferredVoiceProviderId !== AUTO_IMAGE_PROVIDER_VALUE &&
            preferredVoiceModelId !== AUTO_IMAGE_MODEL_VALUE
              ? preferredVoiceModelId
              : undefined,
          allowFallback: voiceAllowFallback,
        };
      } else {
        delete nextSettings.voiceGeneration;
      }

      await update({
        name,
        settings: nextSettings,
        icon,
        defaultPersonaId: defaultPersonaId || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!project) return;
    if (confirm("确认归档项目？归档后项目将从列表中隐藏。")) {
      await archive();
    }
  };

  if (loading || !project) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const isDefault = project.isDefault;
  const isNovelProject = workspaceType === "novel";

  return (
    <div className="p-4 space-y-6 max-w-2xl">
      {/* 基本信息 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">基本信息</h3>

        <div className="space-y-2">
          <Label htmlFor="project-name">项目名称</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入项目名称"
            disabled={isDefault}
          />
          {isDefault && (
            <p className="text-xs text-muted-foreground">
              默认项目名称不可修改
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>项目图标</Label>
          <Select value={icon} onValueChange={setIcon}>
            <SelectTrigger>
              <SelectValue placeholder="选择图标" />
            </SelectTrigger>
            <SelectContent>
              {ICON_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 默认配置 */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          默认配置与项目覆盖
        </h3>

        {!isNovelProject && (
          <div className="space-y-2">
            <Label>默认人设</Label>
            <Select
              value={defaultPersonaId}
              onValueChange={setDefaultPersonaId}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择默认人设" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">无</SelectItem>
                {personas.map((persona) => (
                  <SelectItem key={persona.id} value={persona.id}>
                    {persona.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              新建话题时自动使用的人设
            </p>
          </div>
        )}

        <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
          图片 / 视频 /
          语音现在支持全局默认。这里的配置仅覆盖当前项目；留空时会跟随“设置”中的全局默认值。
        </div>

        <div className="space-y-2">
          <Label>图片服务覆盖</Label>
          <Select
            value={preferredImageProviderId}
            onValueChange={setPreferredImageProviderId}
            disabled={providersLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认图片服务" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_PROVIDER_VALUE}>
                跟随全局默认
              </SelectItem>
              {!selectedImageProviderAvailable &&
                preferredImageProviderId !== AUTO_IMAGE_PROVIDER_VALUE && (
                  <SelectItem value={preferredImageProviderId}>
                    当前配置不可用：{preferredImageProviderId}
                  </SelectItem>
                )}
              {imageProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            仅当前项目生效；留空时跟随全局默认图片服务。
          </p>
          {!providersLoading && imageProviders.length === 0 && (
            <p className="text-xs text-amber-600">
              暂无可用图片 Provider，请先到凭证管理中配置可出图服务。
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>图片模型覆盖</Label>
          <Select
            value={preferredImageModelId}
            onValueChange={setPreferredImageModelId}
            disabled={
              providersLoading ||
              preferredImageProviderId === AUTO_IMAGE_PROVIDER_VALUE ||
              availableImageModels.length === 0
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认图片模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_MODEL_VALUE}>
                跟随全局 / 自动选择
              </SelectItem>
              {!selectedImageModelAvailable &&
                preferredImageModelId !== AUTO_IMAGE_MODEL_VALUE && (
                  <SelectItem value={preferredImageModelId}>
                    当前配置不可用：{preferredImageModelId}
                  </SelectItem>
                )}
              {availableImageModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            仅在当前项目指定图片服务时生效；留空时跟随全局默认或自动匹配策略。
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-3">
          <div className="space-y-1">
            <Label className="text-sm">图片服务不可用时自动回退</Label>
            <p className="text-xs text-muted-foreground">
              关闭后，如果当前项目或全局默认图片服务缺失、被禁用或无可用
              Key，将直接报错。
            </p>
          </div>
          <Switch
            checked={imageAllowFallback}
            onCheckedChange={setImageAllowFallback}
          />
        </div>

        <div className="space-y-2 pt-2 border-t">
          <h4 className="text-sm font-medium">视频生成覆盖</h4>
          <Label>视频服务覆盖</Label>
          <Select
            value={preferredVideoProviderId}
            onValueChange={setPreferredVideoProviderId}
            disabled={providersLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认视频服务" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_PROVIDER_VALUE}>
                跟随全局默认
              </SelectItem>
              {!selectedVideoProviderAvailable &&
                preferredVideoProviderId !== AUTO_IMAGE_PROVIDER_VALUE && (
                  <SelectItem value={preferredVideoProviderId}>
                    当前配置不可用：{preferredVideoProviderId}
                  </SelectItem>
                )}
              {videoProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>视频模型覆盖</Label>
          <Select
            value={preferredVideoModelId}
            onValueChange={setPreferredVideoModelId}
            disabled={
              providersLoading ||
              preferredVideoProviderId === AUTO_IMAGE_PROVIDER_VALUE ||
              availableVideoModels.length === 0
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认视频模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_MODEL_VALUE}>
                跟随全局 / 自动选择
              </SelectItem>
              {!selectedVideoModelAvailable &&
                preferredVideoModelId !== AUTO_IMAGE_MODEL_VALUE && (
                  <SelectItem value={preferredVideoModelId}>
                    当前配置不可用：{preferredVideoModelId}
                  </SelectItem>
                )}
              {availableVideoModels.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            仅当前项目生效；留空时跟随全局默认视频服务。
          </p>
          {!providersLoading && videoProviders.length === 0 && (
            <p className="text-xs text-amber-600">
              暂无可用视频 Provider，请先到凭证管理中配置可生成视频的服务。
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border px-3 py-3">
            <div className="space-y-1">
              <Label className="text-sm">视频服务不可用时自动回退</Label>
              <p className="text-xs text-muted-foreground">
                关闭后，如果当前项目或全局默认视频服务不可用，将直接提示错误。
              </p>
            </div>
            <Switch
              checked={videoAllowFallback}
              onCheckedChange={setVideoAllowFallback}
            />
          </div>
        </div>

        <div className="space-y-2 pt-2 border-t">
          <h4 className="text-sm font-medium">语音生成覆盖</h4>
          <Label>语音服务覆盖</Label>
          <Select
            value={preferredVoiceProviderId}
            onValueChange={setPreferredVoiceProviderId}
            disabled={providersLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认语音服务" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_PROVIDER_VALUE}>
                跟随全局默认
              </SelectItem>
              {!selectedVoiceProviderAvailable &&
                preferredVoiceProviderId !== AUTO_IMAGE_PROVIDER_VALUE && (
                  <SelectItem value={preferredVoiceProviderId}>
                    当前配置不可用：{preferredVoiceProviderId}
                  </SelectItem>
                )}
              {voiceProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label>语音模型覆盖</Label>
          <Select
            value={preferredVoiceModelId}
            onValueChange={setPreferredVoiceModelId}
            disabled={
              providersLoading ||
              preferredVoiceProviderId === AUTO_IMAGE_PROVIDER_VALUE ||
              availableVoiceModels.length === 0
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="选择默认语音模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_IMAGE_MODEL_VALUE}>
                跟随全局 / 自动选择
              </SelectItem>
              {!selectedVoiceModelAvailable &&
                preferredVoiceModelId !== AUTO_IMAGE_MODEL_VALUE && (
                  <SelectItem value={preferredVoiceModelId}>
                    当前配置不可用：{preferredVoiceModelId}
                  </SelectItem>
                )}
              {availableVoiceModels.map((model) => (
                <SelectItem key={model} value={model}>
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            仅当前项目生效；留空时跟随全局默认语音服务。
          </p>
          {!providersLoading && voiceProviders.length === 0 && (
            <p className="text-xs text-amber-600">
              暂无可用语音 Provider，请先到凭证管理中配置可配音 / TTS 的服务。
            </p>
          )}
          <div className="flex items-center justify-between rounded-lg border px-3 py-3">
            <div className="space-y-1">
              <Label className="text-sm">语音服务不可用时自动回退</Label>
              <p className="text-xs text-muted-foreground">
                关闭后，如果当前项目或全局默认语音服务不可用，将直接提示错误。
              </p>
            </div>
            <Switch
              checked={voiceAllowFallback}
              onCheckedChange={setVoiceAllowFallback}
            />
          </div>
        </div>
      </div>

      {/* 保存按钮 */}
      <Button onClick={handleSave} disabled={saving}>
        <SaveIcon className="h-4 w-4 mr-1" />
        {saving ? "保存中..." : "保存设置"}
      </Button>

      {/* 危险操作区域 */}
      {!isDefault && (
        <div className="space-y-4 pt-6 border-t">
          <h3 className="text-sm font-medium text-destructive flex items-center gap-2">
            <AlertTriangleIcon className="h-4 w-4" />
            危险操作
          </h3>
          <Button variant="outline" onClick={handleArchive}>
            <ArchiveIcon className="h-4 w-4 mr-1" />
            归档项目
          </Button>
        </div>
      )}

      {/* 默认项目提示 */}
      {isDefault && (
        <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <p className="font-medium mb-1">💡 默认项目</p>
          <p>
            默认项目不可删除或归档。所有未分配项目的话题都会归属到默认项目。
          </p>
        </div>
      )}
    </div>
  );
}

export default SettingsTab;
