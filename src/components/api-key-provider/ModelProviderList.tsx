/**
 * @file ModelProviderList 组件
 * @description 设置模型页左侧的已启用模型列表，只展示用户实际启用的模型入口。
 * @module components/api-key-provider/ModelProviderList
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { ProviderIcon } from "@/icons/providers";
import { cn } from "@/lib/utils";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { Plus, Settings2 } from "lucide-react";
import {
  buildEnabledModelItems,
  type EnabledModelListOptions,
} from "./ModelProviderList.utils";

export interface ModelProviderListProps {
  providers: ProviderWithKeysDisplay[];
  options?: EnabledModelListOptions;
  selectedProviderId?: string | null;
  onProviderSelect?: (providerId: string) => void;
  onAddModel?: () => void;
  onImportExport?: () => void;
  className?: string;
}

export const ModelProviderList: React.FC<ModelProviderListProps> = ({
  providers,
  options,
  selectedProviderId,
  onProviderSelect,
  onAddModel,
  onImportExport,
  className,
}) => {
  const { t } = useTranslation("settings");
  const items = buildEnabledModelItems(providers, options);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-[clamp(220px,26%,320px)] flex-col overflow-hidden border-r-[0.5px] border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)]",
        className,
      )}
      data-testid="enabled-model-list"
    >
      <div className="flex-shrink-0 px-5 pb-3 pt-5">
        <p className="text-sm font-semibold text-[color:var(--lime-text-strong)]">
          {t("settings.providers.modelList.title", "启用的模型")}
        </p>
      </div>

      <div
        className="min-h-0 flex-1 overscroll-contain overflow-y-auto px-4 py-2"
        data-testid="enabled-model-scroll-region"
      >
        {items.length > 0 ? (
          <div className="space-y-2" data-testid="enabled-model-items">
            {items.map((item) => {
              const selected = selectedProviderId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onProviderSelect?.(item.id)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-md border-[0.5px] px-3 py-3 text-left",
                    selected
                      ? "border-[var(--lime-surface-border)] bg-[var(--lime-surface-hover)]"
                      : "border-transparent bg-transparent hover:bg-[var(--lime-surface-hover)]",
                  )}
                  data-testid="enabled-model-item"
                  data-provider-id={item.id}
                  data-selected={selected}
                >
                  <ProviderIcon
                    providerType={item.provider.id}
                    fallbackText={item.providerName}
                    size={24}
                    className="flex-shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[color:var(--lime-text-strong)]">
                        {item.providerName}
                      </span>
                      {item.isDefault ? (
                        <Badge className="shrink-0 whitespace-nowrap rounded-sm border-[0.5px] border-[var(--lime-surface-border)] bg-[var(--lime-surface-soft)] px-1.5 py-0 text-xs text-[var(--lime-text-muted)] hover:bg-[var(--lime-surface-soft)]">
                          {t(
                            "settings.providers.modelList.badge.default",
                            "默认",
                          )}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-[color:var(--lime-text-muted)]">
                      {item.status === "login_required"
                        ? t(
                            "settings.providers.modelList.status.loginRequired",
                            "需要登录",
                          )
                        : (item.modelId ??
                          t(
                            "settings.providers.modelList.status.modelPending",
                            "模型待指定",
                          ))}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="mt-2 px-4 py-8 text-center"
            data-testid="enabled-model-empty"
          >
            <p className="text-sm font-medium text-[color:var(--lime-text-strong)]">
              {t("settings.providers.modelList.empty.title", "还没有启用模型")}
            </p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 space-y-2 border-t-[0.5px] border-[var(--lime-surface-border)] px-4 py-4">
        {onAddModel ? (
          <button
            type="button"
            onClick={onAddModel}
            className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-medium text-[var(--lime-text)] hover:bg-[var(--lime-surface-hover)]"
            data-testid="add-model-button"
          >
            <Plus className="h-4 w-4 text-[color:var(--lime-text-muted)]" />
            {t("settings.providers.modelList.action.add", "添加模型")}
          </button>
        ) : null}
        {onImportExport ? (
          <button
            type="button"
            onClick={onImportExport}
            className="flex w-full items-center gap-3 rounded-md px-4 py-2.5 text-left text-xs font-medium text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] hover:text-[var(--lime-text-strong)]"
            data-testid="import-export-button"
          >
            <Settings2 className="h-4 w-4" />
            {t(
              "settings.providers.modelList.action.importExport",
              "导入 / 导出配置",
            )}
          </button>
        ) : null}
      </div>
    </aside>
  );
};
