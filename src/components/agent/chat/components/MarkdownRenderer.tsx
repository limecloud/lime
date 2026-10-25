import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check, Quote } from "lucide-react";
import { parseA2UIJson } from "@/components/workspace/a2ui/parser";
import type { A2UIFormData } from "@/components/workspace/a2ui/types";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/components/workspace/a2ui/taskCardPresets";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import { readFilePreview } from "@/lib/api/fileBrowser";
import {
  hasDesktopHostInvokeCapability,
  hasDesktopHostRuntimeMarkers,
} from "@/lib/desktop-runtime";
import { interceptHttpExternalLinkClick } from "@/lib/markdown/externalLinks";
import { resolveMarkdownImageSrc } from "@/lib/markdown/resolveMarkdownImageSrc";
import {
  parseMarkdownBundleImageOverrides,
  resolveMarkdownBundleMetaPath,
} from "@/lib/markdown/markdownBundleMeta";
import { normalizeLooseMarkdownSyntax } from "../utils/markdownLooseSyntaxNormalizer";
import { ArtifactPlaceholder } from "./ArtifactPlaceholder";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import { MarkdownImageWithFallback } from "./MarkdownImageWithFallback";
import { MarkdownLink } from "./MarkdownLink";
import { markdownElements } from "./MarkdownElements";
import { remarkPromptLinks } from "./remarkPromptLinks";
import { remarkCjkAutolinks } from "./remarkCjkAutolinks";
import {
  CODE_FONT_FAMILY,
  CodeBlockContainer,
  CodeHeader,
  CodeHeaderInfo,
  CodeLanguageLabel,
  CodeLineCount,
  CopyButton,
  MarkdownBlockActionButton,
  MarkdownBlockActions,
  MarkdownBlockShell,
  MarkdownContainer,
} from "./MarkdownRendererStyles";
import {
  FLOW_ARROW_ONLY_PATTERN,
  extractCodeLanguageToken,
  normalizeCodeLanguage,
  normalizeCollapsedMarkdownBlocks,
  normalizeCompactPipeTables,
  normalizeInlineFollowUpListMarkers,
  normalizeMarkdownTableFences,
  resolveCodePresentationMode,
} from "./MarkdownRendererMarkdownModel";

const STREAMING_LIGHT_RENDER_THRESHOLD = 2_000;
const STREAMING_LIGHT_RENDER_DEBOUNCE_MS = 48;
const MARKDOWN_BUNDLE_META_MAX_SIZE = 64 * 1024;

function isLocalImagePreviewUrl(value: string): boolean {
  return (
    value.startsWith("file://") ||
    value.startsWith("asset://") ||
    value.startsWith("desktop-host://") ||
    value.startsWith("blob:") ||
    value.startsWith("data:image/")
  );
}

function transformMarkdownUrl(value: string, key: string): string {
  const normalizedValue = value.trim();
  if (key === "src" && isLocalImagePreviewUrl(normalizedValue)) {
    return value;
  }
  return defaultUrlTransform(value);
}

function hasDesktopHostImagePreviewBoundary(): boolean {
  return hasDesktopHostRuntimeMarkers() || hasDesktopHostInvokeCapability();
}

interface MarkdownRendererProps {
  content: string;
  /** 当前 Markdown 文件路径，用于解析相对图片资源 */
  baseFilePath?: string;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** 历史消息中的 A2UI 只允许回显，不能再次提交。 */
  readOnlyA2UI?: boolean;
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
  /** 历史恢复等冷路径可用轻量模式，避开高成本 HTML/Katex/语法高亮。 */
  renderMode?: MarkdownRenderMode;
  promptLinkItemId?: string;
}

