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
import {
  Terminal,
  FileText,
  Edit3,
  FolderOpen,
  ChevronRight,
  Loader2,
  Eye,
  FilePlus,
  Search,
  Globe,
  Code2,
  Settings,
  Wrench,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCallState, ToolResultImage } from "@/lib/api/agentStream";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ============ 类型定义 ============

export type ToolCallStatus = "pending" | "running" | "completed" | "failed";

type ToolCallArgumentValue =
  | string
  | number
  | boolean
  | null
  | ToolCallArgumentValue[]
  | { [key: string]: ToolCallArgumentValue };

// ============ 工具状态指示器 ============

interface ToolCallStatusIndicatorProps {
  status: ToolCallStatus;
  className?: string;
}

const _ToolCallStatusIndicator: React.FC<ToolCallStatusIndicatorProps> = ({
  status,
  className,
}) => {
  const getStatusStyles = () => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "running":
        return "bg-yellow-500 animate-pulse";
      case "pending":
      default:
        return "bg-gray-400";
    }
  };

  return (
    <div
      className={cn(
        "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background",
        getStatusStyles(),
        className,
      )}
      aria-label={`工具状态: ${status}`}
    />
  );
};

// ============ 工具图标映射 ============

const getToolIcon = (toolName: string) => {
  const name = toolName.toLowerCase();
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    return Terminal;
  }
  if (name.includes("read")) {
    return Eye;
  }
  if (name.includes("write") || name.includes("create")) {
    return FilePlus;
  }
  if (name.includes("edit") || name.includes("replace")) {
    return Edit3;
  }
  if (name.includes("list") || name.includes("dir")) {
    return FolderOpen;
  }
  if (
    name.includes("search") ||
    name.includes("find") ||
    name.includes("grep")
  ) {
    return Search;
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("http")) {
    return Globe;
  }
  if (name.includes("code") || name.includes("eval")) {
    return Code2;
  }
  if (name.includes("config") || name.includes("setting")) {
    return Settings;
  }
  if (name.includes("file")) {
    return FileText;
  }
  return Wrench;
};

// ============ 工具描述生成 ============

/**
 * 获取工具操作描述（用于简洁显示）
 */
const getToolActionLabel = (
  toolName: string,
  status: ToolCallStatus,
): { action: string; icon: React.ElementType } => {
  const name = toolName.toLowerCase();
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  if (name.includes("write") || name.includes("create")) {
    if (isFailed) return { action: "写入失败", icon: FilePlus };
    return { action: isCompleted ? "已写入" : "写入文件", icon: FilePlus };
  }
  if (name.includes("read")) {
    if (isFailed) return { action: "读取失败", icon: Eye };
    return { action: isCompleted ? "已读取" : "读取文件", icon: Eye };
  }
  if (name.includes("edit") || name.includes("replace")) {
    if (isFailed) return { action: "编辑失败", icon: Edit3 };
    return { action: isCompleted ? "已编辑" : "编辑文件", icon: Edit3 };
  }
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    if (isFailed) return { action: "执行失败", icon: Terminal };
    return { action: isCompleted ? "已执行" : "执行命令", icon: Terminal };
  }
  if (name.includes("search") || name.includes("grep")) {
    if (isFailed) return { action: "搜索失败", icon: Search };
    return { action: isCompleted ? "已搜索" : "搜索中", icon: Search };
  }
  if (name.includes("list") || name.includes("dir")) {
    if (isFailed) return { action: "列出失败", icon: FolderOpen };
    return { action: isCompleted ? "已列出" : "列出目录", icon: FolderOpen };
  }

  // 默认
  const Icon = getToolIcon(toolName);
  if (isFailed) return { action: "执行失败", icon: Icon };
  return { action: isCompleted ? "已完成" : "执行中", icon: Icon };
};

/**
 * 获取文件名（从路径中提取）
 */
const getFileName = (filePath: string): string => {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
};

/**
 * 获取文件扩展名对应的标签颜色
 */
