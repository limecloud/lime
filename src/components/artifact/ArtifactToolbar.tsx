/**
 * @file Artifact 工具栏组件
 * @description 提供 Artifact 的快捷操作：复制、下载、源码切换、新窗口打开、关闭
 * @module components/artifact/ArtifactToolbar
 * @requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import React, { useState, useCallback, memo } from "react";
import {
  Copy,
  Check,
  Download,
  Code,
  Eye,
  ExternalLink,
  X,
  Smartphone,
  Tablet,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { artifactRegistry } from "@/lib/artifact/registry";
import type { Artifact } from "@/lib/artifact/types";
import {
  formatArtifactWritePhaseLabel,
  resolveArtifactWritePhase,
} from "@/components/agent/chat/utils/messageArtifacts";

/** 视图模式类型 */
type ViewMode = "source" | "preview";

/** 预览尺寸类型 */
type PreviewSize = "mobile" | "tablet" | "desktop";

/** 支持预览的语言列表 */
const PREVIEWABLE_LANGUAGES = ["html", "svg"];

/**
 * 工具栏按钮组件 Props
 */
interface ToolbarButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  tone?: "dark" | "light";
  children: React.ReactNode;
}

/**
 * 工具栏按钮组件
 * 统一的按钮样式
 */
const ToolbarButton: React.FC<ToolbarButtonProps> = memo(
  ({
    onClick,
    title,
    disabled = false,
    active = false,
    tone = "dark",
    children,
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex items-center justify-center w-7 h-7 rounded transition-all",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        tone === "light" ? "hover:bg-black/5" : "hover:bg-white/10",
        active
          ? tone === "light"
            ? "bg-black/5 text-foreground"
            : "bg-white/15 text-white"
          : tone === "light"
            ? "text-muted-foreground hover:text-foreground"
            : "text-gray-400 hover:text-white",
      )}
    >
      {children}
    </button>
  ),
);
ToolbarButton.displayName = "ToolbarButton";

/**
 * 预览尺寸选择器组件
 */
interface SizeSelectorProps {
  value: PreviewSize;
  onChange: (value: PreviewSize) => void;
  tone?: "dark" | "light";
}

const SizeSelector: React.FC<SizeSelectorProps> = memo(
  ({ value, onChange, tone = "dark" }) => (
    <div
      className={cn(
        "inline-flex items-center rounded p-0.5",
        tone === "light" ? "bg-black/5" : "bg-white/5",
      )}
    >
      <button
        type="button"
        onClick={() => onChange("mobile")}
        className={cn(
          "p-1 rounded transition-all",
          value === "mobile"
            ? tone === "light"
              ? "bg-white text-foreground shadow-sm"
              : "bg-white/10 text-white"
            : tone === "light"
              ? "text-muted-foreground hover:text-foreground"
              : "text-gray-500 hover:text-white",
        )}
        title="手机"
      >
        <Smartphone className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange("tablet")}
        className={cn(
          "p-1 rounded transition-all",
          value === "tablet"
            ? tone === "light"
              ? "bg-white text-foreground shadow-sm"
              : "bg-white/10 text-white"
            : tone === "light"
              ? "text-muted-foreground hover:text-foreground"
              : "text-gray-500 hover:text-white",
        )}
        title="平板"
      >
        <Tablet className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onChange("desktop")}
        className={cn(
          "p-1 rounded transition-all",
          value === "desktop"
            ? tone === "light"
              ? "bg-white text-foreground shadow-sm"
              : "bg-white/10 text-white"
            : tone === "light"
              ? "text-muted-foreground hover:text-foreground"
              : "text-gray-500 hover:text-white",
        )}
        title="桌面"
      >
        <Monitor className="w-3.5 h-3.5" />
      </button>
    </div>
  ),
);
SizeSelector.displayName = "SizeSelector";

/**
 * ArtifactToolbar Props
 */
