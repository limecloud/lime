import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  FolderOpen,
  HardDriveDownload,
  ListChecks,
  Loader2,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SchedulerEvent,
  SchedulerExecutionResult,
  SchedulerProgress,
} from "@/lib/api/subAgentScheduler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import type { ActionRequired } from "../types";
import type {
  HarnessFileAction,
  HarnessFileKind,
  HarnessOutputSignal,
  HarnessSessionState,
} from "../utils/harnessState";

interface HarnessEnvironmentSummary {
  skillsCount: number;
  skillNames: string[];
  memorySignals: string[];
  contextItemsCount: number;
  activeContextCount: number;
  contextItemNames: string[];
  contextEnabled: boolean;
}

export interface HarnessFilePreviewResult {
  path?: string;
  content?: string | null;
  error?: string | null;
  isBinary?: boolean;
  size?: number;
}

interface HarnessStatusPanelProps {
  harnessState: HarnessSessionState;
  subAgentRuntime: {
    isRunning: boolean;
    progress: SchedulerProgress | null;
    events: SchedulerEvent[];
    result: SchedulerExecutionResult | null;
    error: string | null;
  };
  environment: HarnessEnvironmentSummary;
  onLoadFilePreview?: (path: string) => Promise<HarnessFilePreviewResult>;
  onOpenFile?: (fileName: string, content: string) => void;
  onRevealPath?: (path: string) => Promise<void>;
  onOpenPath?: (path: string) => Promise<void>;
}

interface PreviewDialogState {
  open: boolean;
  title: string;
  description?: string;
  path?: string;
  displayName: string;
  content?: string;
  preview?: string;
  error?: string;
  isBinary: boolean;
  size?: number;
  loading: boolean;
}

type FileFilterValue = "all" | HarnessFileKind;
type OutputFilterValue = "all" | "path" | "offload" | "truncated" | "summary";
type FileDisplayMode = "timeline" | "grouped";

