import { type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export type GeneralWorkbenchSidebarTab = "context" | "workflow" | "log";

interface GeneralWorkbenchSidebarShellProps {
  activeTab: GeneralWorkbenchSidebarTab;
  isVersionMode: boolean;
  activeContextCount: number;
  branchCount: number;
  visibleExecLogCount: number;
  onTabChange: (tab: GeneralWorkbenchSidebarTab) => void;
  onRequestCollapse?: () => void;
  headerActionSlot?: ReactNode;
  topSlot?: ReactNode;
  children: ReactNode;
}

const SIDEBAR_CONTAINER_CLASSNAME =
  "relative flex h-full w-[290px] min-w-[290px] flex-col border-r border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.96)_0%,rgba(241,245,249,0.84)_100%)]";

const SIDEBAR_COLLAPSE_HANDLE_CLASSNAME =
  "absolute right-[-10px] top-1/2 z-[2] inline-flex h-[60px] w-4 -translate-y-1/2 items-center justify-center rounded-r-[10px] border border-l-0 border-slate-200/80 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900";

const SIDEBAR_HEADER_CLASSNAME =
  "border-b border-slate-200/80 bg-white/88 px-4 py-4 backdrop-blur-sm";

const SIDEBAR_HEADER_META_ROW_CLASSNAME =
  "flex items-center justify-between gap-2.5";

const SIDEBAR_HEADER_ACTION_SLOT_CLASSNAME =
  "mt-[-2px] inline-flex shrink-0 items-center justify-center";

const SIDEBAR_EYEBROW_CLASSNAME =
  "text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500";

const SIDEBAR_TITLE_CLASSNAME =
  "mt-2.5 text-base font-semibold leading-6 text-slate-900";

const SIDEBAR_DESCRIPTION_CLASSNAME =
  "mt-1.5 text-[12px] leading-5 text-slate-500";

const SIDEBAR_TABS_CLASSNAME =
  "mt-3 flex gap-1.5 rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-1";

const SIDEBAR_TAB_LABEL_CLASSNAME = "min-w-0 truncate";

const SIDEBAR_BODY_CLASSNAME =
  "custom-scrollbar flex-1 overflow-y-auto overflow-x-visible";

const SIDEBAR_TOP_SLOT_CLASSNAME = "flex flex-col gap-2 px-3 pt-3";

function getSidebarTabButtonClassName(active: boolean) {
  return cn(
    "flex h-[38px] min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-semibold leading-none transition-colors",
    active
      ? "border-slate-300 bg-white text-slate-900 shadow-sm shadow-slate-950/5"
      : "border-transparent text-slate-500 hover:border-slate-200/90 hover:bg-white/80 hover:text-slate-900",
  );
}

function getSidebarTabCountClassName(active: boolean) {
  return cn(
    "inline-flex min-h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold leading-none",
    active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-500",
  );
}

function resolveSidebarTitle(
  activeTab: GeneralWorkbenchSidebarTab,
  isVersionMode: boolean,
): string {
  if (activeTab === "context") {
    return "上下文管理";
  }
  return isVersionMode ? "编排与版本" : "编排与分支";
}

function resolveSidebarDescription(
  activeTab: GeneralWorkbenchSidebarTab,
): string {
  if (activeTab === "context") {
    return "检索、筛选并启用当前创作真正会用到的上下文。";
  }
  return "跟踪编排进度、产物版本与运行记录。";
}

export function GeneralWorkbenchSidebarShell({
  activeTab,
  isVersionMode,
  activeContextCount,
  branchCount,
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
      <div className={SIDEBAR_HEADER_CLASSNAME}>
        <div className={SIDEBAR_HEADER_META_ROW_CLASSNAME}>
          <div className={SIDEBAR_EYEBROW_CLASSNAME}>工作区编排</div>
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
          {resolveSidebarDescription(activeTab)}
        </div>
        <div className={SIDEBAR_TABS_CLASSNAME}>
          <button
            type="button"
            aria-label="打开上下文管理"
            title="上下文管理"
            className={getSidebarTabButtonClassName(activeTab === "context")}
            onClick={() => onTabChange("context")}
          >
            <span className={SIDEBAR_TAB_LABEL_CLASSNAME}>上下文</span>
            <span className={getSidebarTabCountClassName(activeTab === "context")}>
              {activeContextCount}
            </span>
          </button>
          <button
            type="button"
            aria-label="打开编排面板"
            title="编排面板"
            className={getSidebarTabButtonClassName(activeTab === "workflow")}
            onClick={() => onTabChange("workflow")}
          >
            <span className={SIDEBAR_TAB_LABEL_CLASSNAME}>编排</span>
            <span className={getSidebarTabCountClassName(activeTab === "workflow")}>
              {branchCount}
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