interface ArtifactToolbarProps {
  /** 要操作的 Artifact 对象 */
  artifact: Artifact;
  /** 当前是否显示源码视图 */
  showSource?: boolean;
  /** 源码切换回调 */
  onToggleSource?: () => void;
  /** 关闭回调 */
  onClose?: () => void;
  /** 是否正在流式生成 */
  isStreaming?: boolean;
  /** 当前视图模式（用于代码预览） */
  viewMode?: ViewMode;
  /** 视图模式变更回调 */
  onViewModeChange?: (mode: ViewMode) => void;
  /** 当前预览尺寸 */
  previewSize?: PreviewSize;
  /** 预览尺寸变更回调 */
  onPreviewSizeChange?: (size: PreviewSize) => void;
  /** 工具栏色调 */
  tone?: "dark" | "light";
  /** 额外的展示状态标签 */
  displayBadgeLabel?: string;
  /** 操作区额外插槽 */
  actionsSlot?: React.ReactNode;
}

/**
 * 下载 Blob 文件的辅助函数
 * @param blob - 要下载的 Blob 对象
 * @param filename - 文件名
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * HTML 转义函数
 * @param str - 要转义的字符串
 * @returns 转义后的字符串
 */
function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 根据 Artifact 类型和元数据生成文件名
 * @param artifact - Artifact 对象
 * @returns 文件名
 */
function generateFilename(artifact: Artifact): string {
  // 如果元数据中有文件名，优先使用
  if (artifact.meta.filename) {
    return artifact.meta.filename;
  }

  // 获取文件扩展名
  const ext = artifactRegistry.getFileExtension(artifact.type);

  // 对于代码类型，根据语言选择扩展名
  if (artifact.type === "code" && artifact.meta.language) {
    const langExt = getLanguageExtension(artifact.meta.language);
    return `${sanitizeFilename(artifact.title)}.${langExt}`;
  }

  return `${sanitizeFilename(artifact.title)}.${ext}`;
}

/**
 * 根据语言获取文件扩展名
 * @param language - 编程语言
 * @returns 文件扩展名
 */
function getLanguageExtension(language: string): string {
  const langExtMap: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    rust: "rs",
    go: "go",
    java: "java",
    cpp: "cpp",
    c: "c",
    csharp: "cs",
    ruby: "rb",
    php: "php",
    swift: "swift",
    kotlin: "kt",
    scala: "scala",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    json: "json",
    yaml: "yaml",
    yml: "yml",
    xml: "xml",
    markdown: "md",
    sql: "sql",
    shell: "sh",
    bash: "sh",
    powershell: "ps1",
    dockerfile: "dockerfile",
    tsx: "tsx",
    jsx: "jsx",
    vue: "vue",
    svelte: "svelte",
  };

  const lower = language.toLowerCase();
  // 使用 hasOwnProperty 检查，避免原型链上的属性污染
  return Object.prototype.hasOwnProperty.call(langExtMap, lower)
    ? langExtMap[lower]
    : "txt";
}

/**
 * 清理文件名，移除非法字符
 * @param name - 原始文件名
 * @returns 清理后的文件名
 */
function sanitizeFilename(name: string): string {
  // 移除或替换非法字符
  const sanitized = name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .trim();

  // 如果为空，使用默认名称
  return sanitized || "artifact";
}

/**
 * Artifact 工具栏组件
 *
 * 功能特性：
 * - 复制内容到剪贴板 (Requirement 13.1)
 * - 下载文件，根据类型选择正确的扩展名 (Requirement 13.2)
 * - 源码/预览视图切换 (Requirement 13.3)
 * - 在新窗口中打开 (Requirement 13.4)
 * - 关闭按钮 (Requirement 13.5)
 * - 紧凑的水平布局 (Requirement 13.6)
 * - 代码行数显示和流式状态指示
 *
 * @param artifact - 要操作的 Artifact 对象
 * @param showSource - 当前是否显示源码视图
 * @param onToggleSource - 源码切换回调
 * @param onClose - 关闭回调
 * @param isStreaming - 是否正在流式生成
 * @param viewMode - 当前视图模式
 * @param onViewModeChange - 视图模式变更回调
 * @param previewSize - 当前预览尺寸
 * @param onPreviewSizeChange - 预览尺寸变更回调
 */