type HarnessSectionKey =
  | "approvals"
  | "files"
  | "outputs"
  | "plan"
  | "delegation"
  | "context"
  | "capabilities";

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function formatTime(value?: Date): string {
  if (!value) {
    return "刚刚";
  }

  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(value?: number): string | null {
  if (!value || value <= 0) {
    return null;
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function describeAction(action: HarnessFileAction): string {
  switch (action) {
    case "read":
      return "读取";
    case "write":
      return "写入";
    case "edit":
      return "编辑";
    case "offload":
      return "转存";
    case "persist":
      return "落盘";
    default:
      return action;
  }
}

function describeKind(kind: HarnessFileKind): string {
  switch (kind) {
    case "document":
      return "文档";
    case "code":
      return "代码";
    case "log":
      return "日志";
    case "artifact":
      return "产物";
    case "offload":
      return "转存";
    default:
      return "文件";
  }
}

function resolveKindIcon(kind: HarnessFileKind): LucideIcon {
  switch (kind) {
    case "code":
      return FileCode2;
    case "artifact":
    case "offload":
      return FileArchive;
    default:
      return FileText;
  }
}

function getSignalPath(signal: HarnessOutputSignal): string | undefined {
  return signal.offloadFile || signal.outputFile || signal.artifactPath;
}

function summarizeFileActions(events: HarnessSessionState["recentFileEvents"]): string {
  const counts = new Map<HarnessFileAction, number>();

  for (const event of events) {
    counts.set(event.action, (counts.get(event.action) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([action, count]) => `${describeAction(action)} ${count}`)
    .join(" · ");
}

function matchesOutputFilter(
  signal: HarnessOutputSignal,
  filter: OutputFilterValue,
): boolean {
  const signalPath = getSignalPath(signal);

  switch (filter) {
    case "path":
      return Boolean(signalPath);
    case "offload":
      return Boolean(signal.offloaded || signal.offloadFile);
    case "truncated":
      return signal.truncated === true;
    case "summary":
      return !signalPath && Boolean(signal.preview?.trim());
    default:
      return true;
  }
}

function pickPathFromArguments(
  argumentsValue?: Record<string, unknown>,
): string | undefined {
  if (!argumentsValue) {
    return undefined;
  }

  for (const key of [
    "path",
    "filePath",
    "file_path",
    "fileName",
    "file_name",
    "filename",
    "targetPath",
    "target_path",
    "outputPath",
    "output_path",
  ]) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function describeApproval(item: ActionRequired): string | undefined {
  const hints: string[] = [];

  if (item.toolName?.trim()) {
    hints.push(item.toolName.trim());
  }

  const path = pickPathFromArguments(item.arguments);
  if (path) {
    hints.push(path);
  }

  const command = item.arguments?.cmd ?? item.arguments?.command;
  if (typeof command === "string" && command.trim()) {
    hints.push(command.trim());
  }

  return hints.length > 0 ? hints.join(" · ") : undefined;
}

function summarizeSchedulerEvent(event: SchedulerEvent): string {
  switch (event.type) {
    case "started":
      return `开始调度 ${event.totalTasks} 个子任务`;
    case "taskStarted":
      return `任务 ${event.taskId} 开始执行`;
    case "taskCompleted":
      return `任务 ${event.taskId} 已完成`;
    case "taskFailed":
      return `任务 ${event.taskId} 失败：${event.error}`;
    case "taskRetry":
      return `任务 ${event.taskId} 重试第 ${event.retryCount} 次`;
    case "taskSkipped":
      return `任务 ${event.taskId} 已跳过：${event.reason}`;
    case "progress":
      return `进度 ${event.progress.completed}/${event.progress.total}`;
    case "completed":
      return `调度完成，耗时 ${Math.round(event.durationMs / 1000)} 秒`;
    case "cancelled":
      return "调度已取消";
    default:
      return event.type;
  }
}

function SummaryCard({
  title,
  value,
  hint,
  icon: Icon,
  onClick,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  const cardContent = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <div className="mt-1 text-base font-semibold text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="rounded-lg bg-muted p-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="rounded-xl border border-border bg-background/80 p-3 text-left transition-colors hover:bg-muted/60"
        onClick={onClick}
        aria-label={`跳转到${title}`}
      >
        {cardContent}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background/80 p-3">
      {cardContent}
    </div>
  );
}

function Section({
  sectionKey,
  title,
  badge,
  children,
  registerRef,
}: {
  sectionKey?: HarnessSectionKey;
  title: string;
  badge?: string;
  children: ReactNode;
  registerRef?: (key: HarnessSectionKey, node: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={(node) =>
        sectionKey && registerRef ? registerRef(sectionKey, node) : undefined
      }
      data-harness-section={sectionKey}
      className="rounded-xl border border-border bg-background/80 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
      </div>
      {children}
    </section>
  );
}

export function HarnessStatusPanel({
  harnessState,
  subAgentRuntime,
  environment,
  onLoadFilePreview,
  onOpenFile,
  onRevealPath,
  onOpenPath,
}: HarnessStatusPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [fileFilter, setFileFilter] = useState<FileFilterValue>("all");
  const [outputFilter, setOutputFilter] = useState<OutputFilterValue>("all");
  const [fileDisplayMode, setFileDisplayMode] =
    useState<FileDisplayMode>("timeline");
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState>({
    open: false,
    title: "",
    displayName: "",
    isBinary: false,
    loading: false,
  });
  const previewRequestIdRef = useRef(0);
  const sectionRefs = useRef<Partial<Record<HarnessSectionKey, HTMLElement | null>>>(
    {},
  );

  const registerSectionRef = useCallback(
    (key: HarnessSectionKey, node: HTMLElement | null) => {
      sectionRefs.current[key] = node;
    },
    [],
  );

  const scrollToSection = useCallback(
    (key: HarnessSectionKey) => {
      const target = sectionRefs.current[key];
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [],
  );

  const recentSchedulerEvents = useMemo(
    () => subAgentRuntime.events.slice(-4).reverse(),
    [subAgentRuntime.events],
  );

  const fileFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "document" as const, label: "文档" },
        { value: "code" as const, label: "代码" },
        { value: "log" as const, label: "日志" },
        { value: "artifact" as const, label: "产物" },
        { value: "offload" as const, label: "转存" },
        { value: "other" as const, label: "其他" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.recentFileEvents.some((event) => event.kind === option.value),
      ),
    [harnessState.recentFileEvents],
  );

  const outputFilterOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: "全部" },
        { value: "path" as const, label: "有路径" },
        { value: "offload" as const, label: "转存" },
        { value: "truncated" as const, label: "截断" },
        { value: "summary" as const, label: "仅摘要" },
      ].filter(
        (option) =>
          option.value === "all" ||
          harnessState.outputSignals.some((signal) =>
            matchesOutputFilter(signal, option.value),
          ),
      ),
    [harnessState.outputSignals],
  );

  const filteredFileEvents = useMemo(
    () =>
      harnessState.recentFileEvents.filter(
        (event) => fileFilter === "all" || event.kind === fileFilter,
      ),
    [fileFilter, harnessState.recentFileEvents],
  );

  const filteredOutputSignals = useMemo(
    () =>
      harnessState.outputSignals.filter((signal) =>
        matchesOutputFilter(signal, outputFilter),
      ),
    [harnessState.outputSignals, outputFilter],
  );

  const groupedFileEvents = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        path: string;
        displayName: string;
        kind: HarnessFileKind;
        latestEvent: HarnessSessionState["recentFileEvents"][number];
        count: number;
        events: HarnessSessionState["recentFileEvents"];
      }
    >();

    for (const event of filteredFileEvents) {
      const key = event.path.trim() || event.id;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          key,
          path: event.path,
          displayName: event.displayName,
          kind: event.kind,
          latestEvent: event,
          count: 1,
          events: [event],
        });
        continue;
      }

      existing.events.push(event);
      existing.count += 1;

      const currentTime = existing.latestEvent.timestamp?.getTime() ?? 0;
      const nextTime = event.timestamp?.getTime() ?? 0;
      if (nextTime >= currentTime) {
        existing.latestEvent = event;
        existing.displayName = event.displayName;
        existing.kind = event.kind;
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        actionSummary: summarizeFileActions(group.events),
      }))
      .sort((left, right) => {
        const leftTime = left.latestEvent.timestamp?.getTime() ?? 0;
        const rightTime = right.latestEvent.timestamp?.getTime() ?? 0;
        return rightTime - leftTime;
      });
  }, [filteredFileEvents]);

  const availableSections = useMemo(
    () => [
      harnessState.pendingApprovals.length > 0
        ? { key: "approvals" as const, label: "待审批" }
        : null,
      harnessState.recentFileEvents.length > 0
        ? { key: "files" as const, label: "文件活动" }
        : null,
      harnessState.outputSignals.length > 0
        ? { key: "outputs" as const, label: "工具输出" }
        : null,
      harnessState.plan.phase !== "idle" || harnessState.plan.items.length > 0
        ? { key: "plan" as const, label: "规划状态" }
        : null,
      subAgentRuntime.isRunning ||
      harnessState.delegatedTasks.length > 0 ||
      recentSchedulerEvents.length > 0 ||
      subAgentRuntime.error ||
      subAgentRuntime.result
        ? { key: "delegation" as const, label: "子任务委派" }
        : null,
      harnessState.latestContextTrace.length > 0
        ? { key: "context" as const, label: "上下文轨迹" }
        : null,
      { key: "capabilities" as const, label: "已装载能力" },
    ].filter((item): item is { key: HarnessSectionKey; label: string } => item !== null),
    [
      harnessState.delegatedTasks.length,
      harnessState.latestContextTrace.length,
      harnessState.outputSignals.length,
      harnessState.pendingApprovals.length,
      harnessState.plan.items.length,
      harnessState.plan.phase,
      harnessState.recentFileEvents.length,
      recentSchedulerEvents.length,
      subAgentRuntime.error,
      subAgentRuntime.isRunning,
      subAgentRuntime.result,
    ],
  );

  const summaryCards = useMemo(
    () => [
      {
        sectionKey: "approvals" as const,
        title: "待审批",
        value: `${harnessState.pendingApprovals.length}`,
        hint:
          harnessState.pendingApprovals.length > 0
            ? "需要你确认的操作"
            : "当前无阻塞审批",
        icon: ShieldAlert,
      },
      {
        sectionKey: "files" as const,
        title: "文件活动",
        value: `${harnessState.recentFileEvents.length}`,
        hint:
          harnessState.recentFileEvents[0]?.displayName || "暂无可展示文件活动",
        icon: FolderOpen,
      },
      {
        sectionKey: "plan" as const,
        title: "计划状态",
        value:
          harnessState.plan.phase === "planning"
            ? "进行中"
            : harnessState.plan.phase === "ready"
              ? "已就绪"
              : "空闲",
        hint:
          harnessState.plan.items[0]?.content || "未检测到显式计划快照",
        icon: ListChecks,
      },
      {
        sectionKey: "context" as const,
        title: "上下文",
        value: `${environment.activeContextCount}/${environment.contextItemsCount}`,
        hint: environment.contextEnabled ? "上下文工作台已启用" : "普通聊天模式",
        icon: Sparkles,
      },
    ],
    [
      environment.activeContextCount,
      environment.contextEnabled,
      environment.contextItemsCount,
      harnessState.pendingApprovals.length,
      harnessState.plan.items,
      harnessState.plan.phase,
      harnessState.recentFileEvents,
    ],
  );

  const openPreview = useCallback(
    async ({
      title,
      description,
      path,
      content,
      preview,
    }: {
      title: string;
      description?: string;
      path?: string;
      content?: string;
      preview?: string;
    }) => {
      const requestId = previewRequestIdRef.current + 1;
      previewRequestIdRef.current = requestId;

      const shouldLoad =
        !content?.trim() && !!path && typeof onLoadFilePreview === "function";

      setPreviewDialog({
        open: true,
        title,
        description,
        path,
        displayName: path ? getFileName(path) : title,
        content: content?.trim() || preview?.trim(),
        preview,
        error:
          content?.trim() || preview?.trim()
            ? undefined
            : shouldLoad
              ? undefined
              : "暂无可预览内容",
        isBinary: false,
        loading: shouldLoad,
      });

      if (!shouldLoad || !path) {
        return;
      }

      try {
        const result = await onLoadFilePreview(path);
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        const nextPath = result.path || path;
        const normalizedContent = result.content ?? undefined;

        setPreviewDialog((current) => ({
          ...current,
          path: nextPath,
          displayName: getFileName(nextPath),
          content: normalizedContent?.trim() ? normalizedContent : current.content,
          isBinary: result.isBinary === true,
          size: result.size,
          error:
            result.isBinary === true
              ? undefined
              : result.error || (normalizedContent ? undefined : current.error),
          loading: false,
        }));
      } catch (error) {
        if (previewRequestIdRef.current !== requestId) {
          return;
        }

        setPreviewDialog((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [onLoadFilePreview],
  );

  const handleOpenFile = useCallback(() => {
    if (!onOpenFile || !previewDialog.content?.trim()) {
      return;
    }

    onOpenFile(
      previewDialog.path || previewDialog.displayName,
      previewDialog.content,
    );
  }, [onOpenFile, previewDialog.content, previewDialog.displayName, previewDialog.path]);

  const handleCopyPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可复制的文件路径");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(path);
      toast.success("文件路径已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制路径失败");
    }
  }, [previewDialog.path]);

  const handleCopyContent = useCallback(async () => {
    const content = previewDialog.content?.trim();
    if (!content) {
      toast.error("当前没有可复制的内容");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      toast.error("当前环境不支持剪贴板复制");
      return;
    }

    try {
      await navigator.clipboard.writeText(previewDialog.content || "");
      toast.success("内容已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制内容失败");
    }
  }, [previewDialog.content]);

  const handleRevealPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可定位的文件路径");
      return;
    }

    try {
      await (onRevealPath ?? revealPathInFinder)(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "定位文件失败");
    }
  }, [onRevealPath, previewDialog.path]);

  const handleOpenPath = useCallback(async () => {
    const path = previewDialog.path?.trim();
    if (!path) {
      toast.error("当前没有可打开的文件路径");
      return;
    }

    try {
      await (onOpenPath ?? openPathWithDefaultApp)(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "打开文件失败");
    }
  }, [onOpenPath, previewDialog.path]);

  return (
    <>
      <div className="mx-3 mt-2 rounded-2xl border border-border bg-muted/30">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Harness 运行面板
              </h2>
              {subAgentRuntime.isRunning ? (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  子任务运行中
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              展示最近文件活动、工具输出、审批与上下文装载情况。
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? "折叠 Harness 详情" : "展开 Harness 详情"}
          >
            {expanded ? (
              <ChevronDown className="mr-1 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1 h-4 w-4" />
            )}
            {expanded ? "收起详情" : "展开详情"}
          </Button>
        </div>

        <div className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <SummaryCard
              key={card.title}
              title={card.title}
              value={card.value}
              hint={card.hint}
              icon={card.icon}
              onClick={() => scrollToSection(card.sectionKey)}
            />
          ))}
        </div>

        {expanded ? (
          <ScrollArea className="max-h-[28rem] border-t border-border px-4 py-4">
            <div className="space-y-4 pb-1">
              {availableSections.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableSections.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                      onClick={() => scrollToSection(item.key)}
                      aria-label={`跳转到${item.label}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {harnessState.recentFileEvents.length > 0 ? (
                <Section
                  sectionKey="files"
                  title="最近文件活动"
                  badge={
                    fileDisplayMode === "grouped"
                      ? `${groupedFileEvents.length} 个文件 / ${filteredFileEvents.length} 条`
                      : filteredFileEvents.length === harnessState.recentFileEvents.length
                        ? `${harnessState.recentFileEvents.length} 条`
                        : `${filteredFileEvents.length} / ${harnessState.recentFileEvents.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-2">
                        {fileFilterOptions.map((option) => {
                          const count =
                            option.value === "all"
                              ? harnessState.recentFileEvents.length
                              : harnessState.recentFileEvents.filter(
                                  (event) => event.kind === option.value,
                                ).length;
                          const active = option.value === fileFilter;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileFilter(option.value)}
                              aria-pressed={active}
                              aria-label={`文件活动筛选：${option.label}`}
                            >
                              {option.label} {count}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "timeline" as const, label: "时间流" },
                          { value: "grouped" as const, label: "按文件" },
                        ].map((option) => {
                          const active = option.value === fileDisplayMode;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={cn(
                                "rounded-full border px-3 py-1 text-xs transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                              )}
                              onClick={() => setFileDisplayMode(option.value)}
                              aria-pressed={active}
                              aria-label={`文件视图：${option.label}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {filteredFileEvents.length > 0 ? (
                      fileDisplayMode === "grouped" ? (
                        groupedFileEvents.map((group) => {
                          const latestEvent = group.latestEvent;
                          const Icon = resolveKindIcon(group.kind);
                          return (
                            <button
                              key={group.key}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: latestEvent.displayName,
                                  description: `${describeAction(latestEvent.action)} · ${describeKind(group.kind)} · ${latestEvent.sourceToolName}`,
                                  path: latestEvent.path,
                                  content: latestEvent.content,
                                  preview: latestEvent.preview,
                                })
                              }
                              aria-label={`查看聚合文件活动：${group.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {group.displayName}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {group.path}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">{group.count} 次活动</Badge>
                                  <Badge variant="secondary">
                                    {describeKind(group.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(latestEvent.timestamp)}</span>
                                <span>·</span>
                                <span>最近 {describeAction(latestEvent.action)}</span>
                                <span>·</span>
                                <span>{group.actionSummary}</span>
                              </div>
                              {latestEvent.preview ? (
                                <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  {latestEvent.preview}
                                </pre>
                              ) : null}
                            </button>
                          );
                        })
                      ) : (
                        filteredFileEvents.map((event) => {
                          const Icon = resolveKindIcon(event.kind);
                          return (
                            <button
                              key={event.id}
                              type="button"
                              className="w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60"
                              onClick={() =>
                                void openPreview({
                                  title: event.displayName,
                                  description: `${describeAction(event.action)} · ${describeKind(event.kind)} · ${event.sourceToolName}`,
                                  path: event.path,
                                  content: event.content,
                                  preview: event.preview,
                                })
                              }
                              aria-label={`查看文件活动：${event.displayName}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <Icon className="h-4 w-4 text-muted-foreground" />
                                    <span className="truncate text-sm font-medium text-foreground">
                                      {event.displayName}
                                    </span>
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {event.path}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge variant="outline">
                                    {describeAction(event.action)}
                                  </Badge>
                                  <Badge variant="secondary">
                                    {describeKind(event.kind)}
                                  </Badge>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span>{formatTime(event.timestamp)}</span>
                                <span>·</span>
                                <span>{event.sourceToolName}</span>
                              </div>
                              {event.preview ? (
                                <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                                  {event.preview}
                                </pre>
                              ) : null}
                            </button>
                          );
                        })
                      )
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {harnessState.outputSignals.length > 0 ? (
                <Section
                  sectionKey="outputs"
                  title="工具输出"
                  badge={
                    filteredOutputSignals.length === harnessState.outputSignals.length
                      ? `${harnessState.outputSignals.length} 条`
                      : `${filteredOutputSignals.length} / ${harnessState.outputSignals.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {outputFilterOptions.map((option) => {
                        const count =
                          option.value === "all"
                            ? harnessState.outputSignals.length
                            : harnessState.outputSignals.filter((signal) =>
                                matchesOutputFilter(signal, option.value),
                              ).length;
                        const active = option.value === outputFilter;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              active
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                            onClick={() => setOutputFilter(option.value)}
                            aria-pressed={active}
                            aria-label={`工具输出筛选：${option.label}`}
                          >
                            {option.label} {count}
                          </button>
                        );
                      })}
                    </div>
                    {filteredOutputSignals.length > 0 ? (
                      filteredOutputSignals.map((signal) => {
                      const signalPath = getSignalPath(signal);
                      return (
                        <button
                          key={signal.id}
                          type="button"
                          className={cn(
                            "w-full rounded-xl border border-border bg-background p-3 text-left transition-colors hover:bg-muted/60",
                            !signalPath && !signal.preview && "cursor-default",
                          )}
                          onClick={() =>
                            signalPath || signal.preview
                              ? void openPreview({
                                  title: signal.title,
                                  description: signal.summary,
                                  path: signalPath,
                                  preview: signal.preview,
                                })
                              : undefined
                          }
                          aria-label={`查看工具输出：${signal.title}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                                <span className="truncate text-sm font-medium text-foreground">
                                  {signal.title}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {signal.summary}
                              </div>
                              {signalPath ? (
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {signalPath}
                                </div>
                              ) : null}
                            </div>
                            <Badge variant="outline">{signal.toolName}</Badge>
                          </div>
                          {signal.preview ? (
                            <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                              {signal.preview}
                            </pre>
                          ) : null}
                        </button>
                      );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        当前筛选条件下暂无记录。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {harnessState.pendingApprovals.length > 0 ? (
                <Section
                  sectionKey="approvals"
                  title="待处理审批"
                  badge={`${harnessState.pendingApprovals.length} 条`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {harnessState.pendingApprovals.map((item) => (
                      <div
                        key={item.requestId}
                        className="rounded-xl border border-amber-200 bg-amber-50/80 p-3"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                          <ShieldAlert className="h-4 w-4" />
                          <span>{item.prompt || "等待用户确认"}</span>
                        </div>
                        {describeApproval(item) ? (
                          <div className="mt-2 text-xs text-amber-800">
                            {describeApproval(item)}
                          </div>
                        ) : null}
                        <div className="mt-2 text-xs text-amber-700">
                          请求 ID：{item.requestId}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              {harnessState.plan.phase !== "idle" ||
              harnessState.plan.items.length > 0 ? (
                <Section
                  sectionKey="plan"
                  title="规划状态"
                  badge={
                    harnessState.plan.phase === "planning"
                      ? "规划中"
                      : harnessState.plan.phase === "ready"
                        ? "已就绪"
                        : "空闲"
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.plan.items.length > 0 ? (
                      harnessState.plan.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                        >
                          <div className="min-w-0 text-sm text-foreground">
                            {item.content}
                          </div>
                          <Badge
                            variant={
                              item.status === "completed"
                                ? "secondary"
                                : item.status === "in_progress"
                                  ? "default"
                                  : "outline"
                            }
                          >
                            {item.status === "completed"
                              ? "已完成"
                              : item.status === "in_progress"
                                ? "进行中"
                                : "待开始"}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                        已进入规划流程，但暂无可展示的 Todo 快照。
                      </div>
                    )}
                  </div>
                </Section>
              ) : null}

              {subAgentRuntime.isRunning ||
              harnessState.delegatedTasks.length > 0 ||
              recentSchedulerEvents.length > 0 ||
              subAgentRuntime.error ||
              subAgentRuntime.result ? (
                <Section
                  sectionKey="delegation"
                  title="子任务委派"
                  badge={
                    subAgentRuntime.isRunning
                      ? "运行中"
                      : `${harnessState.delegatedTasks.length} 条`
                  }
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-3">
                    {subAgentRuntime.progress ? (
                      <div className="rounded-xl border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-foreground">
                            调度进度
                          </div>
                          <Badge variant="secondary">
                            {subAgentRuntime.progress.completed}/
                            {subAgentRuntime.progress.total}
                          </Badge>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{
                              width: `${Math.max(
                                0,
                                Math.min(100, subAgentRuntime.progress.percentage),
                              )}%`,
                            }}
                          />
                        </div>
                        {subAgentRuntime.progress.currentTasks.length > 0 ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            当前任务：
                            {subAgentRuntime.progress.currentTasks.join("、")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {harnessState.delegatedTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-xl border border-border bg-background p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Bot className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate text-sm font-medium text-foreground">
                                {task.title}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {task.role ? <span>角色：{task.role}</span> : null}
                              {task.taskType ? (
                                <span>类型：{task.taskType}</span>
                              ) : null}
                              {task.model ? <span>模型：{task.model}</span> : null}
                            </div>
                            {task.summary ? (
                              <div className="mt-2 text-xs text-muted-foreground">
                                {task.summary}
                              </div>
                            ) : null}
                          </div>
                          <Badge
                            variant={
                              task.status === "completed"
                                ? "secondary"
                                : task.status === "running"
                                  ? "default"
                                  : "destructive"
                            }
                          >
                            {task.status === "completed"
                              ? "已完成"
                              : task.status === "running"
                                ? "运行中"
                                : "失败"}
                          </Badge>
                        </div>
                      </div>
                    ))}

                    {recentSchedulerEvents.length > 0 ? (
                      <div className="rounded-xl border border-border bg-background p-3">
                        <div className="mb-2 text-sm font-medium text-foreground">
                          最近调度事件
                        </div>
                        <div className="space-y-2">
                          {recentSchedulerEvents.map((event, index) => (
                            <div
                              key={`${event.type}-${index}`}
                              className="text-xs text-muted-foreground"
                            >
                              {summarizeSchedulerEvent(event)}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {subAgentRuntime.error ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                        {subAgentRuntime.error}
                      </div>
                    ) : null}

                    {subAgentRuntime.result?.mergedSummary ? (
                      <div className="rounded-xl border border-border bg-background p-3 text-sm text-muted-foreground">
                        {subAgentRuntime.result.mergedSummary}
                      </div>
                    ) : null}
                  </div>
                </Section>
              ) : null}

              {harnessState.latestContextTrace.length > 0 ? (
                <Section
                  sectionKey="context"
                  title="最新上下文轨迹"
                  badge={`${harnessState.latestContextTrace.length} 步`}
                  registerRef={registerSectionRef}
                >
                  <div className="space-y-2">
                    {harnessState.latestContextTrace.map((step, index) => (
                      <div
                        key={`${step.stage}-${index}`}
                        className="rounded-lg border border-border bg-background px-3 py-2"
                      >
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Workflow className="h-4 w-4 text-muted-foreground" />
                          <span>{step.stage}</span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {step.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              ) : null}

              <Section
                sectionKey="capabilities"
                title="已装载能力"
                badge={`${environment.skillsCount} 个技能`}
                registerRef={registerSectionRef}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {environment.skillNames.length > 0 ? (
                      environment.skillNames.map((name) => (
                        <Badge key={name} variant="secondary">
                          {name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        当前未检测到已装载技能名称
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {environment.memorySignals.length > 0 ? (
                      environment.memorySignals.map((signal) => (
                        <Badge key={signal} variant="outline">
                          {signal}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        当前未识别到持久记忆信号
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>
                      上下文条目：{environment.activeContextCount}/
                      {environment.contextItemsCount}
                    </div>
                    {environment.contextItemNames.length > 0 ? (
                      <div>活跃上下文：{environment.contextItemNames.join("、")}</div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      规划 {harnessState.activity.planning}
                    </Badge>
                    <Badge variant="outline">
                      文件 {harnessState.activity.filesystem}
                    </Badge>
                    <Badge variant="outline">
                      执行 {harnessState.activity.execution}
                    </Badge>
                    <Badge variant="outline">网页 {harnessState.activity.web}</Badge>
                    <Badge variant="outline">
                      技能 {harnessState.activity.skills}
                    </Badge>
                    <Badge variant="outline">
                      委派 {harnessState.activity.delegation}
                    </Badge>
                  </div>
                </div>
              </Section>
            </div>
          </ScrollArea>
        ) : null}
      </div>

      <Dialog
        open={previewDialog.open}
        onOpenChange={(open) =>
          setPreviewDialog((current) => ({
            ...current,
            open,
            loading: open ? current.loading : false,
          }))
        }
      >
        <DialogContent maxWidth="max-w-4xl" className="p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle className="pr-8">{previewDialog.title}</DialogTitle>
            <DialogDescription className="space-y-1">
              {previewDialog.description ? (
                <span className="block">{previewDialog.description}</span>
              ) : null}
              {previewDialog.path ? (
                <span className="block break-all text-xs">
                  {previewDialog.path}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{previewDialog.displayName}</Badge>
              {formatSize(previewDialog.size) ? (
                <Badge variant="outline">{formatSize(previewDialog.size)}</Badge>
              ) : null}
              {previewDialog.loading ? (
                <Badge variant="outline" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在加载完整内容
                </Badge>
              ) : null}
              {previewDialog.preview &&
              previewDialog.content === previewDialog.preview &&
              !previewDialog.loading ? (
                <Badge variant="outline">当前展示为摘要预览</Badge>
              ) : null}
            </div>

            <ScrollArea className="max-h-[60vh] rounded-xl border border-border bg-muted/30">
              {previewDialog.isBinary ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <HardDriveDownload className="h-4 w-4" />
                  该文件为二进制内容，暂不支持文本预览。
                </div>
              ) : previewDialog.error ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  {previewDialog.error}
                </div>
              ) : previewDialog.content ? (
                <pre className="whitespace-pre-wrap break-all px-4 py-4 text-xs leading-6 text-foreground">
                  {previewDialog.content}
                </pre>
              ) : (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <Eye className="h-4 w-4" />
                  暂无可展示内容
                </div>
              )}
            </ScrollArea>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            {previewDialog.path ? (
              <Button type="button" variant="outline" onClick={() => void handleCopyPath()}>
                复制路径
              </Button>
            ) : null}
            {previewDialog.content?.trim() ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleCopyContent()}
              >
                复制内容
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRevealPath()}
              >
                定位文件
              </Button>
            ) : null}
            {previewDialog.path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleOpenPath()}
              >
                系统打开
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPreviewDialog((current) => ({ ...current, open: false }))
              }
            >
              关闭
            </Button>
            {onOpenFile &&
            !previewDialog.isBinary &&
            previewDialog.content?.trim() ? (
              <Button type="button" onClick={handleOpenFile}>
                在会话中打开
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default HarnessStatusPanel;
