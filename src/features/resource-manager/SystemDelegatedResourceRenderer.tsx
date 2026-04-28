import {
  Database,
  FileArchive,
  FileQuestion,
  FileText,
  ImageIcon,
  Music,
  Video,
} from "lucide-react";
import {
  getResourceFormatLabel,
  getResourcePreviewTarget,
  getResourcePreviewTargetLabel,
} from "./resourceFormatCatalog";
import { getItemTitle } from "./resourceManagerPresentation";
import type { ResourceManagerItem, ResourceManagerKind } from "./types";

interface SystemDelegatedResourceRendererProps {
  item: ResourceManagerItem;
}

function getDelegatedIcon(kind: ResourceManagerKind) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Video;
  if (kind === "audio") return Music;
  if (kind === "data") return Database;
  if (kind === "archive") return FileArchive;
  if (kind === "office" || kind === "pdf" || kind === "text") return FileText;
  return FileQuestion;
}

function getDelegatedTitle(item: ResourceManagerItem): string {
  const formatLabel = getResourceFormatLabel(item);
  if (formatLabel) {
    return `${formatLabel} 建议使用系统应用查看`;
  }
  return "当前资源建议使用系统应用查看";
}

function getDelegatedDescription(item: ResourceManagerItem): string {
  const target = getResourcePreviewTarget(item);
  if (target === "unsupported") {
    return "Lime 已识别该格式，但尚未接入安全可靠的内置解析器。请先使用顶部导航栏的系统打开、定位或下载动作处理。";
  }
  return "该格式在桌面系统的原生查看器中兼容性更好。为避免 WebView 硬加载失败，当前不伪装成内置预览。";
}

export function SystemDelegatedResourceRenderer({
  item,
}: SystemDelegatedResourceRendererProps) {
  const Icon = getDelegatedIcon(item.kind);
  const previewLabel = getResourcePreviewTargetLabel(item);

  return (
    <div
      data-testid="resource-manager-system-delegated-preview"
      className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] px-6 text-center text-slate-500"
    >
      <div className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600">
          <Icon className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-lg font-semibold text-slate-950">
          {getDelegatedTitle(item)}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          {getDelegatedDescription(item)}
        </p>
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs leading-6 text-slate-500">
          <div className="truncate font-medium text-slate-700">
            {getItemTitle(item)}
          </div>
          <div className="mt-1">预览策略：{previewLabel}</div>
          {item.filePath ? (
            <div className="mt-1 truncate">{item.filePath}</div>
          ) : null}
          {item.mimeType ? <div>类型：{item.mimeType}</div> : null}
        </div>
        <p className="mt-5 text-[11px] text-slate-400">
          后续可接入系统 Quick Look / Preview Handler
          或格式转换，在保持安全边界的前提下展示正文内容。
        </p>
      </div>
    </div>
  );
}