export type MarkdownRenderMode = "standard" | "light";

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  ({
    content,
    baseFilePath,
    onA2UISubmit,
    renderA2UIInline = true,
    readOnlyA2UI = false,
    collapseCodeBlocks = false,
    shouldCollapseCodeBlock,
    onCodeBlockClick,
    isStreaming = false,
    showBlockActions = false,
    onQuoteContent,
    renderMode = "standard",
    promptLinkItemId,
  }) => {
    const { t } = useTranslation("agent");
    const renderLink = React.useCallback(
      (props: React.ComponentProps<typeof MarkdownLink>) => (
        <MarkdownLink {...props} itemId={promptLinkItemId} />
      ),
      [promptLinkItemId],
    );
    const [copied, setCopied] = React.useState<string | null>(null);
    const [bundleImageOverrides, setBundleImageOverrides] = React.useState<
      Record<string, string>
    >({});
    const copyTimeoutRef = React.useRef<number | null>(null);
    const blockRef = React.useRef<HTMLDivElement | null>(null);
    const selectionSnapshotRef = React.useRef<string | null>(null);
    const useLightweightStreamingRender =
      isStreaming && content.length >= STREAMING_LIGHT_RENDER_THRESHOLD;
    const useLightweightMarkdownRender =
      renderMode === "light" || useLightweightStreamingRender;
    // 普通 streaming 的稳定/尾巴分区由 StreamingMarkdownContent 负责；
    // MarkdownRenderer 只对超长内容保留重渲染防抖。
    const shouldDebounceStreamingContent = useLightweightStreamingRender;
    const debouncedStreamingContent = useDebouncedValue(
      content,
      shouldDebounceStreamingContent ? STREAMING_LIGHT_RENDER_DEBOUNCE_MS : 0,
      {
        maxWait: shouldDebounceStreamingContent
          ? STREAMING_LIGHT_RENDER_DEBOUNCE_MS
          : undefined,
      },
    );
    const renderContent = isStreaming
      ? shouldDebounceStreamingContent
        ? debouncedStreamingContent
        : content
      : content;

    const remarkPlugins = React.useMemo(
      () =>
        useLightweightMarkdownRender
          ? [remarkGfm, remarkPromptLinks, remarkCjkAutolinks]
          : [remarkGfm, remarkMath, remarkPromptLinks, remarkCjkAutolinks],
      [useLightweightMarkdownRender],
    );

    const rehypePlugins = React.useMemo(
      () => (useLightweightMarkdownRender ? [] : [rehypeRaw, rehypeKatex]),
      [useLightweightMarkdownRender],
    );
    const hasRemoteImageReferences = React.useMemo(
      () => /https?:\/\//i.test(content),
      [content],
    );

    React.useEffect(() => {
      const metaPath = resolveMarkdownBundleMetaPath(baseFilePath);
      if (!metaPath || !hasRemoteImageReferences) {
        setBundleImageOverrides((previous) =>
          Object.keys(previous).length === 0 ? previous : {},
        );
        return;
      }

      let cancelled = false;
      void (async () => {
        try {
          const preview = await readFilePreview(
            metaPath,
            MARKDOWN_BUNDLE_META_MAX_SIZE,
          );
          if (cancelled) {
            return;
          }

          if (
            preview.error ||
            preview.isBinary ||
            typeof preview.content !== "string"
          ) {
            setBundleImageOverrides({});
            return;
          }

          setBundleImageOverrides(
            parseMarkdownBundleImageOverrides(preview.content),
          );
        } catch {
          if (!cancelled) {
            setBundleImageOverrides({});
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [baseFilePath, hasRemoteImageReferences]);

    const resolveImageSrc = React.useCallback(
      (src?: string | null) => {
        if (typeof src !== "string") {
          return "";
        }
        const normalizedSrc = src.trim();
        const overriddenSrc =
          bundleImageOverrides[normalizedSrc] || normalizedSrc;
        return resolveMarkdownImageSrc(overriddenSrc, baseFilePath);
      },
      [baseFilePath, bundleImageOverrides],
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
            "[data-markdown-block-actions], [data-markdown-code-action]",
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
    const copiedLabel = t("agentChat.markdown.code.copied");
    const copyLabel = t("agentChat.markdown.code.copy");
    const copyCodeBlockLabel = t("agentChat.markdown.code.copyBlock");
    const getCodeLineCountLabel = React.useCallback(
      (codeContent: string) =>
        t("agentChat.markdown.code.lineCount", {
          count: codeContent.length > 0 ? codeContent.split("\n").length : 0,
        }),
      [t],
    );
    const renderCodeHeaderInfo = React.useCallback(
      (language: string, codeContent: string) => (
        <CodeHeaderInfo>
          <CodeLanguageLabel>{language}</CodeLanguageLabel>
          <CodeLineCount>{getCodeLineCountLabel(codeContent)}</CodeLineCount>
        </CodeHeaderInfo>
      ),
      [getCodeLineCountLabel],
    );
    const imageOpenTitle = t("agentChat.markdown.image.openTitle");
    const imageCaption = t("agentChat.markdown.image.caption");
    const imageUnavailableLabel = t("agentChat.markdown.image.unavailable");
    const imageDefaultAlt = t("agentChat.markdown.image.defaultAlt");
    const quoteContentBlockLabel = t("agentChat.markdown.block.quote");
    const copyContentBlockLabel = t("agentChat.markdown.block.copy");
    const shouldBlockBrowserImagePreview = React.useCallback(
      (source: string) => {
        if (!hasDesktopHostImagePreviewBoundary()) {
          return false;
        }

        console.error(
          "[MarkdownRenderer] Desktop Host image preview cannot fall back to browser window",
          source,
        );
        return true;
      },
      [],
    );
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
          alt: match[1] || imageDefaultAlt,
          src: match[2],
          placeholder,
        });
        result = result.replace(match[0], placeholder);
        index++;
      }

      return {
        text: normalizeCompactPipeTables(
          normalizeMarkdownTableFences(
            normalizeLooseMarkdownSyntax(
              normalizeInlineFollowUpListMarkers(
                normalizeCollapsedMarkdownBlocks(result),
              ),
            ),
          ),
        ),
        images,
      };
    }, [imageDefaultAlt, renderContent]);

    // 渲染 base64 图片
    const renderBase64Images = () => {
      if (processedContent.images.length === 0) return null;

      return processedContent.images.map((img, idx) => {
        const handleImageClick = () => {
          if (shouldBlockBrowserImagePreview(img.src)) {
            return;
          }

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
          <MarkdownImageWithFallback
            key={`base64-img-${idx}`}
            src={img.src}
            alt={img.alt}
            onClick={handleImageClick}
            title={imageOpenTitle}
            caption={imageCaption}
            unavailableLabel={imageUnavailableLabel}
          />
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
              {renderCodeHeaderInfo(language, codeContent)}
              <CopyButton
                type="button"
                data-markdown-code-action
                onClick={() => void handleCopy(copyKey, codeContent)}
                aria-label={copyCodeBlockLabel}
                title={isCopied ? copiedLabel : copyLabel}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                {isCopied ? copiedLabel : copyLabel}
              </CopyButton>
            </CodeHeader>
            <div className="overflow-auto px-3 py-3">
              <div
                data-testid="markdown-plain-code-content"
                className="whitespace-pre-wrap break-words text-[12px] leading-6 text-slate-700"
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
      [
        copied,
        copiedLabel,
        copyCodeBlockLabel,
        copyLabel,
        handleCopy,
        renderCodeHeaderInfo,
      ],
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
              {renderCodeHeaderInfo(language, codeContent)}
              <CopyButton
                type="button"
                data-markdown-code-action
                onClick={() => void handleCopy(copyKey, codeContent)}
                aria-label={copyCodeBlockLabel}
                title={isCopied ? copiedLabel : copyLabel}
              >
                {isCopied ? <Check size={14} /> : <Copy size={14} />}
                {isCopied ? copiedLabel : copyLabel}
              </CopyButton>
            </CodeHeader>
            <div className="space-y-1.5 px-3 py-3">
              {lines.map((line, index) =>
                FLOW_ARROW_ONLY_PATTERN.test(line) ? (
                  <div
                    key={`${line}:${index}`}
                    className="pl-3 text-sm leading-5 text-slate-500"
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
                    className="inline-flex max-w-full items-center rounded-xl border border-slate-200 bg-white/90 px-3 py-1.5 text-[12px] leading-5 text-slate-700 shadow-sm"
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
      [
        copied,
        copiedLabel,
        copyCodeBlockLabel,
        copyLabel,
        handleCopy,
        renderCodeHeaderInfo,
      ],
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
                aria-label={quoteContentBlockLabel}
                title={quoteContentBlockLabel}
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
              aria-label={copyContentBlockLabel}
              title={isContentCopied ? copiedLabel : copyContentBlockLabel}
            >
              {isContentCopied ? <Check size={14} /> : <Copy size={14} />}
            </MarkdownBlockActionButton>
          </MarkdownBlockActions>
        ) : null}
        <MarkdownContainer>
          {renderBase64Images()}

          {!hasOnlyPlaceholders && processedContent.text.trim() && (
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              skipHtml={useLightweightMarkdownRender}
              urlTransform={transformMarkdownUrl}
              components={{
                ...markdownElements,
                a: renderLink,
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
                      const response = readOnlyA2UI
                        ? { ...parsed, submitAction: undefined }
                        : parsed;
                      // 解析成功，直接渲染 A2UI 组件（不包裹在 pre 中）
                      return (
                        <A2UITaskCard
                          response={response}
                          onSubmit={readOnlyA2UI ? undefined : onA2UISubmit}
                          preset={CHAT_A2UI_TASK_CARD_PRESET}
                          compact={true}
                          className="max-w-[432px]"
                          preview={readOnlyA2UI}
                        />
                      );
                    } else {
                      // 解析失败（可能是流式输出中，JSON 还不完整）
                      return (
                        <A2UITaskLoadingCard
                          preset={CHAT_A2UI_TASK_CARD_PRESET}
                          subtitle={t("agentChat.markdown.a2ui.parsing")}
                          compact={true}
                          className="max-w-[432px]"
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

                  if (useLightweightMarkdownRender) {
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
                    <CodeBlockContainer data-testid="markdown-syntax-code-block">
                      <CodeHeader>
                        {renderCodeHeaderInfo(language, codeContent)}
                        <CopyButton
                          type="button"
                          data-markdown-code-action
                          onClick={() => void handleCopy(copyKey, codeContent)}
                          aria-label={copyCodeBlockLabel}
                          title={isCopied ? copiedLabel : copyLabel}
                        >
                          {isCopied ? <Check size={14} /> : <Copy size={14} />}
                          {isCopied ? copiedLabel : copyLabel}
                        </CopyButton>
                      </CodeHeader>
                      <SyntaxHighlighter
                        style={oneLight}
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
                          padding: "12px 14px 14px",
                          background: "transparent",
                          fontSize: "12.5px",
                          lineHeight: "1.55",
                          fontFamily: CODE_FONT_FAMILY,
                          overflowX: "auto",
                          maxWidth: "100%",
                          textShadow: "none",
                          fontVariantLigatures: "none",
                        }}
                      >
                        {codeContent}
                      </SyntaxHighlighter>
                    </CodeBlockContainer>
                  );
                },
                // 普通图片渲染（非 base64）
                img({ src, alt, ...props }: any) {
                  // base64 图片已经在上面单独处理了，这里只处理普通 URL 图片
                  if (src?.startsWith("data:")) {
                    return null; // 跳过 base64 图片，已在上面处理
                  }
                  const resolvedSrc = resolveImageSrc(src);

                  const handleImageClick = (
                    event: React.MouseEvent<HTMLImageElement>,
                  ) => {
                    if (
                      !interceptHttpExternalLinkClick(event, resolvedSrc) &&
                      resolvedSrc
                    ) {
                      if (shouldBlockBrowserImagePreview(resolvedSrc)) {
                        event.preventDefault();
                        return;
                      }

                      window.open(resolvedSrc, "_blank");
                    }
                  };

                  return (
                    <MarkdownImageWithFallback
                      src={resolvedSrc}
                      alt={alt}
                      onClick={handleImageClick}
                      title={imageOpenTitle}
                      unavailableLabel={imageUnavailableLabel}
                      {...props}
                    />
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
