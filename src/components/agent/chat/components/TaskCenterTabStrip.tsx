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
  "group flex h-8 items-center gap-0.5 rounded-[14px] border px-0.5 transition-[border-color,background-color,box-shadow,color]";

const activeConversationTabClassName =
  "border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_100%)] shadow-[0_8px_20px_-24px_rgba(15,23,42,0.18)]";

const inactiveConversationTabClassName =
  "border-transparent bg-transparent hover:bg-slate-50/90";

const conversationTabButtonClassName =
  "flex min-w-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-left";

const tabUtilityButtonClassName =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-transparent text-slate-500 shadow-none transition-[background-color,color] hover:bg-slate-100 hover:text-slate-900";

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
      className="mx-2 mb-0.5 shrink-0"
      data-testid="task-center-tab-strip"
    >
      <div className="flex items-center gap-1.5 rounded-b-[18px] border border-t-0 border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_66%,rgba(240,249,255,0.86)_100%)] px-2 pb-1 pt-1">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          <div className="flex min-w-max items-center gap-0.5 pr-1.5">
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
                    <span className="truncate text-[11px] font-medium text-slate-800">
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
                      "mr-0.5 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:text-slate-700",
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
                    <X className="h-3 w-3" />
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
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showToolbarActions ? (
          <div
            className="flex shrink-0 items-center gap-0.5 border-l border-slate-200/80 pl-1"
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
                <Box className="h-4 w-4" />
              </button>
            ) : null}
            {showCanvasToggle ? (
              <button
                type="button"
                className={tabUtilityButtonClassName}
                data-testid="task-center-tab-canvas"
                aria-label={isCanvasOpen ? "折叠画布" : "展开画布"}
                title={isCanvasOpen ? "折叠画布" : "展开画布"}
                onClick={onToggleCanvas}
              >
                {isCanvasOpen ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRightOpen className="h-4 w-4" />
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
