import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Globe,
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
import {
  deriveTaskLiveState,
  extractTaskPreviewFromMessages,
  type Topic,
  type TaskStatus,
  type TaskStatusReason,
} from "../hooks/agentChatShared";
import type { Message } from "../types";

const RECENT_TASK_WINDOW_MS = 1000 * 60 * 60 * 24 * 3;
const OLDER_TASKS_INITIAL_COUNT = 8;
const PINNED_TASK_IDS_STORAGE_KEY = "proxycast_task_sidebar_pinned_ids";

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
  | "resumable"
  | "waiting"
  | "recent"
  | "older";

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
}

function isResumableStatusReason(statusReason?: TaskStatusReason) {
  return (
    statusReason === "browser_launching" ||
    statusReason === "browser_awaiting_user" ||
    statusReason === "browser_failed"
  );
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
  if (status === "waiting" && statusReason === "browser_launching") {
    return "正在建立浏览器会话，请稍候。";
  }
  if (status === "waiting" && statusReason === "browser_awaiting_user") {
    return fallbackPreview || "请先在浏览器完成登录或授权后继续。";
  }
  if (status === "waiting" && statusReason === "browser_failed") {
    return fallbackPreview || "浏览器/CDP 还未连接，请重试启动后继续。";
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
  if (status === "waiting" && statusReason === "browser_launching") {
    return "连接浏览器";
  }

  if (status === "waiting" && statusReason === "browser_awaiting_user") {
    return "待继续";
  }

  if (status === "waiting" && statusReason === "browser_failed") {
    return "浏览器未就绪";
  }

  if (status === "failed" && statusReason === "workspace_error") {
    return "工作区异常";
  }

  return STATUS_META[status].label;
}

function resolveResumableActionLabel(
  statusReason?: TaskStatusReason,
  isCurrent = false,
): string {
  if (!isCurrent) {
    return "进入任务";
  }

  switch (statusReason) {
    case "browser_launching":
      return "查看浏览器";
    case "browser_awaiting_user":
      return "打开浏览器";
    case "browser_failed":
      return "重试浏览器";
    default:
      return "继续处理";
  }
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

function buildTaskSections(items: TaskCardViewModel[]) {
  const now = Date.now();
  const running: TaskCardViewModel[] = [];
  const resumable: TaskCardViewModel[] = [];
  const waiting: TaskCardViewModel[] = [];
  const recent: TaskCardViewModel[] = [];
  const older: TaskCardViewModel[] = [];

  for (const item of items) {
    if (item.status === "running") {
      running.push(item);
      continue;
    }

    if (
      item.status === "waiting" &&
      isResumableStatusReason(item.statusReason)
    ) {
      resumable.push(item);
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

  return [
    { key: "running", title: "进行中", items: sortTaskItems(running) },
    { key: "resumable", title: "待继续", items: sortTaskItems(resumable) },
    { key: "waiting", title: "待处理", items: sortTaskItems(waiting) },
    { key: "recent", title: "最近完成", items: sortTaskItems(recent) },
    { key: "older", title: "更早任务", items: sortTaskItems(older) },
  ] satisfies TaskSection[];
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
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
}) => {
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "resumable"
  >("all");
  const [showAllOlder, setShowAllOlder] = useState(false);
  const [pinnedTaskIds, setPinnedTaskIds] = useState<string[]>(() =>
    loadPinnedTaskIds(),
  );
  const [collapsedSections, setCollapsedSections] = useState<
    Record<TaskSectionKey, boolean>
  >({
    running: false,
    resumable: false,
    waiting: false,
    recent: false,
    older: false,
  });
  const editInputRef = useRef<HTMLInputElement>(null);

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
        title: topic.title || "未命名任务",
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

  const filteredTaskItems = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return taskItems.filter((item) => {
      if (
        statusFilter === "resumable" &&
        !(
          item.status === "waiting" &&
          isResumableStatusReason(item.statusReason)
        )
      ) {
        return false;
      }

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
    () => buildTaskSections(filteredTaskItems),
    [filteredTaskItems],
  );
  const resumableTaskCount = useMemo(
    () =>
      taskItems.filter(
        (item) =>
          item.status === "waiting" &&
          isResumableStatusReason(item.statusReason),
      ).length,
    [taskItems],
  );
  const resumableItems = useMemo(
    () =>
      filteredTaskItems.filter(
        (item) =>
          item.status === "waiting" &&
          isResumableStatusReason(item.statusReason),
      ),
    [filteredTaskItems],
  );
  const primaryResumableItem = useMemo(() => {
    if (resumableItems.length === 0) {
      return null;
    }

    return resumableItems.find((item) => item.isCurrent) || resumableItems[0];
  }, [resumableItems]);

  const hasAnyTasks = topics.length > 0;
  const hasFilteredResults = filteredTaskItems.length > 0;

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

  return (
    <aside
      className="w-[296px] shrink-0 border-r border-slate-200/80 bg-slate-50/88 backdrop-blur dark:border-white/10 dark:bg-[#111318]"
      data-testid="chat-sidebar"
    >
      <div className="flex h-full min-h-0 flex-col gap-4 p-3">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder="搜索任务标题或摘要"
              className="h-10 w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
          >
            <Plus className="h-4 w-4" />
            新建任务
          </button>

          {primaryResumableItem ? (
            <div className="rounded-[22px] border border-amber-200/80 bg-amber-50/85 px-3.5 py-3 shadow-sm shadow-amber-950/5 dark:border-amber-500/20 dark:bg-amber-500/10">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      {primaryResumableItem.isCurrent
                        ? "当前任务待继续"
                        : `有 ${resumableItems.length} 个任务待继续`}
                    </div>
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-white/10 dark:text-amber-200">
                      {primaryResumableItem.statusLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-amber-800/90 dark:text-amber-200/90">
                    {primaryResumableItem.isCurrent
                      ? "当前任务卡在浏览器环节，先恢复浏览器会话再继续执行后续动作。"
                      : `优先恢复“${primaryResumableItem.title}”，避免关键浏览器步骤继续堆积。`}
                  </p>
                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-amber-800/85 dark:text-amber-200/85">
                    {primaryResumableItem.lastPreview}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 items-center justify-center rounded-xl bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700"
                      onClick={() => handleResumeTask(primaryResumableItem)}
                    >
                      {resolveResumableActionLabel(
                        primaryResumableItem.statusReason,
                        primaryResumableItem.isCurrent,
                      )}
                    </button>
                    {!primaryResumableItem.isCurrent ? (
                      <button
                        type="button"
                        className="inline-flex h-8 items-center justify-center rounded-xl border border-amber-200 bg-white/80 px-3 text-xs font-medium text-amber-800 transition hover:border-amber-300 hover:bg-white dark:border-amber-500/20 dark:bg-white/5 dark:text-amber-200 dark:hover:bg-white/10"
                        onClick={() => {
                          void onSwitchTopic(primaryResumableItem.id);
                        }}
                      >
                        查看任务
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "inline-flex h-9 flex-1 items-center justify-center rounded-xl border text-xs font-medium transition",
                statusFilter === "all"
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
              )}
            >
              全部任务
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={cn(
                "inline-flex h-9 flex-1 items-center justify-center rounded-xl border text-xs font-medium transition",
                statusFilter === "active"
                  ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300",
              )}
            >
              仅看进行中
            </button>
            {resumableTaskCount > 0 ? (
              <button
                type="button"
                onClick={() => setStatusFilter("resumable")}
                className={cn(
                  "inline-flex h-9 items-center justify-center rounded-xl border px-3 text-xs font-medium transition",
                  statusFilter === "resumable"
                    ? "border-amber-500 bg-amber-500 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-slate-900"
                    : "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200",
                )}
              >
                待继续 {resumableTaskCount}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-slate-500">
            任务
          </div>
          <div className="text-xs text-slate-400">
            {searchKeyword.trim()
              ? `${filteredTaskItems.length} 条结果`
              : `${topics.length} 条`}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          {!hasAnyTasks ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-4 py-8 text-center shadow-sm dark:border-white/10 dark:bg-white/5">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                <Clock3 className="h-5 w-5" />
              </div>
              <div className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">
                还没有任务
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-500 dark:text-slate-400">
                从“新建任务”开始输入需求，创建后会出现在这里。
              </p>
            </div>
          ) : !hasFilteredResults ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-4 py-8 text-center shadow-sm dark:border-white/10 dark:bg-white/5">
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
                const isResumableSection = section.key === "resumable";
                const isSectionCollapsed = isResumableSection
                  ? false
                  : collapsedSections[section.key];
                const visibleItems =
                  isOlderSection && !showAllOlder
                    ? section.items.slice(0, OLDER_TASKS_INITIAL_COUNT)
                    : section.items;

                if (section.items.length === 0) {
                  return null;
                }

                return (
                  <section key={section.key} className="space-y-2">
                    {isResumableSection ? (
                      <div className="rounded-[20px] border border-amber-200/80 bg-amber-50/80 px-3 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                              {section.title}
                            </span>
                          </div>
                          <span className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                            {section.items.length}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-5 text-amber-700/90 dark:text-amber-300/90">
                          这些任务需要你先在浏览器完成登录、授权或恢复连接，再继续执行。
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedSections((prev) => ({
                            ...prev,
                            [section.key]: !prev[section.key],
                          }))
                        }
                        className="flex w-full items-center justify-between rounded-xl px-2 py-1 text-left transition hover:bg-white/70 dark:hover:bg-white/5"
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
                    )}

                    {isSectionCollapsed ? null : (
                      <div className="space-y-2">
                        {visibleItems.map((item) => {
                          const statusMeta = STATUS_META[item.status];
                          const isResumableItem = isResumableStatusReason(
                            item.statusReason,
                          );

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
                                "group rounded-[20px] border p-3 text-left transition",
                                isResumableItem
                                  ? "border-amber-200 bg-white shadow-sm shadow-amber-950/5 dark:border-amber-500/20 dark:bg-white/10"
                                  : "",
                                item.isCurrent
                                  ? "border-slate-300 bg-white shadow-sm shadow-slate-950/5 dark:border-white/15 dark:bg-white/10"
                                  : "border-transparent bg-transparent hover:border-slate-200 hover:bg-white/82 dark:hover:border-white/10 dark:hover:bg-white/5",
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
                                        className="h-8 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-400 dark:border-white/10 dark:bg-[#17191f] dark:text-slate-100"
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
                                    {isResumableItem ? (
                                      <button
                                        type="button"
                                        className="ml-auto inline-flex h-7 items-center justify-center rounded-lg bg-amber-600 px-2.5 text-[11px] font-medium text-white transition hover:bg-amber-700"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleResumeTask(item);
                                        }}
                                      >
                                        {resolveResumableActionLabel(
                                          item.statusReason,
                                          item.isCurrent,
                                        )}
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
                            查看更多历史任务
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
    </aside>
  );
};
