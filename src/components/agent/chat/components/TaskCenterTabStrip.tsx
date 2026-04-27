import {
  Box,
  MessageSquareText,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  X,
} from "lucide-react";
import type { TaskStatus } from "../hooks/agentChatShared";
import { cn } from "@/lib/utils";
import {
  TASK_CENTER_CHROME_ACTIVE_TAB,
  TASK_CENTER_CHROME_SURFACE,
} from "../workspace/taskCenterChromeTokens";

const TASK_CENTER_TAB_STATUS_META: Record<
  TaskStatus,
  { label: string; iconClassName: string }
> = {
  draft: {
    label: "待补充",
    iconClassName: "text-slate-500",
  },
  running: {
    label: "进行中",
    iconClassName: "text-sky-500",
  },
  waiting: {
    label: "待继续",
    iconClassName: "text-amber-500",
  },
  done: {
    label: "已完成",
    iconClassName: "text-emerald-500",
  },
  failed: {
    label: "有异常",
    iconClassName: "text-rose-500",
  },
};

export interface TaskCenterTabItem {
  id: string;
  title: string;
  status: TaskStatus;
  updatedAt: Date;
  isActive: boolean;
  hasUnread: boolean;
  isPinned: boolean;
}

interface TaskCenterTabStripProps {
  items: TaskCenterTabItem[];
  onSelectTask: (taskId: string) => void | Promise<void>;
  onCloseTask: (taskId: string) => void | Promise<void>;
  onCreateTask: () => void;
  showHistoryToggle?: boolean;
  onToggleHistory?: () => void;
  showCanvasToggle?: boolean;
  isCanvasOpen?: boolean;
  onToggleCanvas?: () => void;
}

function formatTaskTabTitle(item: TaskCenterTabItem): string {
  const statusMeta =
    TASK_CENTER_TAB_STATUS_META[item.status] ?? TASK_CENTER_TAB_STATUS_META.done;
  return `${item.title} · ${statusMeta.label} · 更新于 ${item.updatedAt.toLocaleString(
    "zh-CN",
  )}`;
}

const conversationTabShellClassName =
  "group flex h-[26px] items-center gap-0 rounded-[13px] border border-transparent px-1 transition-[background-color,border-color,box-shadow,color] duration-150 ease-out";

const activeConversationTabClassName =
  "border-slate-200/80 text-slate-950 shadow-[0_4px_12px_-9px_rgba(15,23,42,0.32),inset_0_1px_0_rgba(255,255,255,0.9)] dark:bg-slate-700 dark:text-slate-100";

const inactiveConversationTabClassName =
  "bg-transparent text-slate-500 hover:bg-white/58 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

const conversationTabButtonClassName =
  "flex h-full min-w-0 items-center gap-1 rounded-[12px] px-1.5 text-left";

const tabUtilityButtonClassName =
  "inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[13px] bg-transparent text-slate-500 transition-colors hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200";

const tabWorkbenchButtonClassName =
  "inline-flex h-[26px] shrink-0 items-center gap-1 rounded-[13px] border border-transparent px-2 text-[11px] font-medium text-slate-600 transition-[background-color,border-color,box-shadow,color] hover:bg-white/60 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-100";

export function TaskCenterTabStrip({
  items,
  onSelectTask,
  onCloseTask,
  onCreateTask,
  showHistoryToggle = false,
  onToggleHistory,
  showCanvasToggle = false,
  isCanvasOpen = false,
  onToggleCanvas,
}: TaskCenterTabStripProps) {
  const showToolbarActions = showHistoryToggle || showCanvasToggle;

  return (
    <section
      className="relative z-10 -mt-px min-h-[34px] shrink-0 border-b border-slate-200/60 px-5 pb-1.5 pt-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)]"
      data-testid="task-center-tab-strip"
      style={{ backgroundColor: TASK_CENTER_CHROME_SURFACE }}
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div className="flex min-w-max items-center gap-1">
            {items.map((item) => {
              const statusMeta =
                TASK_CENTER_TAB_STATUS_META[item.status] ??
                TASK_CENTER_TAB_STATUS_META.done;

              return (
                <div
                  key={item.id}
                  className={cn(
                    conversationTabShellClassName,
                    item.isActive
                      ? activeConversationTabClassName
                      : inactiveConversationTabClassName,
                  )}
                  data-testid={`task-center-tab-${item.id}`}
                  data-active={item.isActive ? "true" : "false"}
                  style={
                    item.isActive
                      ? { backgroundColor: TASK_CENTER_CHROME_ACTIVE_TAB }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className={conversationTabButtonClassName}
                    aria-current={item.isActive ? "page" : undefined}
                    title={formatTaskTabTitle(item)}
                    onClick={() => {
                      void onSelectTask(item.id);
                    }}
                  >
                    <MessageSquareText
                      className={cn("h-3.5 w-3.5 shrink-0", statusMeta.iconClassName)}
                      aria-hidden="true"
                    />
                    <span className="truncate text-[11px] font-semibold">
                      {item.title}
                    </span>
                    {item.hasUnread ? (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-sky-500"
                        data-testid={`task-center-tab-unread-${item.id}`}
                        aria-hidden="true"
                      />
                    ) : null}
                    {item.isPinned ? (
                      <Pin
                        className="h-2.5 w-2.5 shrink-0 text-slate-400"
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "mr-1 rounded-full p-1 text-slate-400 transition hover:bg-black/5 hover:text-slate-800 focus-visible:text-slate-800 dark:hover:bg-white/10 dark:hover:text-slate-200",
                      item.isActive
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    )}
                    aria-label={`关闭 ${item.title}`}
                    data-testid={`task-center-tab-close-${item.id}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onCloseTask(item.id);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className={cn(tabUtilityButtonClassName, "ml-0.5")}
              data-testid="task-center-tab-create-button"
              aria-label="新建对话"
              title="新建对话"
              onClick={onCreateTask}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {showToolbarActions ? (
          <div
            className="flex shrink-0 items-center gap-1 border-l border-slate-200/80 pl-1.5 dark:border-slate-700/80"
            data-testid="task-center-tab-toolbar"
          >
            {showHistoryToggle ? (
              <button
                type="button"
                className={tabUtilityButtonClassName}
                data-testid="task-center-tab-history"
                aria-label="切换历史"
                title="切换历史"
                onClick={onToggleHistory}
              >
                <Box className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {showCanvasToggle ? (
              <button
                type="button"
                className={cn(
                  tabWorkbenchButtonClassName,
                  isCanvasOpen &&
                  "border-slate-200/70 bg-white text-slate-900 shadow-[0_2px_8px_-6px_rgba(15,23,42,0.26),inset_0_1px_0_rgba(255,255,255,0.94)] dark:bg-slate-700 dark:text-slate-100",
                )}
                data-testid="task-center-tab-workbench"
                aria-label={isCanvasOpen ? "收起工作台" : "展开工作台"}
                title={isCanvasOpen ? "收起工作台" : "展开工作台"}
                onClick={onToggleCanvas}
              >
                {isCanvasOpen ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                <span>工作台</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