export const ArtifactToolbar: React.FC<ArtifactToolbarProps> = memo(
  ({
    artifact,
    showSource = false,
    onToggleSource,
    onClose,
    isStreaming: _isStreaming = false,
    viewMode = "source",
    onViewModeChange,
    previewSize = "desktop",
    onPreviewSizeChange,
    tone = "dark",
    displayBadgeLabel,
    actionsSlot,
  }) => {
    const [copied, setCopied] = useState(false);

    // 获取渲染器信息
    const entry = artifactRegistry.get(artifact.type);

    const isBrowserAssist = artifact.type === "browser_assist";
    // 判断是否是代码类型且支持预览
    const isCode = artifact.type === "code";
    const isDocument = artifact.type === "document";
    const language = artifact.meta.language?.toLowerCase() || "";
    const canPreview = isCode && PREVIEWABLE_LANGUAGES.includes(language);
    const supportsSharedViewMode =
      !isBrowserAssist && (isDocument || canPreview);
    const writePhase = resolveArtifactWritePhase(artifact);

    /**
     * 复制内容到剪贴板
     * @requirements 13.1
     */
    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(artifact.content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("复制内容失败:", err);
      }
    }, [artifact.content]);

    /**
     * 下载文件
     * @requirements 13.2
     */
    const handleDownload = useCallback(() => {
      const filename = generateFilename(artifact);
      const mimeType = getMimeType(artifact.type);
      const blob = new Blob([artifact.content], { type: mimeType });
      downloadBlob(blob, filename);
    }, [artifact]);

    /**
     * 在新窗口中打开
     * @requirements 13.4
     */
    const handleOpenInWindow = useCallback(() => {
      const win = window.open("", "_blank");
      if (win) {
        if (artifact.type === "html") {
          win.document.write(artifact.content);
        } else if (artifact.type === "svg") {
          win.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>${escapeHtml(artifact.title)}</title>
                <style>
                  body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #1a1a1a; }
                  svg { max-width: 100%; max-height: 100vh; }
                </style>
              </head>
              <body>${artifact.content}</body>
            </html>
          `);
        } else if (isCode && canPreview) {
          // 代码类型的 HTML/SVG 预览
          win.document.write(artifact.content);
        } else if (isDocument) {
          win.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>${escapeHtml(artifact.title)}</title>
                <style>
                  body { margin: 0; padding: 24px; background: #0f1115; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
                  pre { margin: 0; white-space: pre-wrap; word-break: break-word; line-height: 1.7; }
                </style>
              </head>
              <body><pre>${escapeHtml(artifact.content)}</pre></body>
            </html>
          `);
        } else {
          win.document.write(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>${escapeHtml(artifact.title)}</title>
                <style>
                  body { margin: 0; padding: 16px; background: #1e1e1e; color: #d4d4d4; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
                  pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; font-size: 13px; line-height: 1.6; }
                </style>
              </head>
              <body><pre>${escapeHtml(artifact.content)}</pre></body>
            </html>
          `);
        }
        win.document.close();
      }
    }, [artifact, isCode, canPreview, isDocument]);

    /**
     * 切换源码视图
     * @requirements 13.3
     */
    const handleToggleSource = useCallback(() => {
      onToggleSource?.();
    }, [onToggleSource]);

    /**
     * 关闭面板
     * @requirements 13.5
     */
    const handleClose = useCallback(() => {
      onClose?.();
    }, [onClose]);

    // 判断是否支持源码切换（非代码类型才需要切换）
    const supportsSourceToggle =
      !isBrowserAssist &&
      artifact.type !== "code" &&
      artifact.type !== "document" &&
      onToggleSource;

    return (
      <div
        className={cn(
          "flex items-center px-4 py-2 bg-white rounded-2xl border border-slate-200/60 shadow-sm gap-4",
          tone === "light" ? "" : "border-white/10 bg-[#21252b]",
        )}
      >
        {/* 标题区域 */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          {/* 类型图标 */}
          {entry && (
            <span
              className={cn(
                "text-xs shrink-0",
                tone === "light" ? "text-muted-foreground" : "text-gray-400",
              )}
            >
              {entry.displayName}
            </span>
          )}
          {/* 语言标签（代码类型） */}
          {isCode && language && (
            <span
              className={cn(
                "text-xs font-mono",
                tone === "light" ? "text-muted-foreground" : "text-gray-500",
              )}
            >
              {language}
            </span>
          )}
          {/* 标题 */}
          <span
            className={cn(
              "text-sm font-medium truncate",
              tone === "light" ? "text-foreground" : "text-white",
            )}
          >
            {artifact.title}
          </span>
          {writePhase ? (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0",
                tone === "light"
                  ? "border-border text-muted-foreground"
                  : "border-white/15 text-gray-300",
              )}
            >
              {formatArtifactWritePhaseLabel(writePhase)}
            </Badge>
          ) : null}
          {displayBadgeLabel ? (
            <Badge
              variant="outline"
              className={cn(
                "shrink-0",
                tone === "light"
                  ? "border-primary/20 bg-primary/5 text-primary"
                  : "border-primary/30 bg-primary/10 text-primary-foreground",
              )}
            >
              {displayBadgeLabel}
            </Badge>
          ) : null}
        </div>
        <div className="w-px h-4 bg-slate-200/60 mx-2 shrink-0" />

        {/* 操作按钮区域 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 代码预览切换（仅 HTML/SVG 代码） */}
          {supportsSharedViewMode && onViewModeChange && (
            <div
              className={cn(
                "mr-1 inline-flex items-center rounded p-0.5",
                tone === "light" ? "bg-black/5" : "bg-white/5",
              )}
            >
              <button
                type="button"
                onClick={() => onViewModeChange("source")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-all",
                  viewMode === "source"
                    ? tone === "light"
                      ? "bg-white text-foreground shadow-sm"
                      : "bg-white/10 text-white"
                    : tone === "light"
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-gray-400 hover:text-white",
                )}
                title="源码"
              >
                <Code className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange("preview")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-all",
                  viewMode === "preview"
                    ? tone === "light"
                      ? "bg-white text-foreground shadow-sm"
                      : "bg-white/10 text-white"
                    : tone === "light"
                      ? "text-muted-foreground hover:text-foreground"
                      : "text-gray-400 hover:text-white",
                )}
                title="预览"
              >
                <Eye className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 预览尺寸选择器 */}
          {canPreview && viewMode === "preview" && onPreviewSizeChange && (
            <SizeSelector
              value={previewSize}
              onChange={onPreviewSizeChange}
              tone={tone}
            />
          )}

          {!isBrowserAssist ? (
            <>
              {/* 复制按钮 */}
              <ToolbarButton
                onClick={handleCopy}
                title={copied ? "已复制" : "复制内容"}
                tone={tone}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </ToolbarButton>

              {/* 下载按钮 */}
              <ToolbarButton
                onClick={handleDownload}
                title="下载文件"
                tone={tone}
              >
                <Download className="w-4 h-4" />
              </ToolbarButton>

              {/* 源码切换按钮（非代码类型） */}
              {supportsSourceToggle && (
                <ToolbarButton
                  onClick={handleToggleSource}
                  title={showSource ? "显示预览" : "显示源码"}
                  active={showSource}
                  tone={tone}
                >
                  {showSource ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <Code className="w-4 h-4" />
                  )}
                </ToolbarButton>
              )}

              {/* 新窗口打开按钮 */}
              <ToolbarButton
                onClick={handleOpenInWindow}
                title="在新窗口中打开"
                tone={tone}
              >
                <ExternalLink className="w-4 h-4" />
              </ToolbarButton>
            </>
          ) : null}

          {actionsSlot}

          {/* 关闭按钮 */}
          {onClose && (
            <ToolbarButton onClick={handleClose} title="关闭" tone={tone}>
              <X className="w-4 h-4" />
            </ToolbarButton>
          )}
        </div>
      </div>
    );
  },
);

ArtifactToolbar.displayName = "ArtifactToolbar";

/**
 * 根据 Artifact 类型获取 MIME 类型
 * @param type - Artifact 类型
 * @returns MIME 类型
 */
function getMimeType(type: Artifact["type"]): string {
  const mimeTypes: Record<string, string> = {
    document: "text/markdown",
    code: "text/plain",
    html: "text/html",
    svg: "image/svg+xml",
    mermaid: "text/plain",
    react: "text/javascript",
    "canvas:document": "text/markdown",
    "canvas:video": "text/plain",
    "canvas:design": "application/json",
  };

  return mimeTypes[type] || "text/plain";
}
