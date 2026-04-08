import React, { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import styled from "styled-components";
import { Copy, Check, Quote } from "lucide-react";
import { parseA2UIJson } from "@/lib/workspace/a2ui";
import type { A2UIFormData } from "@/lib/workspace/a2ui";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/lib/workspace/a2ui";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import { convertLocalFileSrc } from "@/lib/api/fileSystem";
import { ArtifactPlaceholder } from "./ArtifactPlaceholder";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";

const STREAMING_LIGHT_RENDER_THRESHOLD = 2_000;
const STREAMING_LIGHT_RENDER_DEBOUNCE_MS = 48;
const STREAMING_STANDARD_RENDER_DEBOUNCE_MS = 24;

// 收紧正文与代码块表面，让消息正文更接近单列执行流的阅读节奏。
const MarkdownContainer = styled.div`
  font-size: 14px;
  line-height: 1.76;
  color: hsl(var(--foreground));
  overflow-wrap: break-word;
  word-break: break-word;
  text-wrap: pretty;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 0.95em;
    color: hsl(var(--foreground));
  }

  h1 + p,
  h2 + p,
  h3 + p {
    color: hsl(var(--muted-foreground));
    font-size: 1.02em;
    line-height: 1.8;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 700;
    margin: 1.34em 0 0.58em;
    line-height: 1.32;
    letter-spacing: -0.01em;
    color: hsl(var(--foreground));
  }

  h1:first-child,
  h2:first-child,
  h3:first-child {
    margin-top: 0;
  }

  h1 {
    font-size: 1.54em;
  }
  h2 {
    font-size: 1.28em;
  }
  h3 {
    font-size: 1.12em;
  }
  h4 {
    font-size: 1.03em;
  }
  h5,
  h6 {
    font-size: 0.96em;
    color: hsl(var(--muted-foreground));
  }

  ul,
  ol {
    padding-left: 1.28rem;
    margin: 0 0 0.95em;
  }

  ul {
    list-style-type: disc;
  }

  ol {
    list-style-type: decimal;
  }

  li {
    margin: 0.26em 0;
    padding-left: 0.08rem;
  }

  li > p {
    margin-bottom: 0.42em;
  }

  li::marker {
    color: hsl(var(--muted-foreground));
  }

  ul ul,
  ul ol,
  ol ul,
  ol ol {
    margin-top: 0.35em;
    margin-bottom: 0.45em;
  }

  strong {
    font-weight: 700;
    color: hsl(var(--foreground));
  }

  em {
    font-style: italic;
  }

  hr {
    margin: 18px 0;
    border: none;
    border-top: 1px solid hsl(var(--border));
    opacity: 0.9;
  }

  code[data-inline-code="true"] {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 0.84em;
    line-height: 1.4;
    padding: 0.08rem 0.42rem;
    border-radius: 999px;
    border: 1px solid hsl(var(--border));
    background-color: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  pre {
    margin: 14px 0;
    padding: 10px 12px 12px;
    border-radius: 10px;
    overflow: auto;
    border: 1px solid hsl(var(--border));
    background: hsl(var(--secondary));

    code {
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      color: inherit;
    }
  }

  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    min-width: 100%;
    margin: 0;
    font-size: 0.94em;
    table-layout: auto;
  }

  th,
  td {
    border-right: 1px solid rgba(167, 243, 208, 0.42);
    border-bottom: 1px solid rgba(167, 243, 208, 0.42);
    padding: 0.45rem 0.65rem;
    vertical-align: top;
    text-align: left;
  }

  th {
    font-weight: 600;
    background: linear-gradient(
      180deg,
      rgba(220, 252, 231, 0.45) 0%,
      rgba(220, 252, 231, 0.8) 100%
    );
    color: #14532d;
    white-space: nowrap;
  }

  tr > *:last-child {
    border-right: none;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:nth-child(even) td {
    background: rgba(220, 252, 231, 0.15);
  }

  a {
    color: hsl(var(--primary));
    text-decoration: underline;
    text-underline-offset: 0.18em;
    text-decoration-color: hsl(var(--primary) / 0.32);
    &:hover {
      text-decoration-color: currentColor;
    }
  }

  img {
    max-width: 100%;
    max-height: 512px;
    border-radius: 10px;
    object-fit: contain;
    cursor: pointer;
    border: 1px solid hsl(var(--border));
  }
`;

const MarkdownDivider = styled.hr`
  height: 1px;
  margin: 22px 0;
  border: none;
  background: linear-gradient(
    90deg,
    transparent 0%,
    hsl(var(--border)) 16%,
    hsl(var(--border)) 84%,
    transparent 100%
  );
`;

const MarkdownQuoteCard = styled.blockquote`
  margin: 0 0 0.95em;
  padding: 0;
  border: 1px solid rgba(167, 243, 208, 0.5);
  border-radius: 20px;
  background: linear-gradient(
    180deg,
    hsl(var(--background)) 0%,
    rgba(220, 252, 231, 0.3) 100%
  );
  box-shadow: 0 14px 34px -30px rgba(15, 23, 42, 0.18);
  overflow: hidden;
`;

const MarkdownQuoteInner = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
`;

const MarkdownQuoteIconShell = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
`;

const MarkdownQuoteBody = styled.div`
  min-width: 0;
  color: hsl(var(--foreground));

  p {
    margin-bottom: 0.55em;
  }

  p:last-child {
    margin-bottom: 0;
  }
`;

const ImageContainer = styled.div`
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const ImageCaption = styled.span`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  text-align: center;
`;

const GeneratedImage = styled.img`
  max-width: 100%;
  max-height: 512px;
  border-radius: 10px;
  object-fit: contain;
  cursor: pointer;
  border: 1px solid hsl(var(--border));
  transition:
    border-color 0.18s ease,
    box-shadow 0.2s ease;

  &:hover {
    border-color: hsl(var(--ring));
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }
`;

const CodeBlockContainer = styled.div`
  position: relative;
  margin: 10px 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background-color: #0f172a;
`;

const CodeHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background-color: rgba(15, 23, 42, 0.98);
  color: #94a3b8;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
`;

const CopyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: transparent;
  color: #e2e8f0;
  font-size: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    background: rgba(148, 163, 184, 0.12);
    border-color: rgba(148, 163, 184, 0.45);
  }

  &:focus-visible {
    outline: 2px solid rgba(148, 163, 184, 0.6);
    outline-offset: 1px;
  }
