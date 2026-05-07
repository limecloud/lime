import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SceneAppCatalogCardViewModel } from "@/lib/sceneapp";
import { cn } from "@/lib/utils";
import type {
  SceneAppPatternFilter,
  SceneAppRecentVisitItem,
  SceneAppTypeFilter,
} from "./useSceneAppsPageRuntime";

const TYPE_FILTER_OPTIONS: Array<{
  value: SceneAppTypeFilter;
  label: string;
}> = [
  { value: "all", label: "全部 Skills" },
  { value: "hybrid", label: "整套组合" },
  { value: "browser_grounded", label: "边看边做" },
  { value: "local_durable", label: "持续跟进" },
  { value: "local_instant", label: "快速起手" },
];

const PATTERN_FILTER_OPTIONS: Array<{
  value: SceneAppPatternFilter;
  label: string;
}> = [
  { value: "all", label: "全部特征" },
  { value: "pipeline", label: "分步完成" },
  { value: "generator", label: "直接生成" },
  { value: "reviewer", label: "结果判断" },
  { value: "inversion", label: "照着复刻" },
  { value: "tool_wrapper", label: "带工具辅助" },
];

interface SceneAppsCatalogPanelProps {
  items: SceneAppCatalogCardViewModel[];
  recentItems: SceneAppRecentVisitItem[];
  runtimeLoading?: boolean;
  runtimeError?: string | null;
  searchQuery: string;
  typeFilter: SceneAppTypeFilter;
  patternFilter: SceneAppPatternFilter;
  selectedSceneAppId: string | null;
  onSearchQueryChange: (value: string) => void;
  onTypeFilterChange: (value: SceneAppTypeFilter) => void;
  onPatternFilterChange: (value: SceneAppPatternFilter) => void;
  onResumeRecentVisit: (params: SceneAppRecentVisitItem["params"]) => void;
  onSelectSceneApp: (sceneappId: string) => void;
}

