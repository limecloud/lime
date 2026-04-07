/**
 * 工具调用显示组件
 *
 * 参考 aster UI 设计，显示工具执行状态、参数、日志和结果
 * Requirements: 9.1, 9.2 - 工具执行指示器和结果折叠面板
 */

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ChevronDown, ChevronRight, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AgentToolCallState as ToolCallState,
  AgentToolResultImage as ToolResultImage,
} from "@/lib/api/agentProtocol";
import type { SiteSavedContentTarget } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SearchResultPreviewList } from "./SearchResultPreviewList";
import {
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
} from "../utils/searchResultPreview";
import { extractLimeToolMetadataBlock } from "../hooks/agentChatToolResult";
import {
  classifySearchQuerySemantic,
  summarizeSearchQuerySemantics,
} from "../utils/searchQueryGrouping";
import type { ToolCallArgumentValue } from "../utils/toolDisplayInfo";
import {
  buildGroupedChildLine as buildGroupedChildLineFromInfo,
  buildToolGroupHeadline as buildToolGroupHeadlineFromInfo,
  buildToolHeadline as buildToolHeadlineFromInfo,
  extractSearchQueryLabel as extractSearchQueryLabelFromInfo,
  getToolDisplayInfo as getToolDisplayInfoFromInfo,
  humanizeToolName as humanizeToolNameFromInfo,
  normalizeToolNameKey as normalizeToolNameKeyFromInfo,
  parseToolCallArguments as parseToolCallArgumentsFromInfo,
  resolveToolFilePath as resolveToolFilePathFromInfo,
  resolveToolPrimarySubject as resolveToolPrimarySubjectFromInfo,
} from "../utils/toolDisplayInfo";

const inferCodeLanguageFromPath = (path?: string | null): string | null => {
  if (!path) return null;
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "js":
      return "javascript";
    case "jsx":
      return "jsx";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "sh":
    case "bash":
    case "zsh":
      return "bash";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "html":
      return "html";
    case "css":
      return "css";
    default:
      return null;
  }
};

const looksLikeMarkdown = (value: string): boolean =>
  /(^|\n)(#{1,6}\s|\d+\.\s|[-*]\s|>\s|\|.+\|)|```/.test(value);

const looksLikeStructuredCode = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // ignore
    }
  }

  return /(^|\n)\s*(import |export |const |let |var |function |class |interface |type )/.test(
    value,
  );
};

const shouldRenderResultAsCodeBlock = (params: {
  toolCall: ToolCallState;
  content: string;
  language?: string | null;
}): boolean => {
  const { toolCall, content, language } = params;
  if (language) {
    return true;
  }
  if (content.includes("```")) {
    return false;
  }
  if (looksLikeStructuredCode(content)) {
    return true;
  }

  const normalizedName = normalizeToolNameKeyFromInfo(toolCall.name);
  if (
    normalizedName.includes("bash") ||
    normalizedName.includes("shell") ||
    normalizedName.includes("exec")
  ) {
    return true;
  }

  return content.split("\n").length >= 4 && !looksLikeMarkdown(content);
};

const buildRenderedToolResultContent = (params: {
  toolCall: ToolCallState;
  content: string;
  filePath?: string | null;
  resultPath?: string | null;
}): string => {
  const { toolCall, content, filePath, resultPath } = params;
  if (!content.trim() || content === "(无输出)") {
    return "```text\n(无输出)\n```";
  }
  if (content.includes("```")) {
    return content;
  }

  const language = inferCodeLanguageFromPath(resultPath || filePath);
  if (
    shouldRenderResultAsCodeBlock({
      toolCall,
      content,
      language,
    })
  ) {
    return `\`\`\`${language ?? "text"}\n${content}\n\`\`\``;
  }

  return content;
};

const isGroupableToolCall = (toolCall: ToolCallState): boolean => {
  if (isUnifiedWebSearchToolName(toolCall.name)) {
    return true;
  }

  return toolCall.status === "completed" || toolCall.status === "failed";
};

const resolveToolGroupKey = (toolCall: ToolCallState): string => {
  if (isUnifiedWebSearchToolName(toolCall.name)) {
    return "search";
  }

  const info = getToolDisplayInfoFromInfo(toolCall.name, toolCall.status);
  return `${info.groupTitle}:${toolCall.status}`;
};

const buildToolGroupPreview = (toolCalls: ToolCallState[]): string => {
  const previews = toolCalls
    .slice(0, 2)
    .map((toolCall) => {
      const args = parseToolCallArgumentsFromInfo(toolCall.arguments);
      const filePath = resolveToolFilePathFromInfo(args);
      return (
        resolveToolPrimarySubjectFromInfo(toolCall.name, args, filePath) ||
        toolCall.name
      );
    })
    .filter(Boolean);

  const hiddenCount = Math.max(toolCalls.length - previews.length, 0);
  return hiddenCount > 0
    ? `${previews.join(" · ")} 等 ${hiddenCount} 项`
    : previews.join(" · ");
};

