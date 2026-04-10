/**
 * @file MarkdownPreview.tsx
 * @description Markdown 预览组件 - 支持源码/预览切换
 * @module components/general-chat/canvas/MarkdownPreview
 *
 * @requirements 4.5
 */

import React, { useMemo, useState } from "react";
import { MarkdownRenderer } from "@/components/agent/chat/components/MarkdownRenderer";

interface MarkdownPreviewProps {
  /** Markdown 内容 */
  content: string;
  /** Markdown 文件绝对路径，用于解析相对图片 */
  baseFilePath?: string;
  /** 是否处于编辑模式 */
  isEditing?: boolean;
  /** 内容变更回调 */
  onContentChange?: (content: string) => void;
}

function MarkdownBody({
  content,
  baseFilePath,
}: Pick<MarkdownPreviewProps, "content" | "baseFilePath">) {
  return (
    <div className="px-6 py-5">
      <MarkdownRenderer content={content} baseFilePath={baseFilePath} />
    </div>
  );
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  baseFilePath,
  isEditing = false,
  onContentChange,
}) => {
  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const body = useMemo(
    () => <MarkdownBody content={content} baseFilePath={baseFilePath} />,
    [baseFilePath, content],
  );

  if (isEditing) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-ink-200 bg-ink-50">
          <button
            onClick={() => setViewMode("preview")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              viewMode === "preview"
                ? "bg-accent text-white"
                : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            预览
          </button>
          <button
            onClick={() => setViewMode("source")}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              viewMode === "source"
                ? "bg-accent text-white"
                : "text-ink-600 hover:bg-ink-100"
            }`}
          >
            源码
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {viewMode === "source" ? (
            <textarea
              value={content}
              onChange={(e) => onContentChange?.(e.target.value)}
              className="w-full h-full p-4 font-mono text-sm bg-transparent resize-none outline-none"
              spellCheck={false}
            />
          ) : (
            body
          )}
        </div>
      </div>
    );
  }

  return <div className="h-full overflow-auto bg-white">{body}</div>;
};

export default MarkdownPreview;
