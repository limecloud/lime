import { type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type GeneralWorkbenchSidebarTab = "context" | "workflow" | "log";

interface GeneralWorkbenchSidebarShellProps {
  activeTab: GeneralWorkbenchSidebarTab;
  isVersionMode: boolean;
  activeContextCount: number;
  workflowCount: number;
  visibleExecLogCount: number;
  onTabChange: (tab: GeneralWorkbenchSidebarTab) => void;
  onRequestCollapse?: () => void;
  headerActionSlot?: ReactNode;
  topSlot?: ReactNode;
  children: ReactNode;
}

const SIDEBAR_CONTAINER_CLASSNAME =
  "relative flex h-full w-[290px] min-w-[290px] flex-col border-r border-slate-200 bg-slate-50";

const SIDEBAR_COLLAPSE_HANDLE_CLASSNAME =
  "absolute right-[-10px] top-1/2 z-[2] inline-flex h-[60px] w-4 -translate-y-1/2 items-center justify-center rounded-r-[10px] border border-l-0 border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900";

const SIDEBAR_HEADER_CLASSNAME =
  "border-b border-slate-200 bg-white px-4 py-4";

const SIDEBAR_HEADER_META_ROW_CLASSNAME =
  "flex items-center justify-between gap-2.5";

const SIDEBAR_HEADER_ACTION_SLOT_CLASSNAME =
  "mt-[-2px] inline-flex shrink-0 items-center justify-center";

const SIDEBAR_EYEBROW_CLASSNAME =
  "text-[10px] font-semibold text-slate-500";

const SIDEBAR_TITLE_CLASSNAME =
  "mt-2.5 text-base font-semibold leading-6 text-slate-900";

const SIDEBAR_DESCRIPTION_CLASSNAME =
  "mt-1.5 text-[12px] leading-5 text-slate-500";

const SIDEBAR_TABS_CLASSNAME =
  "mt-3 flex gap-1.5 rounded-[18px] border border-slate-200 bg-slate-100 p-1";

const SIDEBAR_TAB_LABEL_CLASSNAME = "min-w-0 truncate";

const SIDEBAR_BODY_CLASSNAME =
  "custom-scrollbar flex-1 overflow-y-auto overflow-x-visible";

const SIDEBAR_TOP_SLOT_CLASSNAME = "flex flex-col gap-2 px-3 pt-3";

function getSidebarTabButtonClassName(active: boolean) {
  return cn(
    "flex h-[38px] min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-semibold leading-none transition-colors",
    active
      ? "border-slate-300 bg-white text-slate-900 shadow-sm shadow-slate-950/5"
      : "border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-900",
  );
}

function getSidebarTabCountClassName(active: boolean) {
  return cn(
    "inline-flex min-h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none",
    active
      ? "border border-emerald-200 bg-white/90 text-emerald-700 shadow-sm shadow-emerald-950/10"
      : "bg-slate-200 text-slate-500",
  );
}

function resolveSidebarTitle(
  activeTab: GeneralWorkbenchSidebarTab,
  isVersionMode: boolean,
): string {
  if (activeTab === "context") {
    return "上下文管理";
  }
  if (activeTab === "workflow") {
    return "任务视图";
  }
  return isVersionMode ? "版本记录" : "运行记录";
}

function resolveSidebarDescription(
  activeTab: GeneralWorkbenchSidebarTab,
  isVersionMode: boolean,
): string {
  if (activeTab === "context") {
    return "检索、筛选并启用当前创作真正会用到的上下文。";
  }
  if (activeTab === "workflow") {
    return isVersionMode
      ? "聚焦当前任务、后续节点与相关版本。"
      : "聚焦当前任务、后续节点与相关分支。";
  }
  return "查看技能调用、工具输出与运行记录。";
}

export function GeneralWorkbenchSidebarShell({
  activeTab,
  isVersionMode,
  activeContextCount,
  workflowCount,
  visibleExecLogCount,
  onTabChange,
  onRequestCollapse,
  headerActionSlot,
  topSlot,
  children,
}: GeneralWorkbenchSidebarShellProps) {
  return (
    <div
      className={SIDEBAR_CONTAINER_CLASSNAME}
      data-testid="general-workbench-sidebar"
    >
      <div
        className={SIDEBAR_HEADER_CLASSNAME}
        data-testid="general-workbench-sidebar-header"
      >
        <div className={SIDEBAR_HEADER_META_ROW_CLASSNAME}>
          <div className={SIDEBAR_EYEBROW_CLASSNAME}>任务工作台</div>
          {headerActionSlot ? (
            <div
              className={SIDEBAR_HEADER_ACTION_SLOT_CLASSNAME}
              data-testid="general-workbench-sidebar-header-action"
            >
              {headerActionSlot}
            </div>
          ) : null}
        </div>
        <div className={SIDEBAR_TITLE_CLASSNAME}>
          {resolveSidebarTitle(activeTab, isVersionMode)}
        </div>
        <div className={SIDEBAR_DESCRIPTION_CLASSNAME}>
          {resolveSidebarDescription(activeTab, isVersionMode)}
        </div>
        <div
          className={SIDEBAR_TABS_CLASSNAME}
          data-testid="general-workbench-sidebar-tabs"
        >
          <button
            type="button"
            aria-label="打开上下文管理"
            title="上下文管理"
            className={getSidebarTabButtonClassName(activeTab === "context")}
            onClick={() => onTabChange("context")}
          >
            <span className={SIDEBAR_TAB_LABEL_CLASSNAME}>上下文</span>
            <span
              className={getSidebarTabCountClassName(activeTab === "context")}
            >
              {activeContextCount}
            </span>
          </button>
          <button
            type="button"
            aria-label="打开任务视图"
            title="任务视图"
            className={getSidebarTabButtonClassName(activeTab === "workflow")}
            onClick={() => onTabChange("workflow")}
          >
            <span className={SIDEBAR_TAB_LABEL_CLASSNAME}>任务</span>
            <span
              className={getSidebarTabCountClassName(activeTab === "workflow")}
            >
              {workflowCount}
            </span>
          </button>
          <button
            type="button"
            aria-label="打开执行日志"
            title="执行日志"
            className={getSidebarTabButtonClassName(activeTab === "log")}
            onClick={() => onTabChange("log")}
          >
            <span className={SIDEBAR_TAB_LABEL_CLASSNAME}>日志</span>
            <span className={getSidebarTabCountClassName(activeTab === "log")}>
              {visibleExecLogCount}
            </span>
          </button>
        </div>
      </div>
      {onRequestCollapse ? (
        <button
          type="button"
          aria-label="折叠上下文侧栏"
          className={SIDEBAR_COLLAPSE_HANDLE_CLASSNAME}
          onClick={onRequestCollapse}
        >
          <ChevronLeft size={13} />
        </button>
      ) : null}
      <div className={SIDEBAR_BODY_CLASSNAME}>
        {topSlot ? (
          <div
            className={SIDEBAR_TOP_SLOT_CLASSNAME}
            data-testid="general-workbench-sidebar-top-slot"
          >
            {topSlot}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
