import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpLeft,
  Bot,
  ChevronDown,
  Clock3,
  GitBranch,
  ListTodo,
  Loader2,
  MoreHorizontal,
  PencilLine,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import {
  deriveTaskLiveState,
  extractTaskPreviewFromMessages,
  type Topic,
  type TaskStatus,
  type TaskStatusReason,
} from "../hooks/agentChatShared";
import type { Message } from "../types";
import { resolveInternalImageTaskDisplayName } from "../utils/internalImagePlaceholder";

const RECENT_TASK_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
const OLDER_TASKS_INITIAL_COUNT = 8;
const TEAM_SECTION_INITIAL_CHILD_COUNT = 3;
const TEAM_SECTION_INITIAL_SIBLING_COUNT = 2;
const PINNED_TASK_IDS_STORAGE_KEY = "lime_task_sidebar_pinned_ids";

const STATUS_META: Record<
  TaskStatus,
  {
    label: string;
    badgeClassName: string;
    dotClassName: string;
  }
> = {
  draft: {
    label: "待补充",
    badgeClassName:
      "border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
    dotClassName: "bg-slate-400",
  },
  running: {
    label: "进行中",
    badgeClassName:
      "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300",
    dotClassName: "bg-sky-500",
  },
  waiting: {
    label: "待处理",
    badgeClassName:
      "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
    dotClassName: "bg-amber-500",
  },
  done: {
    label: "已完成",
    badgeClassName:
      "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    dotClassName: "bg-emerald-500",
  },
  failed: {
    label: "执行失败",
    badgeClassName:
      "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300",
    dotClassName: "bg-rose-500",
  },
};

type TaskSectionKey =
  | "running"
  | "waiting"
  | "recent"
  | "older";

type ChatSidebarContextVariant = "default" | "task-center";

interface TaskCardViewModel {
  id: string;
  title: string;
  updatedAt: Date;
  messagesCount: number;
  status: TaskStatus;
  statusReason?: TaskStatusReason;
  statusLabel: string;
  lastPreview: string;
  isCurrent: boolean;
  isPinned: boolean;
  hasUnread: boolean;
}

interface TaskSection {
  key: TaskSectionKey;
  title: string;
  items: TaskCardViewModel[];
}

interface ChatSidebarProps {
  contextVariant?: ChatSidebarContextVariant;
  onNewChat: () => void;
  topics: Topic[];
  currentTopicId: string | null;
  onSwitchTopic: (topicId: string) => void | Promise<void>;
  onResumeTask?: (
    topicId: string,
    statusReason?: TaskStatusReason,
  ) => void | Promise<void>;
  onDeleteTopic: (topicId: string) => void;
  onRenameTopic?: (topicId: string, newTitle: string) => void;
  currentMessages?: Message[];
  isSending?: boolean;
  pendingActionCount?: number;
  queuedTurnCount?: number;
  workspaceError?: boolean;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onReturnToParentSession?: () => void | Promise<void>;
}