function formatVisitedAt(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FilterPill(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        props.active
          ? "border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] text-slate-800 shadow-sm shadow-emerald-950/10"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
      )}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function SceneAppsCatalogPanel({
  items,
  recentItems,
  runtimeLoading = false,
  runtimeError,
  searchQuery,
  typeFilter,
  patternFilter,
  selectedSceneAppId,
  onSearchQueryChange,
  onTypeFilterChange,
  onPatternFilterChange,
  onResumeRecentVisit,
  onSelectSceneApp,
}: SceneAppsCatalogPanelProps) {
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    typeFilter !== "all" ||
    patternFilter !== "all";
  const toolbarLabelClassName =
    "shrink-0 text-[11px] font-semibold tracking-[0.06em] text-slate-400";
  const STATUS_CLASSNAMES = {
    idle: "border-slate-200 bg-slate-50 text-slate-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    watch: "border-amber-200 bg-amber-50 text-amber-700",
    risk: "border-rose-200 bg-rose-50 text-rose-700",
  } as const;

  return (
    <section data-testid="sceneapps-catalog-directory" className="space-y-4">
      <div className="rounded-[20px] border border-slate-200/80 bg-white p-3.5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                placeholder="搜索 Skill 标题或想要的结果"
                className="h-10 rounded-full border-slate-200 bg-slate-50 pl-9"
                onChange={(event) => onSearchQueryChange(event.target.value)}
              />
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                className="shrink-0 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
                onClick={() => {
                  onSearchQueryChange("");
                  onTypeFilterChange("all");
                  onPatternFilterChange("all");
                }}
              >
                清空筛选
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
              <span className={toolbarLabelClassName}>推进方式</span>
              <div className="flex flex-1 flex-wrap gap-2">
                {TYPE_FILTER_OPTIONS.map((option) => (
                  <FilterPill
                    key={option.value}
                    active={typeFilter === option.value}
                    label={option.label}
                    onClick={() => onTypeFilterChange(option.value)}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
              <span className={toolbarLabelClassName}>特征</span>
              <div className="flex flex-1 flex-wrap gap-2">
                {PATTERN_FILTER_OPTIONS.map((option) => (
                  <FilterPill
                    key={option.value}
                    active={patternFilter === option.value}
                    label={option.label}
                    onClick={() => onPatternFilterChange(option.value)}
                  />
                ))}
              </div>
            </div>

            {recentItems.length > 0 ? (
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <span className={toolbarLabelClassName}>最近看过</span>
                <div className="flex flex-1 flex-wrap gap-2">
                  {recentItems.slice(0, 4).map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      data-testid={
                        index === 0
                          ? "sceneapp-recent-latest-title"
                          : `sceneapp-recent-item-${item.key}`
                      }
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
                      title={`${item.hint} · ${formatVisitedAt(item.visitedAt)}`}
                      onClick={() => onResumeRecentVisit(item.params)}
                    >
                      {item.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {runtimeLoading ? (
        <div className="rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          正在整理最近结果和下一步判断…
        </div>
      ) : null}

      {runtimeError ? (
        <div className="rounded-[20px] border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
          {runtimeError}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="text-sm leading-7 text-slate-500">
          当前筛选条件下还没有匹配的
          Skill。可以先清空关键词，或放宽筛选条件继续找。
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((item) => {
            const isSelected = item.id === selectedSceneAppId;
            const aggregate = item.scorecardAggregate ?? null;
            const aggregateSummary =
              aggregate?.summary ?? item.operatingSummary;
            const secondarySummary =
              aggregateSummary.trim().length > 0 &&
              aggregateSummary.trim() !== item.summary.trim()
                ? aggregateSummary
                : null;
            const primaryActionLabel =
              aggregate?.actionLabel ?? item.scorecardActionLabel ?? item.actionLabel;
            const topFailureSignalLabel =
              aggregate?.topFailureSignalLabel ?? item.topFailureSignalLabel ?? null;
            const primaryDestinationLabel =
              aggregate?.destinations?.[0]?.label ?? null;
            const metaHint =
              item.patternSummary === item.outputHint
                ? item.patternSummary
                : `${item.patternSummary} · ${item.outputHint}`;

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-[20px] border p-3 transition-colors",
                  isSelected
                    ? "border-emerald-200 bg-[image:var(--lime-home-card-surface-strong)] text-slate-800 shadow-sm shadow-emerald-950/10"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <button
                  type="button"
                  data-testid={`sceneapp-page-card-${item.id}`}
                  className="w-full text-left"
                  onClick={() => onSelectSceneApp(item.id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          className={cn(
                            "line-clamp-1 text-base font-semibold",
                            "text-slate-950",
                          )}
                        >
                          {item.title}
                        </div>
                        {isSelected ? (
                          <span className="rounded-full border border-emerald-200 bg-white/90 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-700">
                            当前
                          </span>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "line-clamp-1 text-xs font-medium",
                          isSelected ? "text-slate-600" : "text-slate-500",
                        )}
                      >
                        {item.businessLabel} · {item.deliveryContractLabel}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {primaryActionLabel ? (
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            isSelected
                              ? "border-emerald-200 bg-white/90 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-700",
                          )}
                        >
                          {primaryActionLabel}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          isSelected
                            ? "border-emerald-200 bg-white/90 text-emerald-700"
                            : STATUS_CLASSNAMES[item.status],
                        )}
                      >
                        {item.statusLabel}
                      </span>
                    </div>
                  </div>

                  <div
                    className={cn(
                      "mt-2 line-clamp-2 text-sm leading-6 text-slate-700",
                    )}
                  >
                    {item.summary}
                  </div>

                  {secondarySummary ? (
                    <div className="mt-1 line-clamp-1 text-xs leading-5 text-slate-500">
                      {secondarySummary}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span className="line-clamp-1">{metaHint}</span>
                    {topFailureSignalLabel ? (
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          isSelected
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {topFailureSignalLabel}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2 flex items-end justify-between gap-3 text-xs text-slate-500">
                    <div className="min-w-0 space-y-0.5">
                      {item.latestRunLabel ? (
                        <div className="line-clamp-1 text-[11px] leading-5">
                          {item.latestRunLabel}
                        </div>
                      ) : null}
                      <div className="line-clamp-1 text-[11px] leading-5">
                        {item.infraSummary}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {primaryDestinationLabel ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                          {primaryDestinationLabel}
                        </span>
                      ) : null}
                      <span className="font-medium text-slate-700">
                        点击进入
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