`;

const MarkdownBlockShell = styled.div`
  position: relative;

  &:hover [data-markdown-block-actions],
  &:focus-within [data-markdown-block-actions] {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
`;

const MarkdownBlockActions = styled.div`
  position: absolute;
  top: -10px;
  right: 2px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
`;

const MarkdownBlockActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid rgba(203, 213, 225, 0.92);
  background: rgba(255, 255, 255, 0.96);
  color: rgb(100, 116, 139);
  box-shadow: 0 8px 22px -18px rgba(15, 23, 42, 0.3);
  cursor: pointer;
  transition:
    color 0.16s ease,
    border-color 0.16s ease,
    background-color 0.16s ease,
    box-shadow 0.16s ease;

  &:hover {
    color: rgb(15, 23, 42);
    border-color: rgba(148, 163, 184, 0.9);
    background: rgba(255, 255, 255, 1);
    box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.34);
  }

  &:focus-visible {
    outline: 2px solid rgba(148, 163, 184, 0.56);
    outline-offset: 1px;
  }
`;

const MarkdownTableScroll = styled.div`
  margin: 0 0 0.82em;
  overflow-x: auto;
  border: 1px solid rgba(167, 243, 208, 0.6);
  border-radius: 14px;
  background: hsl(var(--background));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
`;

const CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const PLAIN_TEXT_LANGUAGES = new Set(["text", "plaintext", "plain", "txt"]);
const FLOW_ARROW_ONLY_PATTERN = /^(↓|⬇|⇣|↧|->|=>|→|↘|v)$/u;
const CODE_SIGNAL_PATTERN =
  /[{}[\];=]|\b(const|let|var|function|class|return|import|export|interface|type|async|await)\b/;
const LANGUAGE_CLASS_PATTERN = /\blanguage-([^\s]+)/i;
const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  "c#": "csharp",
  "c++": "cpp",
  js: "javascript",
  md: "markdown",
  objc: "objectivec",
  "objective-c": "objectivec",
  plain: "text",
  plaintext: "text",
  ps1: "powershell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  text: "text",
  ts: "typescript",
  txt: "text",
  yml: "yaml",
  zsh: "bash",
};