const _getFileTypeColor = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "ts":
    case "tsx":
      return "bg-blue-500/20 text-blue-400";
    case "js":
    case "jsx":
      return "bg-yellow-500/20 text-yellow-400";
    case "md":
      return "bg-green-500/20 text-green-400";
    case "json":
      return "bg-orange-500/20 text-orange-400";
    case "css":
    case "scss":
      return "bg-pink-500/20 text-pink-400";
    case "html":
      return "bg-red-500/20 text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const _getToolDescription = (
  toolName: string,
  args: Record<string, ToolCallArgumentValue>,
): string => {
  const name = toolName.toLowerCase();
  const getStringValue = (value: ToolCallArgumentValue): string => {
    return typeof value === "string" ? value : JSON.stringify(value);
  };

  // 根据工具类型生成描述
  if (name.includes("bash") || name.includes("shell")) {
    if (args.command) {
      const cmd = getStringValue(args.command);
      return `执行: ${cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd}`;
    }
    return "执行命令";
  }

  if (name.includes("read_file") || name === "read") {
    if (args.path || args.file_path) {
      return `读取 ${getStringValue(args.path || args.file_path)}`;
    }
    return "读取文件";
  }

  if (name.includes("write_file") || name === "write") {
    if (args.path || args.file_path) {
      return `写入 ${getStringValue(args.path || args.file_path)}`;
    }
    return "写入文件";
  }

  if (name.includes("edit_file") || name === "edit") {
    if (args.path || args.file_path) {
      return `编辑 ${getStringValue(args.path || args.file_path)}`;
    }
    return "编辑文件";
  }

  if (name.includes("list") || name.includes("dir")) {
    if (args.path || args.directory) {
      return `列出 ${getStringValue(args.path || args.directory)}`;
    }
    return "列出目录";
  }

  if (name.includes("search") || name.includes("grep")) {
    if (args.pattern || args.query) {
      return `搜索 "${getStringValue(args.pattern || args.query)}"`;
    }
    return "搜索";
  }

  // 通用回退：工具名 + 参数键
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return snakeToTitleCase(toolName);
  }
  if (entries.length === 1) {
    const [_key, value] = entries[0];
    const strValue = getStringValue(value);
    const truncated =
      strValue.length > 40 ? strValue.slice(0, 40) + "..." : strValue;
    return `${snakeToTitleCase(toolName)}: ${truncated}`;
  }
  return snakeToTitleCase(toolName);
};

