import {
  AlertCircle,
  Bot,
  Bell,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ScheduledTaskSummary } from "@/lib/api/scheduledTasks";
import {
  describeScheduledTaskSchedule,
  scheduledTaskPresentationCopy,
  scheduledTaskStatusLabel,
} from "./scheduledTaskPresentation";
import type { ScheduledTaskFilter } from "./scheduledTaskViewModel";

interface ScheduledTaskListProps {
  tasks: ScheduledTaskSummary[];
  selectedId: string | null;
  query: string;
  filter: ScheduledTaskFilter;
  locale: string;
  loading: boolean;
  t: TFunction<"workspace">;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: ScheduledTaskFilter) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateWithLime: () => void;
}

const FILTERS: ScheduledTaskFilter[] = ["all", "enabled", "paused"];

export function ScheduledTaskList({
  tasks,
  selectedId,
  query,
  filter,
  locale,
  loading,
  t,
  onQueryChange,
  onFilterChange,
  onSelect,
  onCreate,
  onCreateWithLime,
}: ScheduledTaskListProps) {
  const copy = scheduledTaskPresentationCopy(t);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const newTaskLabel = t("scheduledTasks.sidebar.newTask", "新建任务");
  const immediateLabel = t("scheduledTasks.sidebar.immediate", "即时执行");
  return (
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-slate-200 bg-white md:w-[240px] md:border-b-0 md:border-r">
      <div className="border-b border-slate-200 px-3 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex min-w-0 items-center gap-1 truncate text-[15px] font-semibold text-slate-900">
            <span className="truncate">{t("scheduledTasks.title")}</span>
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={t("navigation.sidebar.notifications", "通知")}
              title={t("navigation.sidebar.notifications", "通知")}
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-sky-500" />
            </button>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={t("scheduledTasks.search.aria")}
              title={t("scheduledTasks.search.aria")}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((value) => !value)}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mt-3 flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
              aria-label={newTaskLabel}
            >
              <Plus className="h-3.5 w-3.5 text-slate-500" />
              <span>{newTaskLabel}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 bg-white">
            <DropdownMenuItem onClick={onCreateWithLime}>
              <Bot className="h-4 w-4" />
              {t("scheduledTasks.action.createWithLime")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onCreate}>
              <PenLine className="h-4 w-4" />
              {t("scheduledTasks.action.manual")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="mt-3 flex h-7 w-full items-center justify-between rounded-md px-1 text-left text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label={t("scheduledTasks.filter.aria")}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((value) => !value)}
        >
          <span>{immediateLabel}</span>
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        {searchOpen ? (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("scheduledTasks.search.placeholder")}
              aria-label={t("scheduledTasks.search.aria")}
              className="h-8 border-slate-200 bg-slate-50 pl-8 pr-8 text-xs focus-visible:bg-white"
            />
            {query ? (
              <button
                type="button"
                className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200"
                aria-label={t("scheduledTasks.search.clear")}
                title={t("scheduledTasks.search.clear")}
                onClick={() => onQueryChange("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}
        {filterOpen ? (
          <div
            className="mt-2 grid grid-cols-3 gap-1 rounded-md bg-slate-50 p-1"
            role="group"
            aria-label={t("scheduledTasks.filter.aria")}
          >
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "h-7 rounded px-1 text-[11px] font-medium text-slate-600 transition-colors",
                  filter === value && "bg-white text-slate-950 shadow-sm",
                )}
                aria-pressed={filter === value}
                onClick={() => onFilterChange(value)}
              >
                {t(`scheduledTasks.filter.${value}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-2" aria-label={t("scheduledTasks.loading")}>
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-20 animate-pulse rounded-md bg-slate-100" />
            ))}
          </div>
        ) : tasks.length ? (
          <div className="space-y-1">
            {tasks.map((task) => {
              const selected = task.id === selectedId;
              const status = scheduledTaskStatusLabel(
                task.lastRun,
                task.enabled,
                task.attention,
                copy,
              );
              return (
                <button
                  key={task.id}
                  type="button"
                  className={cn(
                    "w-full rounded-md border border-transparent px-3 py-3 text-left transition-colors hover:bg-slate-50",
                    selected && "border-emerald-200 bg-emerald-50",
                  )}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(task.id)}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300",
                        task.enabled && !task.attention && "bg-emerald-500",
                        task.attention && "bg-amber-500",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900" title={task.title}>
                          {task.title}
                        </span>
                        {task.attention ? (
                          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                        ) : null}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {describeScheduledTaskSchedule(task.schedule, copy, locale)}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-slate-600">
                        {status}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-40 flex-col items-start justify-center px-3 text-left">
            <p className="text-xs font-medium text-slate-400">
              {query || filter !== "all"
                ? t("scheduledTasks.empty.filtered.title")
                : t("scheduledTasks.sidebar.empty")}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              {query || filter !== "all"
                ? t("scheduledTasks.empty.filtered.description")
                : null}
            </p>
            {query || filter !== "all" ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  onQueryChange("");
                  onFilterChange("all");
                }}
              >
                {t("scheduledTasks.action.clearFilters")}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