interface MarkdownRendererProps {
  content: string;
  /** 当前 Markdown 文件路径，用于解析相对图片资源 */
  baseFilePath?: string;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** 是否折叠代码块（当画布打开时） */
  collapseCodeBlocks?: boolean;
  /** 按代码块决定是否折叠 */
  shouldCollapseCodeBlock?: (language: string, code: string) => boolean;
  /** 代码块点击回调（用于在画布中显示） */
  onCodeBlockClick?: (language: string, code: string) => void;
  /** 是否正在流式生成 */
  isStreaming?: boolean;
  /** 是否为正文块显示引用/复制按钮 */
  showBlockActions?: boolean;
  /** 引用当前正文块 */
  onQuoteContent?: (content: string) => void;
}

function normalizeCodeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return "text";
  }

  return CODE_LANGUAGE_ALIASES[normalized] ?? normalized;
}

function extractCodeLanguageToken(className: string): string {
  const match = LANGUAGE_CLASS_PATTERN.exec(className);
  return (match?.[1] ?? "text").trim().toLowerCase() || "text";
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isAbsoluteLikePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function dirnameFromFilePath(value: string): string {
  const normalized = normalizeFilePath(value).replace(/\/+$/, "");
  const lastSlashIndex = normalized.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return lastSlashIndex === 0 ? "/" : "";
  }
  return normalized.slice(0, lastSlashIndex);
}

function joinFilePath(parentDir: string, childPath: string): string {
  if (!parentDir) {
    return childPath;
  }
  return `${parentDir.replace(/\/+$/, "")}/${childPath.replace(/^[\\/]+/, "")}`;
}

function splitFilePathSuffix(value: string): {
  pathPart: string;
  suffix: string;
} {
  const suffixStart = value.search(/[?#]/);
  if (suffixStart < 0) {
    return { pathPart: value, suffix: "" };
  }
  return {
    pathPart: value.slice(0, suffixStart),
    suffix: value.slice(suffixStart),
  };
}

function normalizeResolvedFilePath(value: string): string {
  const normalized = normalizeFilePath(value);
  if (!normalized) {
    return "";
  }

  let prefix = "";
  let remainder = normalized;
  if (remainder.startsWith("//")) {
    prefix = "//";
    remainder = remainder.slice(2);
  } else if (/^[A-Za-z]:\//.test(remainder)) {
    prefix = remainder.slice(0, 2);
    remainder = remainder.slice(3);
  } else if (remainder.startsWith("/")) {
    prefix = "/";
    remainder = remainder.slice(1);
  }

  const segments = remainder.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!prefix) {
        stack.push("..");
      }
      continue;
    }
    stack.push(segment);
  }

  const joined = stack.join("/");
  if (prefix === "//") {
    return joined ? `//${joined}` : "//";
  }
  if (prefix === "/") {
    return joined ? `/${joined}` : "/";
  }
  if (prefix) {
    return joined ? `${prefix}/${joined}` : `${prefix}/`;
  }
  return joined;
}

