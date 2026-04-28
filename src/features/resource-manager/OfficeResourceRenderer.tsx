import { cn } from "@/lib/utils";
import { getResourceDocumentProfile } from "./resourceDocumentProfiles";
import { getResourceFormatLabel } from "./resourceFormatCatalog";
import type { ResourceManagerItem } from "./types";

interface OfficeResourceRendererProps {
  item: ResourceManagerItem;
}

export function OfficeResourceRenderer({ item }: OfficeResourceRendererProps) {
  const profile = getResourceDocumentProfile(item);
  const displayType = getResourceFormatLabel(item) || profile.titleLabel;
  const DocumentIcon = profile.Icon;

  return (
    <div
      data-testid="resource-manager-office-preview"
      className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] px-6 text-center text-slate-500"
    >
      <div className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/5">
        <div
          className={cn(
            "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border",
            profile.iconBoxClassName,
          )}
        >
          <DocumentIcon className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-950">
          {displayType} 暂不内置预览
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          当前先保持桌面端稳定体验：请使用顶部导航栏的“系统打开”或“定位文件”交给
          {profile.nativeAppLabel} 处理。
        </p>
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-6 text-slate-500">
          <div className="truncate font-medium text-slate-700">
            {item.title || "未命名 Office 文件"}
          </div>
          <div className="mt-1">文档类型：{profile.titleLabel}</div>
          {item.filePath ? (
            <div className="mt-1 truncate">{item.filePath}</div>
          ) : null}
          {item.mimeType ? <div>类型：{item.mimeType}</div> : null}
        </div>
        <p className="mt-5 text-[11px] text-slate-400">
          后续可接入安全的{profile.titleLabel}转换或系统 Quick Look
          预览，在保持桌面稳定性的前提下展示正文。
        </p>
      </div>
    </div>
  );
}
