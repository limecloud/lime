import { useEffect, useMemo, useRef } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/agent/chat/components/MarkdownRenderer";
import {
  countPreviewSearchMatches,
  renderHighlightedPreviewText,
} from "./resourcePreviewSearch";
import type { ResourceManagerItem } from "./types";
import { useResourceTextPreview } from "./useResourceTextPreview";

interface TextResourceRendererProps {
  item: ResourceManagerItem;
  searchQuery: string;
  activeSearchMatchIndex: number;
  markdownViewMode: "preview" | "source";
  onSearchMatchCountChange: (matchCount: number) => void;
}

export const TEXT_RESOURCE_PREVIEW_MAX_SIZE = 256 * 1024;

export function TextResourceRenderer({
  item,
  searchQuery,
  activeSearchMatchIndex,
  markdownViewMode,
  onSearchMatchCountChange,
}: TextResourceRendererProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const state = useResourceTextPreview({
    item,
    maxSize: TEXT_RESOURCE_PREVIEW_MAX_SIZE,
    missingPathError: "该文本资源缺少本地路径，暂时无法读取内容。",
    binaryError: "该文件被识别为二进制内容，不能按文本预览。",
  });
  const isMarkdown = item.kind === "markdown";
  const shouldRenderMarkdownPreview =
    isMarkdown && markdownViewMode === "preview";
  const content = state.content ?? "";
  const matchCount = useMemo(
    () => countPreviewSearchMatches(content, searchQuery),
    [content, searchQuery],
  );
  const normalizedActiveMatchIndex =
    matchCount > 0 ? Math.min(activeSearchMatchIndex, matchCount - 1) : -1;

  useEffect(() => {
    onSearchMatchCountChange(matchCount);
  }, [matchCount, onSearchMatchCountChange]);

  useEffect(() => {
    if (!searchQuery.trim() || matchCount <= 0 || shouldRenderMarkdownPreview) {
      return;
    }

    const activeHit = previewRef.current?.querySelector(
      '[data-resource-preview-search-active="true"]',
    );
    activeHit?.scrollIntoView?.({ block: "center", inline: "nearest" });
  }, [
    matchCount,
    normalizedActiveMatchIndex,
    searchQuery,
    shouldRenderMarkdownPreview,
  ]);

  if (state.loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] text-slate-500">
        <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm shadow-sm shadow-slate-950/5">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          正在读取文本预览...
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#f5f6f8] px-6 text-center text-slate-500">
        <div className="max-w-sm rounded-[24px] border border-slate-200 bg-white p-8 shadow-sm shadow-slate-950/5">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-600">
            <AlertCircle className="h-7 w-7" />
          </div>
          <h2 className="mt-5 text-lg font-semibold text-slate-950">
            文本预览不可用
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">{state.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f5f6f8]">
      <div
        ref={previewRef}
        data-testid="resource-manager-text-preview"
        className="min-h-0 flex-1 overflow-auto bg-white px-8 py-6"
      >
        {shouldRenderMarkdownPreview ? (
          <div className="mx-auto max-w-4xl text-[15px] leading-7 text-slate-900">
            <MarkdownRenderer
              content={content}
              baseFilePath={item.filePath ?? undefined}
              renderA2UIInline={false}
              showBlockActions={false}
            />
          </div>
        ) : (
          <pre className="mx-auto max-w-5xl whitespace-pre-wrap break-words font-mono text-sm leading-6 text-slate-800">
            {renderHighlightedPreviewText(content, searchQuery, {
              activeIndex: normalizedActiveMatchIndex,
            })}
          </pre>
        )}
      </div>
    </div>
  );
}