const normalizeToolResultImages = (rawImages: unknown): ToolResultImage[] => {
  if (!Array.isArray(rawImages)) return [];
  const normalized: ToolResultImage[] = [];
  for (const item of rawImages) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const src = typeof record.src === "string" ? record.src.trim() : "";
    if (!src) continue;
    const mimeType =
      (typeof record.mimeType === "string" && record.mimeType) ||
      (typeof record.mime_type === "string" && record.mime_type) ||
      undefined;
    const origin =
      record.origin === "data_url" ||
      record.origin === "tool_payload" ||
      record.origin === "file_path"
        ? record.origin
        : undefined;
    normalized.push({ src, mimeType, origin });
  }
  return normalized;
};

const normalizeToolResultMetadata = (
  rawMetadata: unknown,
): Record<string, unknown> | undefined => {
  if (
    !rawMetadata ||
    typeof rawMetadata !== "object" ||
    Array.isArray(rawMetadata)
  ) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(rawMetadata));
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readFirstNonEmptyString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function readFirstFiniteNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return undefined;
}

interface SiteToolResultSummary {
  savedContent?: {
    contentId?: string;
    projectId?: string;
    title?: string;
    projectRootPath?: string;
    bundleRelativeDir?: string;
    markdownRelativePath?: string;
    imagesRelativeDir?: string;
    metaRelativePath?: string;
    imageCount?: number;
  };
  savedProjectId?: string;
  savedBy?: string;
  saveSkippedProjectId?: string;
  saveSkippedBy?: string;
  saveErrorMessage?: string;
  adapterSourceKind?: string;
  adapterSourceVersion?: string;
}

interface ToolResultNotice {
  key: string;
  text: string;
  tone: "neutral" | "success" | "warning" | "error";
}

function resolveSiteSavedContentTarget(
  summary: SiteToolResultSummary | null,
): SiteSavedContentTarget | null {
  if (!summary?.savedContent?.contentId) {
    return null;
  }

  const projectId =
    summary.savedContent.projectId?.trim() || summary.savedProjectId?.trim();
  if (!projectId) {
    return null;
  }

  return {
    projectId,
    contentId: summary.savedContent.contentId,
    title: summary.savedContent.title,
  };
}

function normalizeSiteToolResultSummary(
  rawMetadata: unknown,
): SiteToolResultSummary | null {
  const metadata = normalizeToolResultMetadata(rawMetadata);
  if (!metadata) {
    return null;
  }

  const metadataResult = asRecord(metadata.result);
  const savedContentRecord =
    asRecord(metadata.saved_content) || asRecord(metadataResult?.saved_content);
  const candidates = [metadata, metadataResult, savedContentRecord];
  const toolFamily = readFirstNonEmptyString(candidates, [
    "tool_family",
    "toolFamily",
  ]);
  const savedProjectId = readFirstNonEmptyString(candidates, [
    "saved_project_id",
    "savedProjectId",
  ]);
  const saveSkippedProjectId = readFirstNonEmptyString(candidates, [
    "save_skipped_project_id",
    "saveSkippedProjectId",
  ]);
  const saveErrorMessage = readFirstNonEmptyString(candidates, [
    "save_error_message",
    "saveErrorMessage",
  ]);
  const adapterSourceKind = readFirstNonEmptyString(candidates, [
    "adapter_source_kind",
    "adapterSourceKind",
  ]);
  const adapterSourceVersion = readFirstNonEmptyString(candidates, [
    "adapter_source_version",
    "adapterSourceVersion",
  ]);

  const hasSavedContent =
    !!savedContentRecord &&
    [
      savedContentRecord.content_id,
      savedContentRecord.contentId,
      savedContentRecord.project_id,
      savedContentRecord.projectId,
      savedContentRecord.title,
    ].some((value) => typeof value === "string" && value.trim());

  const isSiteTool =
    toolFamily === "site" ||
    hasSavedContent ||
    !!savedProjectId ||
    !!saveSkippedProjectId ||
    !!saveErrorMessage ||
    !!adapterSourceKind;

  if (!isSiteTool) {
    return null;
  }

  return {
    savedContent: hasSavedContent
      ? {
          contentId: readFirstNonEmptyString(
            [savedContentRecord],
            ["content_id", "contentId"],
          ),
          projectId: readFirstNonEmptyString(
            [savedContentRecord],
            ["project_id", "projectId"],
          ),
          title: readFirstNonEmptyString([savedContentRecord], ["title"]),
          projectRootPath: readFirstNonEmptyString(
            [savedContentRecord],
            ["project_root_path", "projectRootPath"],
          ),
          bundleRelativeDir: readFirstNonEmptyString(
            [savedContentRecord],
            ["bundle_relative_dir", "bundleRelativeDir"],
          ),
          markdownRelativePath: readFirstNonEmptyString(
            [savedContentRecord],
            ["markdown_relative_path", "markdownRelativePath"],
          ),
          imagesRelativeDir: readFirstNonEmptyString(
            [savedContentRecord],
            ["images_relative_dir", "imagesRelativeDir"],
          ),
          metaRelativePath: readFirstNonEmptyString(
            [savedContentRecord],
            ["meta_relative_path", "metaRelativePath"],
          ),
          imageCount: readFirstFiniteNumber(
            [savedContentRecord],
            ["image_count", "imageCount"],
          ),
        }
      : undefined,
    savedProjectId,
    savedBy: readFirstNonEmptyString(candidates, ["saved_by", "savedBy"]),
    saveSkippedProjectId,
    saveSkippedBy: readFirstNonEmptyString(candidates, [
      "save_skipped_by",
      "saveSkippedBy",
    ]),
    saveErrorMessage,
    adapterSourceKind,
    adapterSourceVersion,
  };
}