const snakeToTitleCase = (str: string): string => {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
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
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  toolCall,
  defaultExpanded = false,
  isMessageStreaming = false,
  onFileClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);

  // 解析参数
  const parsedArgs = useMemo(() => {
    if (!toolCall.arguments) return {};
    try {
      return JSON.parse(toolCall.arguments);
    } catch {
      return {};
    }
  }, [toolCall.arguments]);

  // 获取操作标签和图标（保留用于未来扩展）
  const _toolAction = useMemo(
    () => getToolActionLabel(toolCall.name, toolCall.status),
    [toolCall.name, toolCall.status],
  );

  // 获取文件路径
  const filePath = useMemo(() => {
    const path = parsedArgs.path || parsedArgs.file_path || parsedArgs.filePath;
    return path ? String(path) : null;
  }, [parsedArgs]);

  // 获取文件名
  const fileName = useMemo(() => {
    if (filePath) return getFileName(filePath);
    // 对于命令，显示命令内容
    if (parsedArgs.command) {
      const cmd = String(parsedArgs.command);
      return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
    }
    // 对于搜索，显示搜索内容
    if (parsedArgs.pattern || parsedArgs.query) {
      const q = String(parsedArgs.pattern || parsedArgs.query);
      return q.length > 30 ? q.slice(0, 30) + "..." : q;
    }
    return null;
  }, [filePath, parsedArgs]);

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
  const resultMetaItems = useMemo(() => {
    if (!resultMetadata) return [];

    const items: string[] = [];
    if (resultMetadata.proxycast_offloaded === true) {
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
  const hasResultImages = resultImages.length > 0;

  useEffect(() => {
    if (isMessageStreaming && (isRunning || hasResult || hasResultImages)) {
      setIsExpanded(true);
      return;
    }
    if (!isMessageStreaming && !isRunning) {
      setIsExpanded(false);
    }
  }, [isMessageStreaming, isRunning, hasResult, hasResultImages]);

  // 处理点击事件 - 如果是文件写入工具，打开右边栏
  const handleOpenFile = useCallback(() => {
    if (filePath && fileContent && onFileClick) {
      onFileClick(filePath, fileContent);
    }
  }, [filePath, fileContent, onFileClick]);

  // 简洁模式：单行显示 - Claude 风格
  return (
    <div className="group">
      {/* 主行 - Claude 风格卡片 */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-2xl transition-colors",
          "bg-[var(--surface-tertiary)] hover:bg-[var(--surface-secondary)]",
          isExpanded && "bg-[var(--surface-secondary)]",
        )}
      >
        {/* 状态指示器 - Claude 风格 */}
        <span className="claude-status-dot">
          {isRunning && (
            <span
              className="claude-status-dot-ping"
              style={{ backgroundColor: "var(--claude-accent)" }}
            />
          )}
          <span
            className="claude-status-dot-inner"
            style={{
              backgroundColor: isCompleted
                ? "var(--success)"
                : isFailed
                  ? "#DC2626"
                  : "var(--claude-accent)",
            }}
          />
        </span>

        {/* 工具名称 - Claude 风格 */}
        <span
          className="text-sm font-medium"
          style={{ color: "var(--claude-accent)" }}
        >
          {snakeToTitleCase(toolCall.name)}
        </span>

        {/* 文件名/参数 */}
        {fileName && (
          <span className="text-sm text-[var(--ink-600)] truncate">
            {fileName}
          </span>
        )}

        {/* 右侧操作按钮 */}
        <div className="flex items-center gap-1 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {/* 打开文件按钮 */}
          {filePath && fileContent && onFileClick && (
            <button
              onClick={handleOpenFile}
              className="p-1.5 rounded-md hover:bg-[var(--surface-secondary)] transition-colors"
              title="在画布中打开"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[var(--ink-600)] hover:text-[var(--ink-900)]" />
            </button>
          )}

          {/* 展开/折叠按钮 */}
          {hasResult && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-md hover:bg-[var(--surface-secondary)] transition-colors"
              title={isExpanded ? "收起详情" : "展开详情"}
            >
              <ChevronRight
                className={cn(
                  "w-3.5 h-3.5 text-[var(--ink-600)] transition-transform",
                  isExpanded && "rotate-90",
                )}
              />
            </button>
          )}
        </div>
      </div>

      {hasResultImages && (
        <div className="ml-4 mt-2 mb-2 flex flex-wrap gap-2">
          {resultImages.map((image, index) => (
            <button
              key={`${image.src.slice(0, 48)}-${index}`}
              className="overflow-hidden rounded-lg border border-[var(--ink-900)]/10 bg-[var(--surface-tertiary)]"
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

      {/* 展开的详情 - Claude 风格 */}
      {isExpanded && hasResult && (
        <div className="ml-4 mt-2 mb-2 p-3 rounded-xl bg-[var(--surface-tertiary)] border border-[var(--ink-900)]/10">
          <div
            className="text-xs font-semibold mb-2"
            style={{ color: "var(--claude-accent)" }}
          >
            Output
          </div>
          {resultMetaItems.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {resultMetaItems.map((item) => (
                <span
                  key={item}
                  className="rounded-full bg-[var(--surface-secondary)] px-2 py-1 text-[11px] text-[var(--ink-600)]"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : null}
          {resultPath ? (
            <div className="mb-2 break-all text-[11px] text-[var(--ink-600)]">
              {resultPath.label}: {resultPath.value}
            </div>
          ) : null}
          <pre
            className={cn(
              "whitespace-pre-wrap font-mono text-xs break-all max-h-40 overflow-y-auto",
              isFailed ? "text-red-500" : "text-[var(--ink-700)]",
            )}
          >
            {toolCall.result?.error || toolCall.result?.output || "(无输出)"}
          </pre>
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
}

export const ToolCallList: React.FC<ToolCallListProps> = ({
  toolCalls,
  isMessageStreaming = false,
  onFileClick,
}) => {
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {toolCalls.map((tc) => (
        <ToolCallDisplay
          key={tc.id}
          toolCall={tc}
          isMessageStreaming={isMessageStreaming}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
};

// 导出别名，用于交错显示模式
export const ToolCallItem = ToolCallDisplay;

export default ToolCallDisplay;
