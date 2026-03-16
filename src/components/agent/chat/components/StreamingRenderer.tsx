/**
 * 流式消息渲染组件
 *
 * 参考 aster UI 设计，支持思考内容、工具调用和实时 Markdown 渲染
 * Requirements: 9.3, 9.4
 */

import React, { memo, useMemo, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  Lightbulb,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";
import { ActionRequestA2UIPreviewCard } from "./ActionRequestA2UIPreviewCard";
import { ToolCallList, ToolCallItem } from "./ToolCallDisplay";
import { DecisionPanel } from "./DecisionPanel";
import { AgentPlanBlock } from "./AgentPlanBlock";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import type {
  A2UIFormData,
  ParseResult,
  ParsedMessageContent,
} from "@/components/content-creator/a2ui/types";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import type { ToolCallState } from "@/lib/api/agentStream";
import type {
  AgentRuntimeStatus,
  ContentPart,
  ActionRequired,
  ConfirmResponse,
  WriteArtifactContext,
} from "../types";
import { splitProposedPlanSegments } from "../utils/proposedPlan";
import { isActionRequestA2UICompatible } from "../utils/actionRequestA2UI";

const STRUCTURED_CONTENT_HINT_RE = /<a2ui|```\s*a2ui|<write_file|<document/i;
const STRUCTURED_PARSE_CACHE_LIMIT = 64;
const STREAMING_STRUCTURED_PARSE_DEBOUNCE_MS = 48;

// ============ 思考内容组件 ============

interface ThinkingBlockProps {
  content: string;
  defaultExpanded?: boolean;
}

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({
  content,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  if (!content) return null;

  return (
    <details
      className="bg-muted/50 border border-border rounded-lg overflow-hidden mb-3"
      open={expanded}
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground select-none flex items-center gap-2 hover:bg-muted/70 transition-colors">
        <Lightbulb className="w-4 h-4 text-yellow-500" />
        <span className="flex-1">思考过程</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </summary>
      <div className="px-3 py-2 border-t border-border bg-background/50">
        <MarkdownRenderer content={content} />
      </div>
    </details>
  );
};

// ============ 流式光标 ============

const StreamingCursor: React.FC = () => (
  <span
    className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-text-bottom animate-pulse"
    style={{ animationDuration: "1s" }}
  />
);

const EMPTY_PARSE_RESULT: ParseResult = {
  parts: [],
  hasA2UI: false,
  hasWriteFile: false,
  hasPending: false,
};

function hasStructuredContentHint(text: string): boolean {
  return STRUCTURED_CONTENT_HINT_RE.test(text);
}

function createPlainTextParts(text: string): ParsedMessageContent[] {
  const trimmed = text.trim();
  return trimmed ? [{ type: "text", content: trimmed }] : [];
}

function parseStructuredContent(
  text: string,
  isStreaming: boolean,
): ParseResult {
  if (!text.trim()) {
    return EMPTY_PARSE_RESULT;
  }

  if (!hasStructuredContentHint(text)) {
    return {
      parts: createPlainTextParts(text),
      hasA2UI: false,
      hasWriteFile: false,
      hasPending: false,
    };
  }

  return parseAIResponse(text, isStreaming);
}

function getCachedStructuredParse(
  cacheRef: React.MutableRefObject<Map<string, ParseResult>>,
  text: string,
  isStreaming: boolean,
): ParseResult {
  const key = `${isStreaming ? "stream" : "static"}:${text}`;
  const cached = cacheRef.current.get(key);
  if (cached) {
    return cached;
  }

  const parsed = parseStructuredContent(text, isStreaming);
  if (cacheRef.current.size >= STRUCTURED_PARSE_CACHE_LIMIT) {
    const oldestKey = cacheRef.current.keys().next().value;
    if (oldestKey) {
      cacheRef.current.delete(oldestKey);
    }
  }
  cacheRef.current.set(key, parsed);
  return parsed;
}

interface PlanAwareMarkdownOptions {
  onA2UISubmit?: (formData: A2UIFormData) => void;
  renderA2UIInline?: boolean;
  collapseCodeBlocks?: boolean;
  onCodeBlockClick?: (language: string, code: string) => void;
  isStreaming?: boolean;
}

function renderPlanAwareMarkdown(
  text: string,
  keyPrefix: string,
  {
    onA2UISubmit,
    renderA2UIInline,
    collapseCodeBlocks,
    onCodeBlockClick,
    isStreaming,
  }: PlanAwareMarkdownOptions,
) {
  const segments = splitProposedPlanSegments(text);
  if (segments.length === 0) {
    return null;
  }

  return segments.map((segment, index) =>
    segment.type === "plan" ? (
      <AgentPlanBlock
        key={`${keyPrefix}-plan-${index}`}
        content={segment.content}
        isComplete={segment.isComplete}
      />
    ) : (
      <MarkdownRenderer
        key={`${keyPrefix}-text-${index}`}
        content={segment.content}
        onA2UISubmit={onA2UISubmit}
        renderA2UIInline={renderA2UIInline}
        collapseCodeBlocks={collapseCodeBlocks}
        onCodeBlockClick={onCodeBlockClick}
        isStreaming={isStreaming}
      />
    ),
  );
}

// ============ 流式文本组件（逐字符动画） ============

interface StreamingTextProps {
  /** 目标文本（完整内容） */
  text: string;
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 是否显示光标 */
  showCursor?: boolean;
  /** 每个字符的渲染间隔（毫秒），默认 12ms */
  charInterval?: number;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** A2UI 表单 ID（用于持久化） */
  a2uiFormId?: string;
  /** A2UI 初始表单数据（从数据库加载） */
  a2uiInitialFormData?: A2UIFormData;
  /** A2UI 表单数据变化回调（用于持久化） */
  onA2UIFormChange?: (formId: string, formData: A2UIFormData) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** 是否折叠代码块 */
  collapseCodeBlocks?: boolean;
  /** 代码块点击回调 */
  onCodeBlockClick?: (language: string, code: string) => void;
}

/**
 * 流式文本组件
 *
 * 实现逐字符平滑显示效果，类似 ChatGPT/Claude 的打字机效果。
 * 当流式结束时，立即显示完整文本。
 */
const StreamingText: React.FC<StreamingTextProps> = memo(
  ({
    text,
    isStreaming,
    showCursor = true,
    charInterval = 12,
    onA2UISubmit,
    a2uiFormId,
    a2uiInitialFormData,
    onA2UIFormChange,
    renderA2UIInline = true,
    collapseCodeBlocks,
    onCodeBlockClick,
  }) => {
    const [displayText, setDisplayText] = useState("");
    const displayIndexRef = useRef(0);
    const animationRef = useRef<number | null>(null);
    const prevTextRef = useRef("");
    const parseCacheRef = useRef<Map<string, ParseResult>>(new Map());

    useEffect(() => {
      // 如果不是流式输出，直接显示完整文本
      if (!isStreaming) {
        // 调试：确认非流式时是否正确设置完整文本
        if (text.includes("```a2ui")) {
          console.log(
            "[StreamingText] isStreaming=false, 包含 a2ui 代码块，长度:",
            text.length,
          );
        }
        setDisplayText(text);
        displayIndexRef.current = text.length;
        prevTextRef.current = text;
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        return;
      }

      // 检测文本是否有新增
      if (text.length <= prevTextRef.current.length) {
        prevTextRef.current = text;
        return;
      }

      prevTextRef.current = text;

      // 如果已经有动画在运行，让它继续
      if (animationRef.current !== null) {
        return;
      }

      let lastTime = 0;

      const animate = (currentTime: number) => {
        if (!lastTime) lastTime = currentTime;
        const elapsed = currentTime - lastTime;

        if (elapsed >= charInterval) {
          // 计算这一帧应该显示多少个字符
          const charsToAdd = Math.max(1, Math.floor(elapsed / charInterval));
          const newIndex = Math.min(
            displayIndexRef.current + charsToAdd,
            text.length,
          );

          if (newIndex > displayIndexRef.current) {
            displayIndexRef.current = newIndex;
            setDisplayText(text.slice(0, newIndex));
          }

          lastTime = currentTime;
        }

        // 继续动画直到追上目标
        if (displayIndexRef.current < text.length) {
          animationRef.current = requestAnimationFrame(animate);
        } else {
          animationRef.current = null;
        }
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
      };
    }, [text, isStreaming, charInterval]);

    // 组件卸载时清理
    useEffect(() => {
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, []);

    const shouldShowCursor =
      isStreaming && showCursor && displayIndexRef.current < text.length;
    const containsStructuredContent = useMemo(
      () => hasStructuredContentHint(displayText),
      [displayText],
    );
    const debouncedStructuredText = useDebouncedValue(
      displayText,
      isStreaming && containsStructuredContent
        ? STREAMING_STRUCTURED_PARSE_DEBOUNCE_MS
        : 0,
    );
    const parsedSourceText =
      isStreaming && containsStructuredContent
        ? debouncedStructuredText
        : displayText;

    // 使用 parseAIResponse 解析内容，以正确处理 a2ui 代码块
    // 这比依赖 MarkdownRenderer 的 pre 组件更可靠
    const parsedContent = useMemo(
      () =>
        getCachedStructuredParse(parseCacheRef, parsedSourceText, isStreaming),
      [parsedSourceText, isStreaming],
    );

    // 渲染解析后的内容
    const renderContent = () => {
      // 如果没有 a2ui 内容，直接使用 MarkdownRenderer
      if (!parsedContent.hasA2UI && !parsedContent.hasPending) {
        return renderPlanAwareMarkdown(displayText, "stream", {
          onA2UISubmit,
          renderA2UIInline,
          collapseCodeBlocks,
          onCodeBlockClick,
          isStreaming,
        });
      }

      // 有 a2ui 内容，按部分渲染
      return (
        <>
          {parsedContent.parts.map((part, index) => {
            switch (part.type) {
              case "a2ui":
                if (!renderA2UIInline) {
                  return null;
                }
                // 直接渲染 A2UI 表单
                if (typeof part.content !== "string") {
                  return (
                    <A2UITaskCard
                      key={`a2ui-${index}`}
                      response={part.content}
                      onSubmit={onA2UISubmit}
                      formId={a2uiFormId}
                      initialFormData={a2uiInitialFormData}
                      onFormChange={onA2UIFormChange}
                      preset={CHAT_A2UI_TASK_CARD_PRESET}
                    />
                  );
                }
                return null;

              case "pending_a2ui":
                if (!renderA2UIInline) {
                  return null;
                }
                // 显示加载状态
                return (
                  <A2UITaskLoadingCard
                    key={`pending-${index}`}
                    preset={CHAT_A2UI_TASK_CARD_PRESET}
                    subtitle="正在解析结构化问题，请稍等。"
                  />
                );

              case "text":
              default: {
                // 渲染普通文本
                const textContent =
                  typeof part.content === "string" ? part.content : "";
                if (!textContent || textContent.trim() === "") return null;
                return renderPlanAwareMarkdown(textContent, `text-${index}`, {
                  onA2UISubmit,
                  renderA2UIInline,
                  collapseCodeBlocks,
                  onCodeBlockClick,
                  isStreaming,
                });
              }
            }
          })}
        </>
      );
    };

    return (
      <div className="relative">
        {renderContent()}
        {shouldShowCursor && <StreamingCursor />}
      </div>
    );
  },
);

