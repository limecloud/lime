/**
 * @file ModelProviderList 组件
 * @description 设置模型页左侧的已启用模型列表，只展示用户实际启用的模型入口。
 * @module components/api-key-provider/ModelProviderList
 */

import React from "react";
import { Badge } from "@/components/ui/badge";
import { ProviderIcon } from "@/icons/providers";
import { cn } from "@/lib/utils";
import type { ProviderWithKeysDisplay } from "@/lib/api/apiKeyProvider";
import { GripVertical, Plus, Settings2 } from "lucide-react";
import { buildEnabledModelItems } from "./ModelProviderList.utils";

export interface ModelProviderListProps {
  providers: ProviderWithKeysDisplay[];
  selectedProviderId?: string | null;
  onProviderSelect?: (providerId: string) => void;
  onAddModel?: () => void;
  onImportExport?: () => void;
  className?: string;
}

export const ModelProviderList: React.FC<ModelProviderListProps> = ({
  providers,
  selectedProviderId,
  onProviderSelect,
  onAddModel,
  onImportExport,
  className,
}) => {
  const items = buildEnabledModelItems(providers);

  return (
    <aside
      className={cn(
        "flex h-full w-[320px] flex-col border-r border-slate-200/80 bg-[#fbfaf7]",
        className,
      )}
      data-testid="enabled-model-list"
    >
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">启用的模型</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              拖拽排序，首位为默认
            </p>
          </div>
          {onAddModel ? (
            <button
              type="button"
              onClick={onAddModel}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="添加模型"
              data-testid="enabled-model-add-icon-button"
            >
              <Plus className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {items.length > 0 ? (
          <div className="space-y-2" data-testid="enabled-model-items">
            {items.map((item) => {
              const selected = selectedProviderId === item.id;
              const title = item.isDefault
                ? `默认 (${item.providerName})`
                : item.providerName;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onProviderSelect?.(item.id)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition",
                    selected
                      ? "border-slate-200 bg-white shadow-sm shadow-slate-950/5"
                      : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white/80",
                  )}
                  data-testid="enabled-model-item"
                  data-provider-id={item.id}
                  data-selected={selected}
                >
                  <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-300" />
                  <ProviderIcon
                    providerType={item.provider.id}
                    fallbackText={item.providerName}
                    size={24}
                    className="flex-shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">
                        {title}
                      </span>
                      {item.isDefault ? (
                        <Badge className="border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[11px] text-emerald-700 hover:bg-emerald-50">
                          默认
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {item.modelId ?? "模型待指定"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div
            className="mt-2 rounded-[20px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center"
            data-testid="enabled-model-empty"
          >
            <p className="text-sm font-medium text-slate-900">还没有启用模型</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              点击添加模型后，再从推荐服务或自定义供应商里筛选。
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200/80 px-4 py-4">
        {onAddModel ? (
          <button
            type="button"
            onClick={onAddModel}
            className="flex w-full items-center gap-3 rounded-[18px] bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 shadow-sm shadow-slate-950/5 transition hover:bg-slate-50"
            data-testid="add-model-button"
          >
            <Plus className="h-4 w-4 text-slate-500" />
            添加模型
          </button>
        ) : null}
        {onImportExport ? (
          <button
            type="button"
            onClick={onImportExport}
            className="flex w-full items-center gap-3 rounded-[18px] px-4 py-2.5 text-left text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            data-testid="import-export-button"
          >
            <Settings2 className="h-4 w-4" />
            导入 / 导出配置
          </button>
        ) : null}
      </div>
    </aside>
  );
};

export default ModelProviderList;