function resolveSiteProjectSourceLabel(source?: string): string | null {
  if (source === "context_project") {
    return "来自当前项目上下文";
  }
  if (source === "explicit_project") {
    return "来自显式项目参数";
  }
  return null;
}

function resolveSiteAdapterSourceLabel(
  summary: SiteToolResultSummary,
): string | null {
  if (summary.adapterSourceKind === "server_synced") {
    return summary.adapterSourceVersion
      ? `服务端脚本 · ${summary.adapterSourceVersion}`
      : "服务端脚本";
  }
  if (summary.adapterSourceKind === "bundled") {
    return summary.adapterSourceVersion
      ? `内置脚本 · ${summary.adapterSourceVersion}`
      : "内置脚本";
  }
  return null;
}

// ============ 可展开面板组件 ============

interface ExpandablePanelProps {
  label: React.ReactNode;
  isStartExpanded?: boolean;
  isForceExpand?: boolean;
  children: React.ReactNode;
  className?: string;
}

const ExpandablePanel: React.FC<ExpandablePanelProps> = ({
  label,
  isStartExpanded = false,
  isForceExpand,
  children,
  className = "",
}) => {
  const [isExpandedState, setIsExpanded] = useState<boolean | null>(null);
  const isExpanded =
    isExpandedState === null ? isStartExpanded : isExpandedState;
  const toggleExpand = () => setIsExpanded(!isExpanded);

  useEffect(() => {
    if (isForceExpand) setIsExpanded(true);
  }, [isForceExpand]);

  return (
    <div className={className}>
      <button
        onClick={toggleExpand}
        className="group w-full flex justify-between items-center pr-2 py-2 px-3 transition-colors rounded-none hover:bg-muted/50"
      >
        <span className="flex items-center text-sm truncate flex-1 min-w-0">
          {label}
        </span>
        <ChevronRight
          className={cn(
            "w-4 h-4 text-muted-foreground group-hover:opacity-100 transition-transform opacity-70",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

// ============ 工具参数显示 ============

interface ToolCallArgumentsProps {
  args: Record<string, ToolCallArgumentValue>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ToolCallArguments: React.FC<ToolCallArgumentsProps> = ({ args }) => {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const toggleKey = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const renderValue = (key: string, value: ToolCallArgumentValue) => {
    if (typeof value === "string") {
      const needsExpansion = value.length > 60;
      const isExpanded = expandedKeys[key];

      if (!needsExpansion) {
        return (
          <div className="text-sm mb-2">
            <div className="flex flex-row">
              <span className="text-muted-foreground min-w-[120px] shrink-0">
                {key}
              </span>
              <span className="text-foreground/70 break-all">{value}</span>
            </div>
          </div>
        );
      }

      return (
        <div className={cn("text-sm mb-2", !isExpanded && "truncate min-w-0")}>
          <div
            className={cn(
              "flex flex-row items-start",
              !isExpanded && "truncate min-w-0",
            )}
          >
            <button
              onClick={() => toggleKey(key)}
              className="flex text-left text-muted-foreground min-w-[120px] shrink-0 hover:text-foreground"
            >
              {key}
            </button>
            <div className={cn("flex-1 min-w-0", !isExpanded && "truncate")}>
              {isExpanded ? (
                <MarkdownRenderer content={`\`\`\`\n${value}\n\`\`\``} />
              ) : (
                <button
                  onClick={() => toggleKey(key)}
                  className="text-left text-foreground/70 truncate w-full hover:text-foreground"
                >
                  {value}
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    // 处理非字符串值
    const content = Array.isArray(value)
      ? value
          .map((item, index) => `${index + 1}. ${JSON.stringify(item)}`)
          .join("\n")
      : typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value);

    return (
      <div className="mb-2">
        <div className="flex flex-row text-sm">
          <span className="text-muted-foreground min-w-[120px] shrink-0">
            {key}
          </span>
          <pre className="whitespace-pre-wrap text-foreground/70 overflow-x-auto max-w-full font-mono text-xs">
            {content}
          </pre>
        </div>
      </div>
    );
  };

  return (
    <div className="py-2 px-4">
      {Object.entries(args).map(([key, value]) => (
        <div key={key}>{renderValue(key, value)}</div>
      ))}
    </div>
  );
};

// ============ 工具日志显示 ============

interface ToolLogsViewProps {
  logs: string[];
  working: boolean;
  isStartExpanded?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ToolLogsView: React.FC<ToolLogsViewProps> = ({
  logs,
  working,
  isStartExpanded = false,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <ExpandablePanel
      label={
        <span className="pl-2 py-1 text-sm flex items-center gap-2">
          <span>日志</span>
          {working && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
        </span>
      }
      isStartExpanded={isStartExpanded}
    >
      <div
        ref={boxRef}
        className={cn(
          "flex flex-col items-start space-y-1 overflow-y-auto p-3 font-mono text-xs",
          working ? "max-h-16" : "max-h-80",
        )}
      >
        {logs.map((log, i) => (
          <span key={i} className="text-muted-foreground">
            {log}
          </span>
        ))}
      </div>
    </ExpandablePanel>
  );
};

// ============ 工具结果显示 ============

interface ToolResultViewProps {
  result: string;
  isError?: boolean;
  isStartExpanded?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ToolResultView: React.FC<ToolResultViewProps> = ({
  result,
  isError = false,
  isStartExpanded = false,
}) => {
  return (
    <ExpandablePanel
      label={
        <span
          className={cn("pl-2 py-1 text-sm", isError && "text-destructive")}
        >
          {isError ? "错误" : "输出"}
        </span>
      }
      isStartExpanded={isStartExpanded}
    >
      <div className="p-3 max-h-80 overflow-y-auto">
        <pre
          className={cn(
            "whitespace-pre-wrap font-mono text-xs break-all",
            isError ? "text-destructive" : "text-foreground/80",
          )}
        >
          {result || "(无输出)"}
        </pre>
      </div>
    </ExpandablePanel>
  );
};

// ============ 主组件 ============

interface ToolCallDisplayProps {
  toolCall: ToolCallState;
  defaultExpanded?: boolean;
  /** 当前 assistant 消息是否仍在流式输出 */
  isMessageStreaming?: boolean;
  /** 文件点击回调 - 用于打开右边栏显示文件内容 */
  onFileClick?: (fileName: string, content: string) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
  grouped?: boolean;
  groupMarker?: string;
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCall,
  defaultExpanded = false,
  isMessageStreaming = false,
  onFileClick,
  onOpenSavedSiteContent,
  grouped = false,
  groupMarker = "•",
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showRawSearchResultOutput, setShowRawSearchResultOutput] =
    useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const hasUserToggledExpandedRef = useRef(false);

  // 解析参数
  const parsedArgs = useMemo(
    () => parseToolCallArgumentsFromInfo(toolCall.arguments),
    [toolCall.arguments],
  );

  const toolDisplay = useMemo(
    () => getToolDisplayInfoFromInfo(toolCall.name, toolCall.status),
    [toolCall.name, toolCall.status],
  );

  // 获取文件路径
  const filePath = useMemo(
    () => resolveToolFilePathFromInfo(parsedArgs),
    [parsedArgs],
  );

  // 获取文件名
  const fileName = useMemo(
    () =>
      resolveToolPrimarySubjectFromInfo(toolCall.name, parsedArgs, filePath),
    [filePath, parsedArgs, toolCall.name],
  );

  // 获取文件内容（用于点击打开右边栏）
  const fileContent = useMemo(() => {
    const content = parsedArgs.content || parsedArgs.text;
    return content ? String(content) : null;
  }, [parsedArgs]);

  const isRunning = toolCall.status === "running";
  const isCompleted = toolCall.status === "completed";
  const isFailed = toolCall.status === "failed";
  const hasResult = !isRunning && toolCall.result;
  const resultImages = useMemo(
    () => normalizeToolResultImages(toolCall.result?.images),
    [toolCall.result?.images],
  );
  const resultMetadata = useMemo(
    () => normalizeToolResultMetadata(toolCall.result?.metadata),
    [toolCall.result?.metadata],
  );
  const siteResultSummary = useMemo(
    () => normalizeSiteToolResultSummary(toolCall.result?.metadata),
    [toolCall.result?.metadata],
  );
  const savedSiteContentTarget = useMemo(
    () => resolveSiteSavedContentTarget(siteResultSummary),
    [siteResultSummary],
  );
  const resultText = useMemo(() => {
    const rawText = toolCall.result?.error || toolCall.result?.output || "";
    const normalized = extractLimeToolMetadataBlock(rawText).text;
    return normalized || "(无输出)";
  }, [toolCall.result?.error, toolCall.result?.output]);
  const resultMetaItems = useMemo(() => {
    if (!resultMetadata) return [];

    const items: string[] = [];
    if (resultMetadata.lime_offloaded === true) {
      items.push("完整输出已转存");
    }
    if (typeof resultMetadata.exit_code === "number") {
      items.push(`退出码 ${resultMetadata.exit_code}`);
    }
    if (typeof resultMetadata.stdout_length === "number") {
      items.push(`stdout ${resultMetadata.stdout_length}`);
    }
    if (typeof resultMetadata.stderr_length === "number") {
      items.push(`stderr ${resultMetadata.stderr_length}`);
    }
    if (typeof resultMetadata.sandboxed === "boolean") {
      items.push(resultMetadata.sandboxed ? "已隔离执行" : "普通执行");
    }
    if (resultMetadata.output_truncated === true) {
      items.push("输出已截断");
    }
    if (typeof resultMetadata.offload_original_chars === "number") {
      items.push(`原始 ${resultMetadata.offload_original_chars} 字符`);
    }
    if (typeof resultMetadata.offload_original_tokens === "number") {
      items.push(`约 ${resultMetadata.offload_original_tokens} tokens`);
    }
    if (typeof resultMetadata.offload_trigger === "string") {
      const triggerLabel =
        resultMetadata.offload_trigger === "history_context_pressure"
          ? "上下文压力触发"
          : resultMetadata.offload_trigger === "token_limit_before_evict"
            ? "token 阈值触发"
            : resultMetadata.offload_trigger === "payload_bytes"
              ? "字节阈值触发"
              : resultMetadata.offload_trigger === "payload_chars"
                ? "字符阈值触发"
                : resultMetadata.offload_trigger;
      items.push(triggerLabel);
    }

    return items;
  }, [resultMetadata]);
  const siteResultNotices = useMemo(() => {
    if (!siteResultSummary) return [] as ToolResultNotice[];

    const notices: ToolResultNotice[] = [];
    const savedProjectId =
      siteResultSummary.savedProjectId ||
      siteResultSummary.savedContent?.projectId;
    const savedSourceLabel = resolveSiteProjectSourceLabel(
      siteResultSummary.savedBy,
    );

    if (siteResultSummary.savedContent?.title) {
      let text = `结果已自动保存${
        savedProjectId ? `到项目 ${savedProjectId}` : ""
      }：${siteResultSummary.savedContent.title}`;
      if (savedSourceLabel) {
        text = `${text} · ${savedSourceLabel}`;
      }
      notices.push({
        key: "site-save-success",
        text,
        tone: "success",
      });
    }

    if (siteResultSummary.savedContent?.projectRootPath) {
      notices.push({
        key: "site-save-project-root",
        text: `项目目录：${siteResultSummary.savedContent.projectRootPath}`,
        tone: "neutral",
      });
    }

    if (siteResultSummary.savedContent?.markdownRelativePath) {
      notices.push({
        key: "site-save-markdown-path",
        text: `Markdown 文件：${siteResultSummary.savedContent.markdownRelativePath}`,
        tone: "neutral",
      });
    }

    if (typeof siteResultSummary.savedContent?.imageCount === "number") {
      const imageDir = siteResultSummary.savedContent.imagesRelativeDir;
      notices.push({
        key: "site-save-images",
        text: `图片资源：${siteResultSummary.savedContent.imageCount} 张${
          imageDir ? ` · ${imageDir}` : ""
        }`,
        tone: "neutral",
      });
    }

    if (siteResultSummary.saveSkippedProjectId) {
      let text =
        toolCall.status === "failed"
          ? `执行失败，未保存到项目 ${siteResultSummary.saveSkippedProjectId}`
          : `本次结果未保存到项目 ${siteResultSummary.saveSkippedProjectId}`;
      const skippedSourceLabel = resolveSiteProjectSourceLabel(
        siteResultSummary.saveSkippedBy,
      );
      if (skippedSourceLabel) {
        text = `${text} · ${skippedSourceLabel}`;
      }
      notices.push({
        key: "site-save-skipped",
        text,
        tone: siteResultSummary.saveErrorMessage ? "warning" : "neutral",
      });
    }

    if (siteResultSummary.saveErrorMessage) {
      notices.push({
        key: "site-save-error",
        text: `自动保存失败：${siteResultSummary.saveErrorMessage}`,
        tone: "error",
      });
    }

    const adapterSourceLabel = resolveSiteAdapterSourceLabel(siteResultSummary);
    if (adapterSourceLabel) {
      notices.push({
        key: "site-adapter-source",
        text: `脚本来源：${adapterSourceLabel}`,
        tone: "neutral",
      });
    }

    return notices;
  }, [siteResultSummary, toolCall.status]);
  const resultPath = useMemo(() => {
    if (!resultMetadata) return undefined;
    if (
      typeof resultMetadata.offload_file === "string" &&
      resultMetadata.offload_file.trim()
    ) {
      return {
        label: "转存文件",
        value: resultMetadata.offload_file.trim(),
      };
    }
    if (
      typeof resultMetadata.output_file === "string" &&
      resultMetadata.output_file.trim()
    ) {
      return {
        label: "输出文件",
        value: resultMetadata.output_file.trim(),
      };
    }
    if (typeof resultMetadata.path === "string" && resultMetadata.path.trim()) {
      return {
        label: "产物路径",
        value: resultMetadata.path.trim(),
      };
    }
    return undefined;
  }, [resultMetadata]);
  const openableFilePath = useMemo(
    () => resultPath?.value || filePath,
    [filePath, resultPath?.value],
  );
  const renderedResultContent = useMemo(
    () =>
      buildRenderedToolResultContent({
        toolCall,
        content: resultText,
        filePath,
        resultPath: resultPath?.value,
      }),
    [filePath, resultPath?.value, resultText, toolCall],
  );
  const toolHeadline = useMemo(
    () =>
      buildToolHeadlineFromInfo({
        toolDisplay,
        subject: fileName,
        toolName: toolCall.name,
      }),
    [fileName, toolCall.name, toolDisplay],
  );
  const groupedChildLine = useMemo(
    () => buildGroupedChildLineFromInfo(toolCall),
    [toolCall],
  );
  const shouldShowRawToolName = useMemo(
    () =>
      toolDisplay.family === "generic" &&
      toolDisplay.label !== humanizeToolNameFromInfo(toolCall.name),
    [toolCall.name, toolDisplay.family, toolDisplay.label],
  );
  const searchResultItems = useMemo(() => {
    if (!isUnifiedWebSearchToolName(toolCall.name)) {
      return [];
    }

    return resolveSearchResultPreviewItemsFromText(toolCall.result?.output);
  }, [toolCall.name, toolCall.result?.output]);
  const searchSemantic = useMemo(
    () =>
      classifySearchQuerySemantic(extractSearchQueryLabelFromInfo(toolCall)),
    [toolCall],
  );
  const hasResultImages = resultImages.length > 0;
  const hasSearchResults = searchResultItems.length > 0;
  const shouldShowRawSearchResultToggle =
    hasSearchResults && resultText !== "(无输出)";
  const shouldRenderResultPanel =
    isExpanded && hasResult && (!hasSearchResults || showRawSearchResultOutput);

  const handleOpenExternalUrl = useCallback(async (url: string) => {
    try {
      await openExternal(url);
    } catch {
      if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(url, "_blank");
        return;
      }
      throw new Error("当前环境不支持打开外部链接");
    }
  }, []);

  useEffect(() => {
    if (
      isMessageStreaming &&
      (isRunning || hasResult || hasResultImages || hasSearchResults)
    ) {
      setIsExpanded(true);
    }
  }, [
    isMessageStreaming,
    isRunning,
    hasResult,
    hasResultImages,
    hasSearchResults,
  ]);

  useEffect(() => {
    if (hasSearchResults && !hasUserToggledExpandedRef.current) {
      setIsExpanded(true);
    }
  }, [hasSearchResults]);

  useEffect(() => {
    if (!hasSearchResults) {
      setShowRawSearchResultOutput(false);
    }
  }, [hasSearchResults]);

  // 处理点击事件 - 如果是文件写入工具，打开右边栏
  const handleOpenFile = useCallback(() => {
    if (openableFilePath && onFileClick) {
      onFileClick(openableFilePath, fileContent || "");
    }
  }, [fileContent, onFileClick, openableFilePath]);

  const handleOpenSavedSiteContent = useCallback(() => {
    if (savedSiteContentTarget && onOpenSavedSiteContent) {
      onOpenSavedSiteContent(savedSiteContentTarget);
    }
  }, [onOpenSavedSiteContent, savedSiteContentTarget]);

  const handleToggleExpanded = useCallback(() => {
    hasUserToggledExpandedRef.current = true;
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className={cn("group", grouped && "pl-1")}>
      {grouped ? (
        <div
          className="flex items-start gap-2 py-1.5"
          data-testid="tool-call-row"
        >
          <span className="pt-0.5 font-mono text-xs text-slate-400">
            {groupMarker}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-slate-700">
              {groupedChildLine}
            </div>
            {shouldShowRawToolName ? (
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {humanizeToolNameFromInfo(toolCall.name)}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1 pt-0.5">
            {openableFilePath && onFileClick && (
              <button
                onClick={handleOpenFile}
                className="rounded-md p-1 transition-colors hover:bg-slate-100"
                title="在画布中打开"
                aria-label={`在画布中打开-${openableFilePath}`}
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-500 hover:text-slate-900" />
              </button>
            )}
            {(hasResult || hasSearchResults) && (
              <button
                onClick={handleToggleExpanded}
                className="rounded-md p-1 transition-colors hover:bg-slate-100"
                title={isExpanded ? "收起结果" : "查看结果"}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-slate-500 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex items-start gap-2.5 py-1.5"
          data-testid="tool-call-row"
        >
          <span
            className={cn(
              "pt-0.5 text-sm font-medium",
              isCompleted && "text-emerald-600",
              isFailed && "text-rose-600",
              isRunning && "text-sky-600",
              !isCompleted && !isFailed && !isRunning && "text-slate-400",
            )}
            aria-hidden="true"
          >
            •
          </span>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-slate-900">
              {toolHeadline}
            </div>
            {shouldShowRawToolName ? (
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {humanizeToolNameFromInfo(toolCall.name)}
              </div>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-1 pt-0.5">
            {openableFilePath && onFileClick && (
              <button
                onClick={handleOpenFile}
                className="rounded-md p-1 transition-colors hover:bg-slate-100"
                title="在画布中打开"
                aria-label={`在画布中打开-${openableFilePath}`}
              >
                <ExternalLink className="h-3.5 w-3.5 text-slate-500 hover:text-slate-900" />
              </button>
            )}

            {(hasResult || hasSearchResults) && (
              <button
                onClick={handleToggleExpanded}
                className="rounded-md p-1 transition-colors hover:bg-slate-100"
                title={isExpanded ? "收起结果" : "查看结果"}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 text-slate-500 transition-transform",
                    isExpanded && "rotate-90",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      )}

      {hasResultImages && (
        <div className="mb-2 ml-4 mt-2 flex flex-wrap gap-2">
          {resultImages.map((image, index) => (
            <button
              key={`${image.src.slice(0, 48)}-${index}`}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white"
              onClick={() => setPreviewImageSrc(image.src)}
              title="点击查看大图"
            >
              <img
                src={image.src}
                alt="工具结果图片预览"
                className="h-20 w-20 object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {hasSearchResults && isExpanded && (
        <div className="mb-2 ml-6 mt-1.5">
          <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span>{searchSemantic.label}</span>
          </div>
          <SearchResultPreviewList
            items={searchResultItems}
            onOpenUrl={handleOpenExternalUrl}
            popoverSide="bottom"
            popoverAlign="start"
          />
          {shouldShowRawSearchResultToggle ? (
            <div className="mt-2">
              <button
                type="button"
                className="rounded-md px-2 py-1 text-[11px] text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label={
                  showRawSearchResultOutput
                    ? "收起搜索原始输出"
                    : "查看搜索原始输出"
                }
                onClick={() =>
                  setShowRawSearchResultOutput((current) => !current)
                }
              >
                {showRawSearchResultOutput ? "收起原始输出" : "查看原始输出"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {shouldRenderResultPanel && (
        <div
          className="mb-2 ml-6 mt-1.5 space-y-2"
          data-testid="tool-call-result-panel"
        >
          {resultMetaItems.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {resultMetaItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
          {siteResultNotices.length > 0 ? (
            <div className="space-y-1 text-[11px]">
              {siteResultNotices.map((notice) => (
                <div
                  key={notice.key}
                  className={cn(
                    notice.tone === "success" && "text-emerald-700",
                    notice.tone === "warning" && "text-amber-700",
                    notice.tone === "error" && "text-rose-700",
                    notice.tone === "neutral" && "text-slate-500",
                  )}
                >
                  {notice.text}
                </div>
              ))}
            </div>
          ) : null}
          {savedSiteContentTarget && onOpenSavedSiteContent ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50"
                onClick={handleOpenSavedSiteContent}
              >
                打开已保存内容
              </button>
            </div>
          ) : null}
          {resultPath ? (
            <div className="break-all text-[11px] text-slate-500">
              {resultPath.label}: {resultPath.value}
            </div>
          ) : null}
          <div
            className={cn(
              "max-h-64 overflow-y-auto rounded-[14px] border border-slate-200 bg-white p-3",
              isFailed && "border-rose-200",
            )}
            data-testid="tool-call-rendered-result"
          >
            <MarkdownRenderer content={renderedResultContent} />
          </div>
        </div>
      )}

      {previewImageSrc && (
        <button
          type="button"
          className="fixed inset-0 z-50 bg-black/70 p-6"
          onClick={() => setPreviewImageSrc(null)}
        >
          <img
            src={previewImageSrc}
            alt="工具结果图片大图"
            className="mx-auto max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      )}
    </div>
  );
};

// ============ 工具调用列表 ============

interface ToolCallListProps {
  toolCalls: ToolCallState[];
  /** 当前 assistant 消息是否仍在流式输出 */
  isMessageStreaming?: boolean;
  /** 文件点击回调 - 用于打开右边栏显示文件内容 */
  onFileClick?: (fileName: string, content: string) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
}

export const ToolCallList: React.FC<ToolCallListProps> = ({
  toolCalls,
  isMessageStreaming = false,
  onFileClick,
  onOpenSavedSiteContent,
}) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  const groups: Array<
    | {
        type: "search";
        id: string;
        items: ToolCallState[];
      }
    | {
        type: "work";
        id: string;
        items: ToolCallState[];
      }
    | {
        type: "single";
        id: string;
        item: ToolCallState;
      }
  > = [];

  for (const toolCall of toolCalls) {
    const isSearch = isUnifiedWebSearchToolName(toolCall.name);
    const lastGroup = groups[groups.length - 1];
    if (isSearch && lastGroup && lastGroup.type === "search") {
      lastGroup.items.push(toolCall);
      continue;
    }

    if (isSearch) {
      groups.push({
        type: "search",
        id: `search-group:${toolCall.id}`,
        items: [toolCall],
      });
      continue;
    }

    if (
      isGroupableToolCall(toolCall) &&
      lastGroup &&
      lastGroup.type === "work" &&
      resolveToolGroupKey(lastGroup.items[0]!) === resolveToolGroupKey(toolCall)
    ) {
      lastGroup.items.push(toolCall);
      continue;
    }

    if (isGroupableToolCall(toolCall)) {
      groups.push({
        type: "work",
        id: `work-group:${toolCall.id}`,
        items: [toolCall],
      });
      continue;
    }

    groups.push({
      type: "single",
      id: toolCall.id,
      item: toolCall,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => {
        if (group.type === "single") {
          return (
            <ToolCallDisplay
              key={group.id}
              toolCall={group.item}
              isMessageStreaming={isMessageStreaming}
              onFileClick={onFileClick}
              onOpenSavedSiteContent={onOpenSavedSiteContent}
            />
          );
        }

        if (group.type === "work") {
          if (group.items.length === 1) {
            return (
              <ToolCallDisplay
                key={group.id}
                toolCall={group.items[0]!}
                isMessageStreaming={isMessageStreaming}
                onFileClick={onFileClick}
                onOpenSavedSiteContent={onOpenSavedSiteContent}
              />
            );
          }

          return (
            <WorkToolCallGroup
              key={group.id}
              toolCalls={group.items}
              isMessageStreaming={isMessageStreaming}
              onFileClick={onFileClick}
              onOpenSavedSiteContent={onOpenSavedSiteContent}
            />
          );
        }

        return (
          <SearchToolCallGroup
            key={group.id}
            toolCalls={group.items}
            isMessageStreaming={isMessageStreaming}
            onFileClick={onFileClick}
            onOpenSavedSiteContent={onOpenSavedSiteContent}
          />
        );
      })}
    </div>
  );
};

function WorkToolCallGroup({
  toolCalls,
  isMessageStreaming,
  onFileClick,
  onOpenSavedSiteContent,
}: {
  toolCalls: ToolCallState[];
  isMessageStreaming: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
}) {
  const hasRunning = toolCalls.some((item) => item.status === "running");
  const hasFailed = toolCalls.some((item) => item.status === "failed");
  const [expanded, setExpanded] = useState(hasRunning || hasFailed);
  const headline = buildToolGroupHeadlineFromInfo(toolCalls);
  const preview = buildToolGroupPreview(toolCalls);

  useEffect(() => {
    if (hasRunning || hasFailed) {
      setExpanded(true);
    }
  }, [hasFailed, hasRunning]);

  return (
    <div className="py-0.5" data-testid="tool-call-work-group">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 py-1.5 text-left transition-colors hover:bg-slate-50"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label={expanded ? "收起工具批次" : "展开工具批次"}
      >
        <span className="pt-0.5 text-sm text-slate-400">•</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-slate-900">
            {headline}
          </span>
          {!expanded && preview ? (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {preview}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 text-slate-500 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <div className="ml-6 space-y-1">
          {toolCalls.map((toolCall, index) => (
            <ToolCallDisplay
              key={toolCall.id}
              toolCall={toolCall}
              isMessageStreaming={isMessageStreaming}
              onFileClick={onFileClick}
              onOpenSavedSiteContent={onOpenSavedSiteContent}
              grouped={true}
              groupMarker={index === 0 ? "└" : "·"}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SearchToolCallGroup({
  toolCalls,
  isMessageStreaming,
  onFileClick,
  onOpenSavedSiteContent,
}: {
  toolCalls: ToolCallState[];
  isMessageStreaming: boolean;
  onFileClick?: (fileName: string, content: string) => void;
  onOpenSavedSiteContent?: (target: SiteSavedContentTarget) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const semanticSummaries = summarizeSearchQuerySemantics(
    toolCalls.map(extractSearchQueryLabelFromInfo),
  );
  const headline = buildToolGroupHeadlineFromInfo(toolCalls);
  const queryPreview = toolCalls
    .slice(0, 2)
    .map(extractSearchQueryLabelFromInfo)
    .join(" · ");
  const hiddenCount = Math.max(toolCalls.length - 2, 0);

  return (
    <div className="py-0.5">
      <button
        type="button"
        className="flex w-full items-start gap-2.5 py-1.5 text-left transition-colors hover:bg-slate-50"
        onClick={() => setExpanded((prev) => !prev)}
        aria-label={expanded ? "收起搜索批次" : "展开搜索批次"}
      >
        <span className="pt-0.5 text-sm text-slate-400">•</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-slate-900">
            {headline}
          </span>
          {!expanded ? (
            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {queryPreview}
              {hiddenCount > 0 ? ` 等 ${hiddenCount} 组` : ""}
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 text-slate-500 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {semanticSummaries.length > 0 ? (
        <div className="ml-6 flex flex-wrap gap-x-3 gap-y-1 pb-1 text-[11px] text-slate-500">
          {semanticSummaries.map((item) => (
            <span key={item.key}>
              {item.label} {item.count}
            </span>
          ))}
        </div>
      ) : null}
      {expanded ? (
        <div className="ml-6 space-y-1">
          {toolCalls.map((toolCall, index) => (
            <ToolCallDisplay
              key={toolCall.id}
              toolCall={toolCall}
              isMessageStreaming={isMessageStreaming}
              onFileClick={onFileClick}
              onOpenSavedSiteContent={onOpenSavedSiteContent}
              grouped={true}
              groupMarker={index === 0 ? "└" : "·"}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// 导出别名，用于交错显示模式
export const ToolCallItem = ToolCallDisplay;

export default ToolCallDisplay;