function resolveMarkdownImageSrc(
  rawSrc: string,
  baseFilePath?: string,
): string {
  const normalizedSrc = rawSrc.trim();
  if (!normalizedSrc) {
    return rawSrc;
  }

  if (
    normalizedSrc.startsWith("data:") ||
    normalizedSrc.startsWith("http://") ||
    normalizedSrc.startsWith("https://") ||
    normalizedSrc.startsWith("blob:") ||
    normalizedSrc.startsWith("asset://") ||
    normalizedSrc.startsWith("tauri://")
  ) {
    return normalizedSrc;
  }

  const { pathPart, suffix } = splitFilePathSuffix(normalizedSrc);
  const absolutePath = isAbsoluteLikePath(pathPart)
    ? normalizeResolvedFilePath(pathPart)
    : baseFilePath
      ? normalizeResolvedFilePath(
          joinFilePath(dirnameFromFilePath(baseFilePath), pathPart),
        )
      : "";
  if (!absolutePath) {
    return normalizedSrc;
  }

  return `${convertLocalFileSrc(absolutePath)}${suffix}`;
}

function resolveCodePresentationMode(
  language: string,
  codeContent: string,
): "syntax" | "plain" | "flow" {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const trimmed = codeContent.trim();
  if (!trimmed) {
    return "plain";
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const arrowRows = lines.filter((line) =>
    FLOW_ARROW_ONLY_PATTERN.test(line),
  ).length;
  const bulletRows = lines.filter((line) => /^[-*]\s+/.test(line)).length;
  const hasCodeSignals = CODE_SIGNAL_PATTERN.test(trimmed);

  if (
    (PLAIN_TEXT_LANGUAGES.has(normalizedLanguage) || !hasCodeSignals) &&
    arrowRows >= 2
  ) {
    return "flow";
  }

  if (
    PLAIN_TEXT_LANGUAGES.has(normalizedLanguage) ||
    (!hasCodeSignals && (bulletRows >= 2 || lines.length >= 4))
  ) {
    return "plain";
  }

  return "syntax";
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  ({
    content,
    baseFilePath,
    onA2UISubmit,
    renderA2UIInline = true,
    collapseCodeBlocks = false,
    shouldCollapseCodeBlock,
    onCodeBlockClick,
    isStreaming = false,
    showBlockActions = false,
    onQuoteContent,
  }) => {
    const [copied, setCopied] = React.useState<string | null>(null);
    const copyTimeoutRef = React.useRef<number | null>(null);
    const blockRef = React.useRef<HTMLDivElement | null>(null);
    const selectionSnapshotRef = React.useRef<string | null>(null);
    const useLightweightStreamingRender =
      isStreaming && content.length >= STREAMING_LIGHT_RENDER_THRESHOLD;
    const debouncedStreamingContent = useDebouncedValue(
      content,
      useLightweightStreamingRender
        ? STREAMING_LIGHT_RENDER_DEBOUNCE_MS
        : STREAMING_STANDARD_RENDER_DEBOUNCE_MS,
      {
        maxWait: useLightweightStreamingRender
          ? STREAMING_LIGHT_RENDER_DEBOUNCE_MS
          : STREAMING_STANDARD_RENDER_DEBOUNCE_MS,
      },
    );
    const renderContent = isStreaming ? debouncedStreamingContent : content;

    const remarkPlugins = React.useMemo(
      () =>
        useLightweightStreamingRender ? [remarkGfm] : [remarkGfm, remarkMath],
      [useLightweightStreamingRender],
    );

    const rehypePlugins = React.useMemo(
      () => (useLightweightStreamingRender ? [] : [rehypeRaw, rehypeKatex]),
      [useLightweightStreamingRender],
    );
    const resolveImageSrc = React.useCallback(
      (src?: string | null) => {
        if (typeof src !== "string") {
          return "";
        }
        return resolveMarkdownImageSrc(src, baseFilePath);
      },
      [baseFilePath],
    );

    React.useEffect(() => {
      return () => {
        if (copyTimeoutRef.current !== null) {
          window.clearTimeout(copyTimeoutRef.current);
        }
      };
    }, []);

    const handleCopy = React.useCallback(
      async (copyKey: string, value: string) => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(copyKey);
          if (copyTimeoutRef.current !== null) {
            window.clearTimeout(copyTimeoutRef.current);
          }
          copyTimeoutRef.current = window.setTimeout(
            () => setCopied(null),
            1200,
          );
        } catch {
          // 剪贴板在受限上下文里可能不可用，这里保持静默降级。
        }
      },
      [],
    );

    const getSelectedMarkdownText = React.useCallback(() => {
      const block = blockRef.current;
      const selection = window.getSelection();
      if (
        !block ||
        !selection ||
        selection.rangeCount === 0 ||
        selection.isCollapsed
      ) {
        return null;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText) {
        return null;
      }

      const range = selection.getRangeAt(0);
      if (!block.contains(range.commonAncestorContainer)) {
        return null;
      }

      const isWithinControls = (node: Node | null) => {
        if (!node) {
          return false;
        }

        const element = node instanceof Element ? node : node.parentElement;
        return Boolean(
          element?.closest(
            '[data-markdown-block-actions], [aria-label="复制代码块"]',
          ),
        );
      };

      if (
        isWithinControls(selection.anchorNode) ||
        isWithinControls(selection.focusNode)
      ) {
        return null;
      }

      return selectedText;
    }, []);

    const normalizedContent = React.useMemo(() => content.trim(), [content]);
    const canShowBlockActions = showBlockActions && Boolean(normalizedContent);
    const isContentCopied = copied?.startsWith("content:") ?? false;
    const handleQuoteContent = React.useCallback(() => {
      if (!onQuoteContent) {
        return;
      }

      const selectedText =
        getSelectedMarkdownText() ?? selectionSnapshotRef.current ?? undefined;
      selectionSnapshotRef.current = null;
      onQuoteContent(
        selectedText?.trim().length ? selectedText : normalizedContent,
      );
    }, [getSelectedMarkdownText, normalizedContent, onQuoteContent]);

    const handleCopyContent = React.useCallback(async () => {
      const selectedText =
        getSelectedMarkdownText() ?? selectionSnapshotRef.current ?? undefined;
      selectionSnapshotRef.current = null;
      const copyValue = selectedText?.trim().length
        ? selectedText
        : normalizedContent;
      if (!copyValue) {
        return;
      }
      await handleCopy(`content:${copyValue}`, copyValue);
    }, [getSelectedMarkdownText, handleCopy, normalizedContent]);

    // 预处理内容：检测并提取 base64 图片
    const processedContent = React.useMemo(() => {
      // 匹配 markdown 图片语法中的 base64 data URL
      const base64ImageRegex =
        /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      let result = renderContent;
      const images: { alt: string; src: string; placeholder: string }[] = [];

      let match;
      let index = 0;
      while ((match = base64ImageRegex.exec(renderContent)) !== null) {
        const placeholder = `__BASE64_IMAGE_${index}__`;
        images.push({
          alt: match[1] || "Generated Image",
          src: match[2],
          placeholder,
        });
        result = result.replace(match[0], placeholder);
        index++;
      }

      return { text: result, images };
    }, [renderContent]);

    // 渲染 base64 图片
    const renderBase64Images = () => {
      if (processedContent.images.length === 0) return null;

      return processedContent.images.map((img, idx) => {
        const handleImageClick = () => {
          const newWindow = window.open();
          if (newWindow) {
            newWindow.document.write(`
              <html>
                <head>
                  <title>${img.alt}</title>
                  <style>
                    body { 
                      margin: 0; 
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      min-height: 100vh; 
                      background: #1a1a1a; 
                    }
                    img { 
                      max-width: 100%; 
                      max-height: 100vh; 
                      object-fit: contain; 
                    }
                  </style>
                </head>
                <body>
                  <img src="${img.src}" alt="${img.alt}" />
                </body>
              </html>
            `);
            newWindow.document.close();
          }
        };

        return (
          <ImageContainer key={`base64-img-${idx}`}>
            <GeneratedImage
              src={img.src}
              alt={img.alt}
              onClick={handleImageClick}
              title="点击查看大图"
              onError={(e) => {
                console.error("[MarkdownRenderer] 图片加载失败:", img.alt);
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <ImageCaption>图片 · 点击查看大图</ImageCaption>
          </ImageContainer>
        );
      });
    };

    // 检查处理后的文本是否只包含占位符
    const hasOnlyPlaceholders = React.useMemo(() => {
      const trimmed = processedContent.text.trim();
      return /^(__BASE64_IMAGE_\d+__\s*)+$/.test(trimmed) || trimmed === "";
    }, [processedContent.text]);

    const renderPlainTextCodeBlock = React.useCallback(
      (language: string, codeContent: string) => {
        const copyKey = `code:${codeContent}`;
        const isCopied = copied === copyKey;

        return (
          <CodeBlockContainer data-testid="markdown-plain-code-block">
            <CodeHeader>
              <span>{language}</span>
              <CopyButton
                type="button"
                onClick={() => void handleCopy(copyKey, codeContent)}
                aria-label="复制代码块"
                title={isCopied ? "已复制" : "复制"}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                {isCopied ? "已复制" : "复制"}
              </CopyButton>
            </CodeHeader>
            <div className="overflow-auto px-3 py-3">
              <div
                data-testid="markdown-plain-code-content"
                className="whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-100"
                style={{
                  margin: 0,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  fontFamily: CODE_FONT_FAMILY,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  textShadow: "none",
                  fontVariantLigatures: "none",
                }}
              >
                {codeContent}
              </div>
            </div>
          </CodeBlockContainer>
        );
      },
      [copied, handleCopy],
    );

    const renderFlowCodeBlock = React.useCallback(
      (language: string, codeContent: string) => {
        const copyKey = `code:${codeContent}`;
        const isCopied = copied === copyKey;
        const lines = codeContent
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        return (
          <CodeBlockContainer data-testid="markdown-flow-code-block">
            <CodeHeader>
              <span>{language}</span>
              <CopyButton
                type="button"
                onClick={() => void handleCopy(copyKey, codeContent)}
                aria-label="复制代码块"
                title={isCopied ? "已复制" : "复制"}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                {isCopied ? "已复制" : "复制"}
              </CopyButton>
            </CodeHeader>
            <div className="space-y-1.5 px-3 py-3">
              {lines.map((line, index) =>
                FLOW_ARROW_ONLY_PATTERN.test(line) ? (
                  <div
                    key={`${line}:${index}`}
                    className="pl-3 text-sm leading-5 text-slate-400"
                    style={{
                      fontFamily: CODE_FONT_FAMILY,
                      textShadow: "none",
                      fontVariantLigatures: "none",
                    }}
                  >
                    {line}
                  </div>
                ) : (
                  <div
                    key={`${line}:${index}`}
                    className="inline-flex max-w-full items-center rounded-xl border border-slate-700/80 bg-slate-50/95 px-3 py-1.5 text-[12px] leading-5 text-slate-900 shadow-sm"
                    style={{
                      fontFamily: CODE_FONT_FAMILY,
                      textShadow: "none",
                      fontVariantLigatures: "none",
                    }}
                  >
                    {line}
                  </div>
                ),
              )}
            </div>
          </CodeBlockContainer>
        );
      },
      [copied, handleCopy],
    );

    return (
      <MarkdownBlockShell ref={blockRef}>
        {canShowBlockActions ? (
          <MarkdownBlockActions data-markdown-block-actions>
            {onQuoteContent ? (
              <MarkdownBlockActionButton
                type="button"
                onMouseDown={() => {
                  selectionSnapshotRef.current = getSelectedMarkdownText();
                }}
                onTouchStart={() => {
                  selectionSnapshotRef.current = getSelectedMarkdownText();
                }}
                onClick={handleQuoteContent}
                aria-label="引用内容区块"
                title="引用内容区块"
              >
                <Quote size={14} />
              </MarkdownBlockActionButton>
            ) : null}
            <MarkdownBlockActionButton
              type="button"
              onMouseDown={() => {
                selectionSnapshotRef.current = getSelectedMarkdownText();
              }}
              onTouchStart={() => {
                selectionSnapshotRef.current = getSelectedMarkdownText();
              }}
              onClick={() => void handleCopyContent()}
              aria-label="复制内容区块"
              title={isContentCopied ? "已复制" : "复制内容区块"}
            >
              {isContentCopied ? <Check size={14} /> : <Copy size={14} />}
            </MarkdownBlockActionButton>
          </MarkdownBlockActions>
        ) : null}
        <MarkdownContainer>
          {/* 先渲染 base64 图片 */}
          {renderBase64Images()}

          {/* 如果还有其他内容，渲染 markdown */}
          {!hasOnlyPlaceholders && processedContent.text.trim() && (
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              skipHtml={useLightweightStreamingRender}
              components={{
                // 使用 pre 组件来处理代码块，以便更好地控制 a2ui 的渲染
                pre({ children, ...props }: any) {
                  // ReactMarkdown 传递的 children 是一个 React 元素
                  // 需要通过 React.Children 来正确访问
                  const child = React.Children.toArray(
                    children,
                  )[0] as React.ReactElement;
                  if (!child || !React.isValidElement(child)) {
                    return <pre {...props}>{children}</pre>;
                  }

                  const childProps = child.props as any;
                  const className = childProps?.className || "";
                  const rawLanguage = extractCodeLanguageToken(className);
                  const language = normalizeCodeLanguage(rawLanguage);
                  const codeChildren = childProps?.children;
                  const codeContent = String(
                    Array.isArray(codeChildren)
                      ? codeChildren.join("")
                      : codeChildren || "",
                  ).replace(/\n$/, "");

                  // 如果是 a2ui 代码块，特殊处理
                  if (language === "a2ui") {
                    if (!renderA2UIInline) {
                      return null;
                    }

                    const parsed = parseA2UIJson(codeContent);

                    if (parsed) {
                      // 解析成功，直接渲染 A2UI 组件（不包裹在 pre 中）
                      return (
                        <A2UITaskCard
                          response={parsed}
                          onSubmit={onA2UISubmit}
                          preset={CHAT_A2UI_TASK_CARD_PRESET}
                        />
                      );
                    } else {
                      // 解析失败（可能是流式输出中，JSON 还不完整）
                      return (
                        <A2UITaskLoadingCard
                          preset={CHAT_A2UI_TASK_CARD_PRESET}
                          subtitle="正在解析结构化问题，请稍等。"
                        />
                      );
                    }
                  }

                  // 如果启用了代码块折叠，显示占位符卡片
                  const shouldRenderArtifactPlaceholder =
                    collapseCodeBlocks &&
                    (shouldCollapseCodeBlock
                      ? shouldCollapseCodeBlock(rawLanguage, codeContent)
                      : true);

                  if (shouldRenderArtifactPlaceholder) {
                    const lineCount = codeContent.split("\n").length;
                    return (
                      <ArtifactPlaceholder
                        language={rawLanguage}
                        lineCount={isStreaming ? undefined : lineCount}
                        isStreaming={isStreaming}
                        onClick={() =>
                          onCodeBlockClick?.(rawLanguage, codeContent)
                        }
                      />
                    );
                  }

                  if (useLightweightStreamingRender) {
                    return (
                      <pre {...props}>
                        <code className={className}>{codeContent}</code>
                      </pre>
                    );
                  }

                  const presentationMode = resolveCodePresentationMode(
                    language,
                    codeContent,
                  );
                  if (presentationMode === "flow") {
                    return renderFlowCodeBlock(language, codeContent);
                  }
                  if (presentationMode === "plain") {
                    return renderPlainTextCodeBlock(language, codeContent);
                  }

                  // Block code - 完整显示
                  const copyKey = `code:${codeContent}`;
                  const isCopied = copied === copyKey;

                  return (
                    <CodeBlockContainer>
                      <CodeHeader>
                        <span>{language}</span>
                        <CopyButton
                          type="button"
                          onClick={() => void handleCopy(copyKey, codeContent)}
                          aria-label="复制代码块"
                          title={isCopied ? "已复制" : "复制"}
                        >
                          {isCopied ? <Check size={14} /> : <Copy size={14} />}
                          {isCopied ? "已复制" : "复制"}
                        </CopyButton>
                      </CodeHeader>
                      <SyntaxHighlighter
                        style={oneDark}
                        language={language}
                        PreTag="div"
                        codeTagProps={{
                          style: {
                            display: "block",
                            fontFamily: CODE_FONT_FAMILY,
                            fontVariantLigatures: "none",
                            padding: 0,
                            border: "none",
                            borderRadius: 0,
                            background: "transparent",
                            color: "inherit",
                            textShadow: "none",
                          },
                        }}
                        customStyle={{
                          margin: 0,
                          padding: "10px 12px 12px",
                          background: "transparent",
                          fontSize: "12px",
                          lineHeight: "1.5",
                          fontFamily: CODE_FONT_FAMILY,
                          textShadow: "none",
                          fontVariantLigatures: "none",
                        }}
                      >
                        {codeContent}
                      </SyntaxHighlighter>
                    </CodeBlockContainer>
                  );
                },
                code({ inline, className, children, ...props }: any) {
                  const content = String(
                    Array.isArray(children)
                      ? children.join("")
                      : children || "",
                  );
                  const isInlineCode =
                    typeof inline === "boolean"
                      ? inline
                      : !className && !content.includes("\n");

                  if (isInlineCode) {
                    return (
                      <code
                        className={className}
                        data-inline-code="true"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }

                  // 非 inline code 统一由 pre 组件处理，避免块级元素落入 <p>
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                // 普通图片渲染（非 base64）
                img({ src, alt, ...props }: any) {
                  // base64 图片已经在上面单独处理了，这里只处理普通 URL 图片
                  if (src?.startsWith("data:")) {
                    return null; // 跳过 base64 图片，已在上面处理
                  }
                  const resolvedSrc = resolveImageSrc(src);

                  const handleImageClick = () => {
                    if (resolvedSrc) {
                      window.open(resolvedSrc, "_blank");
                    }
                  };

                  return (
                    <GeneratedImage
                      src={resolvedSrc}
                      alt={alt || "Image"}
                      onClick={handleImageClick}
                      title="点击查看大图"
                      {...props}
                    />
                  );
                },
                h1({ children, ...props }: any) {
                  return (
                    <h1 data-markdown-heading-level="1" {...props}>
                      {children}
                    </h1>
                  );
                },
                h2({ children, ...props }: any) {
                  return (
                    <h2 data-markdown-heading-level="2" {...props}>
                      {children}
                    </h2>
                  );
                },
                h3({ children, ...props }: any) {
                  return (
                    <h3 data-markdown-heading-level="3" {...props}>
                      {children}
                    </h3>
                  );
                },
                blockquote({ children }: any) {
                  return (
                    <MarkdownQuoteCard data-testid="markdown-blockquote-card">
                      <MarkdownQuoteInner>
                        <MarkdownQuoteIconShell aria-hidden="true">
                          <Quote size={15} />
                        </MarkdownQuoteIconShell>
                        <MarkdownQuoteBody>{children}</MarkdownQuoteBody>
                      </MarkdownQuoteInner>
                    </MarkdownQuoteCard>
                  );
                },
                hr() {
                  return <MarkdownDivider data-testid="markdown-divider" />;
                },
                table({ children, ...props }: any) {
                  return (
                    <MarkdownTableScroll data-testid="markdown-table-scroll">
                      <table {...props}>{children}</table>
                    </MarkdownTableScroll>
                  );
                },
              }}
            >
              {processedContent.text}
            </ReactMarkdown>
          )}
        </MarkdownContainer>
      </MarkdownBlockShell>
    );
  },
);

MarkdownRenderer.displayName = "MarkdownRenderer";
