import { FileArchive, PackageOpen } from "lucide-react";
import { getResourceFormatLabel } from "./resourceFormatCatalog";
import { getItemTitle } from "./resourceManagerPresentation";
import type { ResourceManagerItem } from "./types";

interface ArchiveResourceRendererProps {
  item: ResourceManagerItem;
}

export function ArchiveResourceRenderer({
  item,
}: ArchiveResourceRendererProps) {
  const formatLabel = getResourceFormatLabel(item) || "归档文件";

  return (
    <div
      data-testid="resource-manager-archive-preview"
      className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] px-6 text-center text-slate-500"
    >
      <div className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600">
          <FileArchive className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-950">
          {formatLabel} 建议交给系统归档工具
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          Lime 已识别该归档格式。为避免在 WebView
          内直接解压不可信文件，当前不内置展开内容，请使用顶部导航栏的系统打开、定位或下载动作处理。
        </p>
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-6 text-slate-500">
          <div className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
            <PackageOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">{getItemTitle(item)}</span>
          </div>
          <div className="mt-1">归档类型：{formatLabel}</div>
          {item.filePath ? (
            <div className="mt-1 truncate">{item.filePath}</div>
          ) : null}
          {item.mimeType ? <div>类型：{item.mimeType}</div> : null}
        </div>
        <p className="mt-5 text-[11px] text-slate-400">
          后续可接入安全的只读目录索引、密码包提示和解压到项目资料能力，再在此处展示文件列表。
        </p>
      </div>
    </div>
  );
}