StreamingText.displayName = "StreamingText";

// ============ 思考内容解析 ============

interface ParsedContent {
  visibleText: string;
  thinkingText: string | null;
}

const parseThinkingContent = (text: string): ParsedContent => {
  // 支持 <think>...</think> 和 <thinking>...</thinking> 标签
  const thinkRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  let thinkingText: string | null = null;
  let visibleText = text;

  const matches = text.matchAll(thinkRegex);
  const thinkingParts: string[] = [];

  for (const match of matches) {
    thinkingParts.push(match[1].trim());
    visibleText = visibleText.replace(match[0], "");
  }

  if (thinkingParts.length > 0) {
    thinkingText = thinkingParts.join("\n\n");
  }

  return {
    visibleText: visibleText.trim(),
    thinkingText,
  };
};

// ============ 主组件 ============

interface StreamingRendererProps {
  /** 文本内容（向后兼容） */
  content: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 工具调用列表（向后兼容） */
  toolCalls?: ToolCallState[];
  /** 是否显示光标 */
  showCursor?: boolean;
  /** 思考内容（可选，如果不提供则从 content 中解析） */
  thinkingContent?: string;
  /**
   * 交错内容列表（按事件到达顺序排列）
   * 如果存在且非空，按顺序渲染
   * 否则回退到 content + toolCalls 渲染方式
   */
  contentParts?: ContentPart[];
  /** 权限确认请求列表（向后兼容） */
  actionRequests?: ActionRequired[];
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** A2UI 表单 ID（用于持久化） */
  a2uiFormId?: string;
  /** A2UI 初始表单数据（从数据库加载） */
  a2uiInitialFormData?: A2UIFormData;
  /** A2UI 表单数据变化回调（用于持久化） */
  onA2UIFormChange?: (formId: string, formData: A2UIFormData) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** 文件写入回调 */
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
  /** 文件点击回调 */
  onFileClick?: (fileName: string, content: string) => void;
  /** 权限确认响应回调 */
  onPermissionResponse?: (response: ConfirmResponse) => void;
  /** 是否折叠代码块（当画布打开时） */
  collapseCodeBlocks?: boolean;
  /** 代码块点击回调（用于在画布中显示） */
  onCodeBlockClick?: (language: string, code: string) => void;
  runtimeStatus?: AgentRuntimeStatus;
  showRuntimeStatusInline?: boolean;
  promoteActionRequestsToA2UI?: boolean;
}