function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays}天前`;
  }

  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function normalizePreviewText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 72);
}

function resolveSidebarDisplayTitle(
  value: string | null | undefined,
  fallback: string,
) {
  return resolveInternalImageTaskDisplayName(value) || fallback;
}

function resolveCurrentTaskPreview(messages: Message[]) {
  return extractTaskPreviewFromMessages(messages);
}

function sortTaskItems(items: TaskCardViewModel[]) {
  return [...items].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }
    if (left.isPinned !== right.isPinned) {
      return left.isPinned ? -1 : 1;
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

function loadPinnedTaskIds() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(PINNED_TASK_IDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function resolveCurrentStatusPreview(
  status: TaskStatus,
  statusReason: TaskStatusReason | undefined,
  fallbackPreview: string,
  pendingActionCount: number,
  workspaceError: boolean,
) {
  if ((workspaceError || statusReason === "workspace_error") && status === "failed") {
    return "工作区异常，等待你重新选择本地目录后继续。";
  }
  if (status === "running") {
    return "正在生成回复或执行工具，请稍候。";
  }
  if (status === "waiting" && pendingActionCount > 0) {
    return "等待你确认或补充信息后继续执行。";
  }
  if (status === "draft") {
    return "等待你补充任务需求后开始执行。";
  }
  return fallbackPreview;
}

function resolveStatusLabel(
  status: TaskStatus,
  statusReason?: TaskStatusReason,
): string {
  if (status === "failed" && statusReason === "workspace_error") {
    return "工作区异常";
  }

  return STATUS_META[status].label;
}

function resolveTaskStatus(params: {
  topic: Topic;
  currentTopicId: string | null;
  currentMessages: Message[];
  isSending: boolean;
  pendingActionCount: number;
  queuedTurnCount: number;
  workspaceError: boolean;
}) {
  const {
    topic,
    currentTopicId,
    currentMessages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    workspaceError,
  } = params;

  if (topic.id === currentTopicId) {
    return deriveTaskLiveState({
      messages: currentMessages,
      isSending,
      pendingActionCount,
      queuedTurnCount,
      workspaceError,
    });
  }

  return {
    status: topic.status,
    statusReason: topic.statusReason ?? "default",
  };
}

function buildTaskSections(
  items: TaskCardViewModel[],
  contextVariant: ChatSidebarContextVariant,
) {
  const now = Date.now();
  const running: TaskCardViewModel[] = [];
  const waiting: TaskCardViewModel[] = [];
  const recent: TaskCardViewModel[] = [];
  const older: TaskCardViewModel[] = [];

  for (const item of items) {
    if (item.status === "running") {
      running.push(item);
      continue;
    }

    if (
      item.status === "waiting" ||
      item.status === "draft" ||
      item.status === "failed"
    ) {
      waiting.push(item);
      continue;
    }

    if (now - item.updatedAt.getTime() <= RECENT_TASK_WINDOW_MS) {
      recent.push(item);
      continue;
    }

    older.push(item);
  }

  const titleSet =
    contextVariant === "task-center"
      ? {
          running: "正在推进",
          waiting: "等你继续",
          recent: "最近回访",
          older: "更早记录",
        }
      : {
          running: "进行中",
          waiting: "待处理",
          recent: "最近完成",
          older: "更早任务",
        };

  return [
    { key: "running", title: titleSet.running, items: sortTaskItems(running) },
    { key: "waiting", title: titleSet.waiting, items: sortTaskItems(waiting) },
    { key: "recent", title: titleSet.recent, items: sortTaskItems(recent) },
    { key: "older", title: titleSet.older, items: sortTaskItems(older) },
  ] satisfies TaskSection[];
}

const SUBAGENT_STATUS_META: Record<
  NonNullable<AsterSubagentSessionInfo["runtime_status"]> | "idle",
  {
    label: string;
    badgeClassName: string;
  }
> = {
  idle: {
    label: "待开始",
    badgeClassName:
      "border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
  },
  queued: {
    label: "稍后开始",
    badgeClassName:
      "border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
  },
  running: {
    label: "处理中",
    badgeClassName:
      "border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-200",
  },
  completed: {
    label: "已完成",
    badgeClassName:
      "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200",
  },
  failed: {
    label: "失败",
    badgeClassName:
      "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
  },
  aborted: {
    label: "已中止",
    badgeClassName:
      "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200",
  },
  closed: {
    label: "已关闭",
    badgeClassName:
      "border border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
  },
};

const TEAM_STATUS_SUMMARY_ORDER: Array<
  NonNullable<AsterSubagentSessionInfo["runtime_status"]> | "idle"
> = ["running", "queued", "completed", "failed", "aborted", "closed", "idle"];

function resolveSubagentStatusMeta(
  status?: AsterSubagentSessionInfo["runtime_status"],
) {
  return SUBAGENT_STATUS_META[status ?? "idle"];
}

function resolveSubagentSessionTypeLabel(value?: string) {
  switch (value) {
    case "sub_agent":
      return "子代理";
    case "fork":
      return "分支会话";
    case "user":
    default:
      return value?.trim() || "会话";
  }
}

function resolveUnixDate(value?: number) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value * 1000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function buildCollapsedTeamSummary(
  sessions: AsterSubagentSessionInfo[],
  label: string,
) {
  const counts = new Map<
    NonNullable<AsterSubagentSessionInfo["runtime_status"]> | "idle",
    number
  >();

  for (const session of sessions) {
    const key = session.runtime_status ?? "idle";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const statusSummary = TEAM_STATUS_SUMMARY_ORDER.map((status) => {
    const count = counts.get(status) ?? 0;
    if (count <= 0) {
      return null;
    }

    return `${count} 个${SUBAGENT_STATUS_META[status].label}`;
  }).filter((item): item is string => Boolean(item));

  return ["已收起", label, ...statusSummary].join(" · ");
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  contextVariant = "default",
  onNewChat,
  topics,
  currentTopicId,
  onSwitchTopic,
  onResumeTask,
  onDeleteTopic,
  onRenameTopic,
  currentMessages = [],
  isSending = false,
  pendingActionCount = 0,
  queuedTurnCount = 0,
  workspaceError = false,
  childSubagentSessions = [],
  subagentParentContext = null,
  onOpenSubagentSession,
  onReturnToParentSession,
}) => {
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active">("all");
  const [showAllOlder, setShowAllOlder] = useState(false);
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>(() =>
    loadPinnedTaskIds(),
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<TaskSectionKey, boolean>
  >({
    running: false,
    waiting: false,
    recent: false,
    older: false,
  });
  const [teamSectionCollapsedOverride, setTeamSectionCollapsedOverride] = useState<
    boolean | null
  >(null);
  const [showAllChildSubagents, setShowAllChildSubagents] = useState(false);
  const [showAllSiblingSubagents, setShowAllSiblingSubagents] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const taskSectionAnchorRef = useRef<HTMLDivElement>(null);

  const currentTaskPreview = useMemo(
    () => resolveCurrentTaskPreview(currentMessages),
    [currentMessages],
  );
  const pinnedTaskIdSet = useMemo(
    () => new Set(pinnedTaskIds),
    [pinnedTaskIds],
  );

  const taskItems = useMemo(() => {
    return topics.map((topic) => {
      const { status, statusReason } = resolveTaskStatus({
        topic,
        currentTopicId,
        currentMessages,
        isSending,
        pendingActionCount,
        queuedTurnCount,
        workspaceError,
      });

      const statusLabel = resolveStatusLabel(status, statusReason);
      const isCurrent = topic.id === currentTopicId;
      const fallbackPreview = normalizePreviewText(topic.lastPreview);
      const preview = isCurrent
        ? resolveCurrentStatusPreview(
            status,
            statusReason,
            currentTaskPreview || fallbackPreview,
            pendingActionCount,
            workspaceError,
          )
        : fallbackPreview;

      return {
        id: topic.id,
        title: resolveSidebarDisplayTitle(topic.title, "未命名任务"),
        updatedAt: topic.updatedAt || topic.createdAt,
        messagesCount: topic.messagesCount,
        status,
        statusReason,
        statusLabel,
        lastPreview: preview || "等待你补充任务需求后开始执行。",
        isCurrent,
        isPinned: topic.isPinned || pinnedTaskIdSet.has(topic.id),
        hasUnread: topic.hasUnread,
      } satisfies TaskCardViewModel;
    });
  }, [
    currentTaskPreview,
    currentTopicId,
    currentMessages,
    isSending,
    pendingActionCount,
    queuedTurnCount,
    pinnedTaskIdSet,
    topics,
    workspaceError,
  ]);
  const currentTaskItem = useMemo(
    () => taskItems.find((item) => item.id === currentTopicId) ?? null,
    [currentTopicId, taskItems],
  );
  const sortedChildSubagentSessions = useMemo(
    () =>
      [...childSubagentSessions].sort(
        (left, right) => right.updated_at - left.updated_at,
      ),
    [childSubagentSessions],
  );
  const siblingSubagentSessions = useMemo(
    () =>
      [...(subagentParentContext?.sibling_subagent_sessions ?? [])].sort(
        (left, right) => right.updated_at - left.updated_at,
      ),
    [subagentParentContext?.sibling_subagent_sessions],
  );
  const visibleChildSubagentSessions = useMemo(
    () =>
      showAllChildSubagents
        ? sortedChildSubagentSessions
        : sortedChildSubagentSessions.slice(0, TEAM_SECTION_INITIAL_CHILD_COUNT),
    [showAllChildSubagents, sortedChildSubagentSessions],
  );
  const visibleSiblingSubagentSessions = useMemo(
    () =>
      showAllSiblingSubagents
        ? siblingSubagentSessions
        : siblingSubagentSessions.slice(0, TEAM_SECTION_INITIAL_SIBLING_COUNT),
    [showAllSiblingSubagents, siblingSubagentSessions],
  );
  const hiddenChildSubagentCount = Math.max(
    0,
    sortedChildSubagentSessions.length - visibleChildSubagentSessions.length,
  );
  const hiddenSiblingSubagentCount = Math.max(
    0,
    siblingSubagentSessions.length - visibleSiblingSubagentSessions.length,
  );
  const shouldShowTeamSection =
    Boolean(subagentParentContext) || sortedChildSubagentSessions.length > 0;
  const teamSummarySessions = subagentParentContext
    ? siblingSubagentSessions
    : sortedChildSubagentSessions;
  const shouldAutoCollapseTeamSection = subagentParentContext
    ? siblingSubagentSessions.length > TEAM_SECTION_INITIAL_SIBLING_COUNT
    : sortedChildSubagentSessions.length > TEAM_SECTION_INITIAL_CHILD_COUNT;
  const teamSectionIdentity = subagentParentContext
    ? `child:${subagentParentContext.parent_session_id}:${siblingSubagentSessions
        .map((session) => session.id)
        .join(",")}`
    : `parent:${sortedChildSubagentSessions
        .map((session) => session.id)
        .join(",")}`;
  const teamSectionCollapsed =
    teamSectionCollapsedOverride ?? shouldAutoCollapseTeamSection;
  const collapsedTeamSummary = useMemo(
    () =>
      buildCollapsedTeamSummary(
        teamSummarySessions,
        subagentParentContext
          ? `${siblingSubagentSessions.length} 个同级子代理`
          : `${sortedChildSubagentSessions.length} 个子代理`,
      ),
    [
      siblingSubagentSessions,
      sortedChildSubagentSessions,
      subagentParentContext,
      teamSummarySessions,
    ],
  );

  const filteredTaskItems = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return taskItems.filter((item) => {
      if (
        statusFilter === "active" &&
        item.status !== "running" &&
        item.status !== "waiting"
      ) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return `${item.title} ${item.lastPreview} ${item.statusLabel}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [searchKeyword, statusFilter, taskItems]);

  const sections = useMemo(
    () => buildTaskSections(filteredTaskItems, contextVariant),
    [contextVariant, filteredTaskItems],
  );
  const hasAnyTasks = topics.length > 0;
  const hasFilteredResults = filteredTaskItems.length > 0;
  const taskHeadingLabel =
    contextVariant === "task-center" ? "工作现场" : "任务";
  const taskHeadingHint =
    contextVariant === "task-center"
      ? "回到进行中的任务、旧历史和最近工作现场。"
      : null;
  const emptyStateTitle =
    contextVariant === "task-center" ? "还没有进行中的任务" : "还没有任务";
  const emptyStateDescription =
    contextVariant === "task-center"
      ? "从“新建任务”开始也很自然，创建后会在这里继续回访。"
      : "从“新建任务”开始输入需求，创建后会出现在这里。";
  const olderSectionMoreLabel =
    contextVariant === "task-center" ? "查看更多旧历史" : "查看更多历史任务";

  useEffect(() => {
    if (editingTopicId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTopicId]);

  useEffect(() => {
    setShowAllOlder(false);
  }, [searchKeyword, statusFilter]);

  useEffect(() => {
    setTeamSectionCollapsedOverride(null);
    setShowAllChildSubagents(false);
    setShowAllSiblingSubagents(false);
  }, [teamSectionIdentity]);

  useEffect(() => {
    if (sortedChildSubagentSessions.length <= TEAM_SECTION_INITIAL_CHILD_COUNT) {
      setShowAllChildSubagents(false);
    }
  }, [sortedChildSubagentSessions.length]);

  useEffect(() => {
    if (siblingSubagentSessions.length <= TEAM_SECTION_INITIAL_SIBLING_COUNT) {
      setShowAllSiblingSubagents(false);
    }
  }, [siblingSubagentSessions.length]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      PINNED_TASK_IDS_STORAGE_KEY,
      JSON.stringify(pinnedTaskIds),
    );
  }, [pinnedTaskIds]);

  const handleDeleteClick = (topicId: string) => {
    onDeleteTopic(topicId);
  };

  const handleStartEdit = (topicId: string, currentTitle: string) => {
    setEditingTopicId(topicId);
    setEditTitle(currentTitle);
  };

  const handleTogglePinned = (topicId: string) => {
    setPinnedTaskIds((current) =>
      current.includes(topicId)
        ? current.filter((item) => item !== topicId)
        : [...current, topicId],
    );
  };

  const handleResumeTask = (item: TaskCardViewModel) => {
    if (onResumeTask) {
      void onResumeTask(item.id, item.statusReason);
      return;
    }

    void onSwitchTopic(item.id);
  };

  const handleJumpToTaskSection = () => {
    setTeamSectionCollapsedOverride(true);
    setShowAllChildSubagents(false);
    setShowAllSiblingSubagents(false);
    taskSectionAnchorRef.current?.scrollIntoView({
      block: "start",
      behavior: "smooth",
    });
  };

  const handleSaveEdit = () => {
    if (editingTopicId && editTitle.trim() && onRenameTopic) {
      onRenameTopic(editingTopicId, editTitle.trim());
    }
    setEditingTopicId(null);
    setEditTitle("");
  };

  const handleCancelEdit = () => {
    setEditingTopicId(null);
    setEditTitle("");
  };

  const handleEditKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleSaveEdit();
    } else if (event.key === "Escape") {
      handleCancelEdit();
    }
  };

  const renderSubagentSessionCard = (
    session: AsterSubagentSessionInfo,
    options?: {
      highlightCurrent?: boolean;
      subtitle?: string;
    },
  ) => {
    const statusMeta = resolveSubagentStatusMeta(session.runtime_status);
    const updatedAt = resolveUnixDate(session.updated_at);
    const canOpen = Boolean(onOpenSubagentSession);

    return (
      <button
        key={session.id}
        type="button"
        onClick={() => {
          if (!canOpen) {
            return;
          }
          void onOpenSubagentSession?.(session.id);
        }}
        className={cn(
          "w-full rounded-[20px] border px-3.5 py-3 text-left shadow-sm shadow-slate-950/5 transition",
          options?.highlightCurrent
            ? "border-slate-300 bg-white/98 ring-1 ring-slate-100 dark:border-white/15 dark:bg-white/10"
            : "border-slate-200/80 bg-white/86 hover:border-slate-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
          !canOpen ? "cursor-default" : "",
        )}
        disabled={!canOpen}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {resolveSidebarDisplayTitle(session.name, "未命名子代理")}
              </div>
              <Badge className={statusMeta.badgeClassName}>
                {statusMeta.label}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>{options?.subtitle ?? resolveSubagentSessionTypeLabel(session.session_type)}</span>
              {session.role_hint ? <span>角色 · {session.role_hint}</span> : null}
              {updatedAt ? <span>更新于 {formatRelativeTime(updatedAt)}</span> : null}
            </div>
            {session.task_summary ? (
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                {session.task_summary}
              </p>
            ) : null}
          </div>
        </div>
      </button>
    );
  };

  return (
    <aside
      className="w-[308px] shrink-0 overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.98)_0%,rgba(241,245,249,0.92)_100%)] shadow-sm shadow-slate-950/5 backdrop-blur dark:border-white/10 dark:bg-[#111318]"
      data-testid="chat-sidebar"
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-4">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索任务标题或摘要"
              className="h-11 w-full rounded-[18px] border border-slate-200/80 bg-white/92 pl-9 pr-3 text-sm text-slate-700 shadow-sm shadow-slate-950/5 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[18px] bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm shadow-slate-950/10 transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" />
            新建任务
          </button>

          <div className="flex flex-wrap items-center gap-2 rounded-[22px] border border-white/85 bg-white/72 p-2 shadow-sm shadow-slate-950/5">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "inline-flex h-9 flex-1 items-center justify-center rounded-2xl border px-2 text-xs font-medium transition",
                statusFilter === "all"
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200/80 bg-white/90 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
              )}
            >
              全部任务
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={cn(
                "inline-flex h-9 flex-1 items-center justify-center rounded-2xl border px-2 text-xs font-medium transition",
                statusFilter === "active"
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200/80 bg-white/90 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
              )}
            >
              仅看进行中
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]"
          data-testid="chat-sidebar-scroll-area"
        >
          <div className="space-y-4 pb-1">
            {shouldShowTeamSection ? (
              <section
                className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(248,250,252,0.9)_100%)] px-3.5 py-3.5 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/5"
                data-testid="team-runtime-section"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
                      <GitBranch className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Team Runtime
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                        {teamSectionCollapsed
                          ? collapsedTeamSummary
                          : subagentParentContext
                            ? "当前线程来自父会话，可直接返回主线程并切换同级子代理。"
                            : "这里展示真实 child session，而不是 synthetic timeline。"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className="border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                      {subagentParentContext
                        ? "子线程"
                        : `${sortedChildSubagentSessions.length} 个子代理`}
                    </Badge>
                    {hasAnyTasks ? (
                      <button
                        type="button"
                        aria-label="跳转到任务列表"
                        title="跳转到任务列表"
                        onClick={handleJumpToTaskSection}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 dark:hover:text-slate-100"
                      >
                        <ListTodo className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={
                        teamSectionCollapsed
                          ? "展开 Team Runtime"
                          : "收起 Team Runtime"
                      }
                      onClick={() =>
                        setTeamSectionCollapsedOverride(
                          (collapsed) =>
                            !(collapsed ?? shouldAutoCollapseTeamSection),
                        )
                      }
                      className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/90 text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 dark:hover:text-slate-100"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          teamSectionCollapsed ? "-rotate-90" : "",
                        )}
                      />
                    </button>
                  </div>
                </div>

                {teamSectionCollapsed ? null : subagentParentContext ? (
                  <div className="mt-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        void onReturnToParentSession?.();
                      }}
                      disabled={!onReturnToParentSession}
                      className={cn(
                        "w-full rounded-[20px] border border-slate-200/80 bg-white/88 px-3.5 py-3 text-left shadow-sm shadow-slate-950/5 transition dark:border-white/10 dark:bg-white/5",
                        onReturnToParentSession
                          ? "hover:border-slate-300 hover:bg-white dark:hover:bg-white/10"
                          : "cursor-default",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-200">
                          <ArrowUpLeft className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {subagentParentContext.parent_session_name}
                            </div>
                            <Badge className="border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/10 dark:text-slate-200">
                              父会话
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">
                            返回主线程，查看完整 team 视图和原始上下文。
                          </p>
                        </div>
                      </div>
                    </button>

                    <div className="rounded-[20px] border border-slate-200/80 bg-white/86 px-3.5 py-3 shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/5">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {resolveSidebarDisplayTitle(
                            currentTaskItem?.title,
                            "当前子代理",
                          )}
                        </div>
                        <Badge className="border border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900">
                          当前子代理
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>来自父会话委派</span>
                        {subagentParentContext.role_hint ? (
                          <span>角色 · {subagentParentContext.role_hint}</span>
                        ) : null}
                        {currentTaskItem?.updatedAt ? (
                          <span>
                            更新于 {formatRelativeTime(currentTaskItem.updatedAt)}
                          </span>
                        ) : null}
                      </div>
                      {subagentParentContext.task_summary ? (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
                          {subagentParentContext.task_summary}
                        </p>
                      ) : null}
                    </div>

                    {visibleSiblingSubagentSessions.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">
                            同级子代理
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {siblingSubagentSessions.length} 个
                          </div>
                        </div>
                        {visibleSiblingSubagentSessions.map((session) =>
                          renderSubagentSessionCard(session),
                        )}
                        {hiddenSiblingSubagentCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => setShowAllSiblingSubagents(true)}
                            className="w-full rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
                          >
                            展开剩余 {hiddenSiblingSubagentCount} 个同级子代理
                          </button>
                        ) : null}
                        {showAllSiblingSubagents &&
                        siblingSubagentSessions.length >
                          TEAM_SECTION_INITIAL_SIBLING_COUNT ? (
                          <button
                            type="button"
                            onClick={() => setShowAllSiblingSubagents(false)}
                            className="w-full rounded-2xl border border-slate-200/80 bg-white/78 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
                          >
                            收起同级子代理列表
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {visibleChildSubagentSessions.map((session) =>
                      renderSubagentSessionCard(session, {
                        highlightCurrent: session.id === currentTopicId,
                      }),
                    )}
                    {hiddenChildSubagentCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllChildSubagents(true)}
                        className="w-full rounded-2xl border border-dashed border-slate-200/80 bg-white/70 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
                      >
                        展开剩余 {hiddenChildSubagentCount} 个子代理
                      </button>
                    ) : null}
                    {showAllChildSubagents &&
                    sortedChildSubagentSessions.length >
                      TEAM_SECTION_INITIAL_CHILD_COUNT ? (
                      <button
                        type="button"
                        onClick={() => setShowAllChildSubagents(false)}
                        className="w-full rounded-2xl border border-slate-200/80 bg-white/78 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-slate-100"
                      >
                        收起子代理列表
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            ) : null}

            <div
              ref={taskSectionAnchorRef}
              className="px-1"
              data-testid="task-section-heading"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">
                    {taskHeadingLabel}
                  </div>
                  {taskHeadingHint ? (
                    <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                      {taskHeadingHint}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0 pt-0.5 text-xs text-slate-400">
                  {searchKeyword.trim()
                    ? `${filteredTaskItems.length} 个结果`
                    : `${topics.length} 个任务`}
                </div>
              </div>
            </div>

            {!hasAnyTasks ? (
              <div className="rounded-[26px] border border-dashed border-slate-200/90 bg-white/82 px-4 py-8 text-center shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/5">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                  <Clock3 className="h-5 w-5" />
                </div>
                <div className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {emptyStateTitle}
                </div>
                <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">
                  {emptyStateDescription}
                </p>
              </div>
            ) : !hasFilteredResults ? (
              <div className="rounded-[26px] border border-dashed border-slate-200/90 bg-white/82 px-4 py-8 text-center shadow-sm shadow-slate-950/5 dark:border-white/10 dark:bg-white/5">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  没有匹配的任务
                </div>
                <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">
                  试试搜索标题、执行摘要或状态关键词。
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sections.map((section) => {
                const isOlderSection = section.key === "older";
                const isSectionCollapsed = collapsedSections[section.key];
                const visibleItems =
                  isOlderSection && !showAllOlder
                    ? section.items.slice(0, OLDER_TASKS_INITIAL_COUNT)
                    : section.items;

                if (section.items.length === 0) {
                  return null;
                }

                return (
                  <section key={section.key} className="space-y-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedSections((prev) => ({
                          ...prev,
                          [section.key]: !prev[section.key],
                        }))
                      }
                      className="flex w-full items-center justify-between rounded-2xl px-2.5 py-2 text-left transition hover:bg-white/78 dark:hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-slate-400 transition-transform",
                            isSectionCollapsed ? "-rotate-90" : "",
                          )}
                        />
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {section.title}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {section.items.length}
                      </span>
                    </button>

                    {isSectionCollapsed ? null : (
                      <div className="space-y-2">
                        {visibleItems.map((item) => {
                          const statusMeta = STATUS_META[item.status];
                          const isResumableItem =
                            item.status === "waiting" ||
                            (item.status === "failed" &&
                              item.statusReason === "workspace_error");

                          return (
                            <div
                              key={item.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (editingTopicId !== item.id) {
                                  onSwitchTopic(item.id);
                                }
                              }}
                              onDoubleClick={() =>
                                handleStartEdit(item.id, item.title)
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  if (editingTopicId !== item.id) {
                                    onSwitchTopic(item.id);
                                  }
                                }
                              }}
                              className={cn(
                                "group rounded-[22px] border p-3.5 text-left shadow-sm shadow-slate-950/5 transition",
                                isResumableItem
                                  ? "border-amber-200/80 bg-[linear-gradient(180deg,rgba(255,251,235,0.9)_0%,rgba(255,255,255,0.96)_100%)] shadow-sm shadow-amber-950/5 dark:border-amber-500/20 dark:bg-white/10"
                                  : "",
                                item.isCurrent
                                  ? "border-slate-300 bg-white/98 ring-1 ring-slate-100 dark:border-white/15 dark:bg-white/10"
                                  : "border-slate-200/70 bg-white/72 hover:border-slate-300 hover:bg-white/92 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/10 dark:hover:bg-white/5",
                              )}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={cn(
                                    "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                                    statusMeta.dotClassName,
                                  )}
                                />

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start gap-2">
                                    {editingTopicId === item.id ? (
                                      <input
                                        ref={editInputRef}
                                        type="text"
                                        value={editTitle}
                                        onChange={(event) =>
                                          setEditTitle(event.target.value)
                                        }
                                        onKeyDown={handleEditKeyDown}
                                        onBlur={handleSaveEdit}
                                        onClick={(event) =>
                                          event.stopPropagation()
                                        }
                                        className="h-8 flex-1 rounded-xl border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-400 dark:border-white/10 dark:bg-[#17191f] dark:text-slate-100"
                                      />
                                    ) : (
                                      <>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-1.5">
                                            <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                              {item.title || "未命名任务"}
                                            </div>
                                            {item.isPinned ? (
                                              <Pin className="h-3.5 w-3.5 text-slate-400" />
                                            ) : null}
                                            {item.hasUnread ? (
                                              <span className="h-2 w-2 rounded-full bg-sky-500" />
                                            ) : null}
                                          </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                                          <div className="text-[11px] text-slate-400">
                                            {formatRelativeTime(item.updatedAt)}
                                          </div>
                                          <button
                                            type="button"
                                            aria-label="删除任务"
                                            title="删除任务"
                                            className={cn(
                                              "inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300",
                                              item.isCurrent
                                                ? "opacity-100"
                                                : "opacity-0 group-hover:opacity-100",
                                            )}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              handleDeleteClick(item.id);
                                            }}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <button
                                                type="button"
                                                aria-label="任务操作"
                                                className={cn(
                                                  "inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-100",
                                                  item.isCurrent
                                                    ? "opacity-100"
                                                    : "opacity-0 group-hover:opacity-100",
                                                )}
                                                onClick={(event) =>
                                                  event.stopPropagation()
                                                }
                                              >
                                                <MoreHorizontal className="h-4 w-4" />
                                              </button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  handleStartEdit(item.id, item.title)
                                                }
                                              >
                                                <PencilLine className="h-4 w-4" />
                                                重命名任务
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  handleTogglePinned(item.id)
                                                }
                                              >
                                                {item.isPinned ? (
                                                  <PinOff className="h-4 w-4" />
                                                ) : (
                                                  <Pin className="h-4 w-4" />
                                                )}
                                                {item.isPinned ? "取消固定" : "固定任务"}
                                              </DropdownMenuItem>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem
                                                className="text-rose-600"
                                                onClick={() =>
                                                  handleDeleteClick(item.id)
                                                }
                                              >
                                                <Trash2 className="h-4 w-4" />
                                                删除任务
                                              </DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        </div>
                                      </>
                                    )}
                                  </div>

                                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                    {item.lastPreview}
                                  </div>

                                  <div className="mt-3 flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "px-2.5 py-1 text-[11px] font-medium",
                                        statusMeta.badgeClassName,
                                      )}
                                    >
                                      {item.status === "running" ? (
                                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                      ) : null}
                                      {item.statusLabel}
                                    </Badge>
                                    <span className="text-[11px] text-slate-400">
                                      {item.messagesCount > 0
                                        ? `${item.messagesCount} 条消息`
                                        : "尚未开始执行"}
                                    </span>
                                    {isResumableItem && onResumeTask ? (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleResumeTask(item);
                                        }}
                                        className="inline-flex items-center rounded-full border border-amber-200/80 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/15"
                                      >
                                        继续任务
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {isOlderSection &&
                        section.items.length > OLDER_TASKS_INITIAL_COUNT &&
                        !showAllOlder ? (
                          <button
                            type="button"
                            onClick={() => setShowAllOlder(true)}
                            className="w-full rounded-2xl border border-dashed border-slate-200 bg-white/75 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-slate-300 hover:text-slate-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 dark:hover:text-white"
                          >
                            {olderSectionMoreLabel}
                          </button>
                        ) : null}
                      </div>
                    )}
                  </section>
                );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