const RUNTIME_PHASE_LABELS: Record<AgentRuntimeStatus["phase"], string> = {
  preparing: "准备中",
  routing: "回合建立中",
  context: "上下文装载中",
};

const AgentRuntimeStatusBlock: React.FC<{ status: AgentRuntimeStatus }> = ({
  status,
}) => (
  <div className="rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
    <div className="mb-2 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="text-sm font-medium text-foreground">{status.title}</div>
      <div className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/80 px-2.5 py-0.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {RUNTIME_PHASE_LABELS[status.phase]}
      </div>
    </div>
    <div className="text-sm text-muted-foreground">{status.detail}</div>
    {status.checkpoints && status.checkpoints.length > 0 ? (
      <div className="mt-3 flex flex-wrap gap-2">
        {status.checkpoints.map((item) => (
          <span
            key={item}
            className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
    ) : null}
  </div>
);

/**
 * 流式消息渲染组件
 *
 * 支持：
 * - 思考内容折叠显示（<think> 或 <thinking> 标签）
 * - 工具调用状态和结果显示
 * - 实时 Markdown 渲染
 * - 流式光标
 * - **交错内容显示**（文本和工具调用按事件顺序交错）
 */
export const StreamingRenderer: React.FC<StreamingRendererProps> = memo(
  ({
    content,
    isStreaming = false,
    toolCalls,
    showCursor = true,
    thinkingContent: externalThinking,
    contentParts,
    actionRequests,
    onA2UISubmit,
    a2uiFormId,
    a2uiInitialFormData,
    onA2UIFormChange,
    renderA2UIInline = true,
    onWriteFile,
    onFileClick,
    onPermissionResponse,
    collapseCodeBlocks,
    onCodeBlockClick,
    runtimeStatus,
    showRuntimeStatusInline = false,
    promoteActionRequestsToA2UI = false,
  }) => {
    const shouldRenderInlineActionRequest = React.useCallback(
      (request: ActionRequired) =>
        !(
          promoteActionRequestsToA2UI &&
          request.status === "pending" &&
          isActionRequestA2UICompatible(request)
        ),
      [promoteActionRequestsToA2UI],
    );

    // 判断是否使用交错显示模式
    const useInterleavedMode = contentParts && contentParts.length > 0;
    const parseCacheRef = useRef<Map<string, ParseResult>>(new Map());

    // 解析思考内容（仅在非交错模式下使用）
    const { visibleText, thinkingText } = useMemo(
      () => parseThinkingContent(content),
      [content],
    );
    const containsStructuredContent = useMemo(
      () => hasStructuredContentHint(visibleText),
      [visibleText],
    );
    const debouncedVisibleText = useDebouncedValue(
      visibleText,
      isStreaming && containsStructuredContent
        ? STREAMING_STRUCTURED_PARSE_DEBOUNCE_MS
        : 0,
    );
    const parsedVisibleText =
      isStreaming && containsStructuredContent
        ? debouncedVisibleText
        : visibleText;

    // 解析 A2UI 和 write_file 内容
    const parsedContent = useMemo(() => {
      if (useInterleavedMode) {
        return EMPTY_PARSE_RESULT;
      }
      const result = getCachedStructuredParse(
        parseCacheRef,
        parsedVisibleText,
        isStreaming,
      );
      // 添加调试日志
      if (result.hasWriteFile) {
        console.log(
          "[StreamingRenderer] 检测到 write_file:",
          result.parts.filter(
            (p) => p.type === "write_file" || p.type === "pending_write_file",
          ),
        );
      }
      return result;
    }, [parsedVisibleText, isStreaming, useInterleavedMode]);

    const interleavedParsedContent = useMemo(() => {
      if (!useInterleavedMode) {
        return [];
      }

      return (contentParts || []).map((part) => {
        if (part.type !== "text") {
          return EMPTY_PARSE_RESULT;
        }

        return getCachedStructuredParse(parseCacheRef, part.text, isStreaming);
      });
    }, [contentParts, isStreaming, useInterleavedMode]);

    // 处理文件写入 - 使用 ref 追踪同一路径的最新阶段与内容签名
    const processedWriteFilesRef = useRef<Map<string, string>>(new Map());

    const emitWriteFile = React.useCallback(
      (part: ParsedMessageContent, signatureKey: string) => {
        if (
          !onWriteFile ||
          (part.type !== "write_file" && part.type !== "pending_write_file") ||
          !part.filePath
        ) {
          return;
        }

        const contentValue =
          typeof part.content === "string" ? part.content : "";
        const signature = `${part.type}:${signatureKey}:${contentValue}`;
        const previousSignature = processedWriteFilesRef.current.get(
          part.filePath,
        );
        if (previousSignature === signature) {
          return;
        }

        processedWriteFilesRef.current.set(part.filePath, signature);
        const metadata: WriteArtifactContext["metadata"] = {
          writePhase:
            part.type === "pending_write_file"
              ? "streaming"
              : isStreaming
                ? "streaming"
                : "completed",
          previewText: contentValue.trim()
            ? contentValue.slice(0, 480).trim()
            : undefined,
          latestChunk: contentValue.trim()
            ? contentValue.slice(-240).trim()
            : undefined,
          isPartial: part.type === "pending_write_file" || isStreaming,
          lastUpdateSource: "message_content",
        };

        onWriteFile(contentValue, part.filePath, {
          source: "message_content",
          status:
            part.type === "pending_write_file" || isStreaming
              ? "streaming"
              : "complete",
          metadata,
        });
      },
      [isStreaming, onWriteFile],
    );

    useEffect(() => {
      if (!onWriteFile) return;

      const writeCandidates = useInterleavedMode
        ? interleavedParsedContent.flatMap((parsed, index) =>
            parsed.parts.map((part, partIndex) => ({
              part,
              signatureKey: `interleaved:${index}:${partIndex}`,
            })),
          )
        : parsedContent.parts.map((part, index) => ({
            part,
            signatureKey: `standard:${index}`,
          }));

      for (const candidate of writeCandidates) {
        if (
          candidate.part.type === "write_file" ||
          candidate.part.type === "pending_write_file"
        ) {
          emitWriteFile(candidate.part, candidate.signatureKey);
        }
      }
    }, [
      emitWriteFile,
      interleavedParsedContent,
      onWriteFile,
      parsedContent.parts,
      useInterleavedMode,
    ]);

    // 使用外部提供的思考内容或解析出的内容
    const finalThinking = externalThinking || thinkingText;

    // 判断是否有正在执行的工具
    const hasRunningTools = useMemo(() => {
      if (useInterleavedMode) {
        return contentParts.some(
          (part) =>
            part.type === "tool_use" && part.toolCall.status === "running",
        );
      }
      return toolCalls?.some((tc) => tc.status === "running") ?? false;
    }, [contentParts, toolCalls, useInterleavedMode]);

    // 判断是否显示光标
    const shouldShowCursor = isStreaming && showCursor && !hasRunningTools;

    // 判断是否有可见内容
    const hasVisibleContent = useInterleavedMode
      ? contentParts.some(
          (part) =>
            (part.type === "text" && part.text.length > 0) ||
            (part.type === "thinking" && part.text.length > 0),
        ) ||
        (isStreaming &&
          (content.length > 0 ||
            (externalThinking && externalThinking.length > 0)))
      : visibleText.length > 0;

    // 交错显示模式：按顺序渲染 contentParts
    if (useInterleavedMode) {
      return (
        <div className="flex flex-col gap-2">
          {/* 交错内容 - 不再在开头显示思考内容，避免重复 */}
          {contentParts.map((part, index) => {
            if (part.type === "text") {
              // 在交错模式下，不再解析 thinking 标签，避免重复显示
              // 直接使用原始文本内容
              const partText = part.text;
              if (!partText) return null;

              // 解析 write_file 标签
              const partParsed =
                interleavedParsedContent[index] || EMPTY_PARSE_RESULT;
              const isLastPart = index === contentParts.length - 1;

              // 添加调试日志
              if (partParsed.hasWriteFile) {
                console.log(
                  "[StreamingRenderer] 交错模式检测到 write_file:",
                  partParsed.parts.filter(
                    (p) =>
                      p.type === "write_file" ||
                      p.type === "pending_write_file",
                  ),
                );
              }

              // 如果包含 write_file，按部分渲染
              if (partParsed.hasWriteFile) {
                return (
                  <React.Fragment key={`text-${index}`}>
                    {partParsed.parts.map((p, pIndex) => {
                      if (
                        p.type === "write_file" ||
                        p.type === "pending_write_file"
                      ) {
                        const fileContent =
                          typeof p.content === "string" ? p.content : "";
                        return (
                          <div
                            key={`write-${index}-${pIndex}`}
                            className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors"
                            onClick={() =>
                              p.filePath &&
                              onFileClick?.(p.filePath, fileContent)
                            }
                          >
                            <FileText className="w-4 h-4" />
                            <span>写入</span>
                            <span className="font-medium text-foreground">
                              {p.filePath || "文档.md"}
                            </span>
                            {p.filePath ? (
                              <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                            ) : null}
                            {p.type === "pending_write_file" && (
                              <span className="animate-pulse">...</span>
                            )}
                          </div>
                        );
                      } else if (p.type === "text") {
                        const textContent =
                          typeof p.content === "string" ? p.content : "";
                        if (!textContent || textContent.trim() === "")
                          return null;
                        return (
                          <StreamingText
                            key={`text-${index}-${pIndex}`}
                            text={textContent}
                            isStreaming={
                              isStreaming &&
                              isLastPart &&
                              pIndex === partParsed.parts.length - 1
                            }
                            showCursor={
                              shouldShowCursor &&
                              isLastPart &&
                              pIndex === partParsed.parts.length - 1
                            }
                            onA2UISubmit={onA2UISubmit}
                            a2uiFormId={a2uiFormId}
                            a2uiInitialFormData={a2uiInitialFormData}
                            onA2UIFormChange={onA2UIFormChange}
                            collapseCodeBlocks={collapseCodeBlocks}
                            onCodeBlockClick={onCodeBlockClick}
                          />
                        );
                      }
                      return null;
                    })}
                  </React.Fragment>
                );
              }

              // 没有 write_file，直接渲染
              return (
                <StreamingText
                  key={`text-${index}`}
                  text={partText}
                  isStreaming={isStreaming && isLastPart}
                  showCursor={shouldShowCursor && isLastPart}
                  onA2UISubmit={onA2UISubmit}
                  a2uiFormId={a2uiFormId}
                  a2uiInitialFormData={a2uiInitialFormData}
                  onA2UIFormChange={onA2UIFormChange}
                  collapseCodeBlocks={collapseCodeBlocks}
                  onCodeBlockClick={onCodeBlockClick}
                />
              );
            } else if (part.type === "thinking") {
              // 渲染推理内容片段
              const isLastPart = index === contentParts.length - 1;
              return (
                <ThinkingBlock
                  key={`thinking-${index}`}
                  content={part.text}
                  defaultExpanded={isStreaming && isLastPart}
                />
              );
            } else if (part.type === "tool_use") {
              // 渲染单个工具调用
              return (
                <ToolCallItem
                  key={part.toolCall.id}
                  toolCall={part.toolCall}
                  isMessageStreaming={isStreaming}
                  onFileClick={onFileClick}
                />
              );
            } else if (part.type === "action_required") {
              if (
                isActionRequestA2UICompatible(part.actionRequired) &&
                (part.actionRequired.status === "submitted" ||
                  part.actionRequired.status === "queued")
              ) {
                return (
                  <ActionRequestA2UIPreviewCard
                    key={part.actionRequired.requestId}
                    request={part.actionRequired}
                    compact={true}
                    context="chat"
                  />
                );
              }
              if (!shouldRenderInlineActionRequest(part.actionRequired)) {
                return null;
              }
              // 渲染权限确认请求
              return (
                <DecisionPanel
                  key={part.actionRequired.requestId}
                  request={part.actionRequired}
                  onSubmit={onPermissionResponse || (() => {})}
                />
              );
            }
            return null;
          })}

          {/* 如果没有内容但正在流式输出，显示光标 */}
          {!hasVisibleContent &&
            isStreaming &&
            showCursor &&
            !hasRunningTools && (
              <div>
                <StreamingCursor />
              </div>
            )}
        </div>
      );
    }

    // 回退模式：传统的 content + toolCalls 分开渲染
    const hasToolCalls = toolCalls && toolCalls.length > 0;
    const visibleActionRequests = (actionRequests || []).filter(
      shouldRenderInlineActionRequest,
    );
    const hasActionRequests = visibleActionRequests.length > 0;
    const shouldShowRuntimeStatus =
      showRuntimeStatusInline &&
      Boolean(runtimeStatus) &&
      isStreaming &&
      !hasVisibleContent &&
      !hasToolCalls &&
      !hasActionRequests &&
      !hasRunningTools;

    // 渲染解析后的内容（包括 A2UI、write_file、普通文本）
    const renderParsedContent = () => {
      return parsedContent.parts.map((part, index) => {
        switch (part.type) {
          case "a2ui":
            if (!renderA2UIInline) {
              return null;
            }
            // 渲染 A2UI 表单 - content 是 A2UIResponse 类型
            if (typeof part.content !== "string") {
              return (
                <A2UITaskCard
                  key={`a2ui-${index}`}
                  response={part.content}
                  onSubmit={onA2UISubmit}
                  formId={a2uiFormId}
                  initialFormData={a2uiInitialFormData}
                  onFormChange={onA2UIFormChange}
                  preset={CHAT_A2UI_TASK_CARD_PRESET}
                />
              );
            }
            return null;

          case "write_file":
          case "pending_write_file": {
            // 显示文件写入指示器 - content 是 string 类型
            const fileContent =
              typeof part.content === "string" ? part.content : "";
            return (
              <div
                key={`write-${index}`}
                className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground cursor-pointer hover:bg-muted/70 transition-colors"
                onClick={() =>
                  part.filePath && onFileClick?.(part.filePath, fileContent)
                }
              >
                <FileText className="w-4 h-4" />
                <span>写入</span>
                <span className="font-medium text-foreground">
                  {part.filePath || "文档.md"}
                </span>
                {part.filePath ? (
                  <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                ) : null}
                {part.type === "pending_write_file" && (
                  <span className="animate-pulse">...</span>
                )}
              </div>
            );
          }

          case "pending_a2ui":
            if (!renderA2UIInline) {
              return null;
            }
            // 显示正在加载的表单
            return (
              <div
                key={`pending-${index}`}
                className="flex items-center gap-2 px-3 py-4 bg-muted/50 rounded-lg animate-pulse"
              >
                <div className="w-4 h-4 rounded-full bg-muted-foreground/20" />
                <span className="text-sm text-muted-foreground">
                  表单加载中...
                </span>
              </div>
            );

          case "text":
          default: {
            // 渲染普通文本 - content 是 string 类型
            const textContent =
              typeof part.content === "string" ? part.content : "";
            if (!textContent || textContent.trim() === "") return null;
            return (
              <StreamingText
                key={`text-${index}`}
                text={textContent}
                isStreaming={
                  isStreaming && index === parsedContent.parts.length - 1
                }
                showCursor={
                  shouldShowCursor && index === parsedContent.parts.length - 1
                }
                onA2UISubmit={onA2UISubmit}
                a2uiFormId={a2uiFormId}
                a2uiInitialFormData={a2uiInitialFormData}
                onA2UIFormChange={onA2UIFormChange}
                renderA2UIInline={renderA2UIInline}
                collapseCodeBlocks={collapseCodeBlocks}
                onCodeBlockClick={onCodeBlockClick}
              />
            );
          }
        }
      });
    };

    return (
      <div className="flex flex-col gap-2">
        {shouldShowRuntimeStatus && runtimeStatus ? (
          <AgentRuntimeStatusBlock status={runtimeStatus} />
        ) : null}
        {/* 思考内容 - 显示在最前面 */}
        {finalThinking && (
          <ThinkingBlock
            content={finalThinking}
            defaultExpanded={isStreaming}
          />
        )}

        {/* 工具调用区域 */}
        {hasToolCalls && (
          <ToolCallList
            toolCalls={toolCalls}
            isMessageStreaming={isStreaming}
            onFileClick={onFileClick}
          />
        )}

        {/* 权限确认区域 */}
        {hasActionRequests && onPermissionResponse && (
          <div className="space-y-3">
            {visibleActionRequests.map((request) =>
              isActionRequestA2UICompatible(request) &&
              (request.status === "submitted" || request.status === "queued") ? (
                <ActionRequestA2UIPreviewCard
                  key={request.requestId}
                  request={request}
                  compact={true}
                  context="chat"
                />
              ) : (
                <DecisionPanel
                  key={request.requestId}
                  request={request}
                  onSubmit={onPermissionResponse}
                />
              ),
            )}
          </div>
        )}

        {/* 解析后的内容区域（包括 A2UI、write_file、普通文本） */}
        {renderParsedContent()}

        {/* 如果没有内容但正在流式输出，显示光标 */}
        {!hasVisibleContent &&
          isStreaming &&
          showCursor &&
          !runtimeStatus &&
          !hasRunningTools && (
            <div>
              <StreamingCursor />
            </div>
          )}
      </div>
    );
  },
);

StreamingRenderer.displayName = "StreamingRenderer";

export default StreamingRenderer;
