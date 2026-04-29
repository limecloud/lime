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
  { value: "all", label: "全部做法" },
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
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
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
  const STATUS_CLASSNAMES = {
    idle: "border-slate-200 bg-slate-50 text-slate-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    watch: "border-amber-200 bg-amber-50 text-amber-700",
    risk: "border-rose-200 bg-rose-50 text-rose-700",
  } as const;

  return (
    <section data-testid="sceneapps-catalog-directory" className="space-y-4">
      <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div className="text-sm font-semibold text-slate-900">
                先从全部做法里挑一套
              </div>
              <p className="text-sm leading-6 text-slate-500">
                可以按想拿到的结果、推进方式和做法特征缩小范围，不用先理解内部能力栈。
              </p>
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">
                搜索做法
              </div>
              <div className="relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  placeholder="搜索做法标题或想要的结果"
                  className="h-11 rounded-[22px] border-slate-200 bg-slate-50 pl-9"
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-1 flex-col gap-3">
              <div className="space-y-2">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">
                  按推进方式筛
                </div>
                <div className="flex flex-wrap gap-2">
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

              <div className="space-y-2">
                <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-400">
                  按做法特征筛
                </div>
                <div className="flex flex-wrap gap-2">
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
            </div>
          </div>
        </div>
      </div>

      {recentItems.length > 0 ? (
        <div className="text-sm leading-7 text-slate-500">
          最近看过：
          {recentItems.slice(0, 4).map((item, index) => (
            <span key={item.key}>
              <button
                type="button"
                data-testid={
                  index === 0
                    ? "sceneapp-recent-latest-title"
                    : `sceneapp-recent-item-${item.key}`
                }
                className="ml-2 font-medium text-slate-700 transition-colors hover:text-slate-950"
                title={`${item.hint} · ${formatVisitedAt(item.visitedAt)}`}
                onClick={() => onResumeRecentVisit(item.params)}
              >
                {item.title}
              </button>
              {index < Math.min(recentItems.length, 4) - 1 ? (
                <span className="mx-2 text-slate-300">/</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

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
          当前筛选条件下还没有匹配的整套做法。可以先清空关键词，或放宽筛选条件继续找。
        </div>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((item) => {
            const isSelected = item.id === selectedSceneAppId;
            const aggregate = item.scorecardAggregate ?? null;
            const aggregateSummary =
              aggregate?.summary ?? item.operatingSummary;
            const aggregateNextAction = aggregate?.nextAction;

            return (
              <div
                key={item.id}
                className={cn(
                  "rounded-[24px] border p-4 transition-colors",
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
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          className={cn(
                            "text-base font-semibold",
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
                          "text-xs font-medium",
                          isSelected ? "text-slate-600" : "text-slate-500",
                        )}
                      >
                        {item.businessLabel} · {item.typeLabel} ·{" "}
                        {item.deliveryContractLabel}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {aggregate?.actionLabel || item.scorecardActionLabel ? (
                        <span
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            isSelected
                              ? "border-emerald-200 bg-white/90 text-emerald-700"
                              : "border-slate-200 bg-slate-50 text-slate-700",
                          )}
                        >
                          {aggregate?.actionLabel ?? item.scorecardActionLabel}
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
                      "mt-3 text-sm leading-6",
                      isSelected ? "text-slate-700" : "text-slate-700",
                    )}
                  >
                    {item.summary}
                  </div>
                  <div
                    className={cn(
                      "mt-2 text-sm leading-6",
                      isSelected ? "text-slate-600" : "text-slate-600",
                    )}
                  >
                    {aggregateSummary}
                  </div>
                  {aggregateNextAction ? (
                    <div
                      className={cn(
                        "mt-2 text-sm leading-6",
                        isSelected ? "text-slate-500" : "text-slate-500",
                      )}
                    >
                      {aggregateNextAction}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        isSelected
                          ? "border-slate-200 bg-white text-slate-700"
                          : "border-slate-200 bg-white text-slate-700",
                      )}
                    >
                      {item.patternSummary}
                    </span>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        isSelected
                          ? "border-slate-200 bg-white text-slate-700"
                          : "border-slate-200 bg-white text-slate-700",
                      )}
                    >
                      {item.infraSummary}
                    </span>
                    {aggregate?.topFailureSignalLabel ||
                    item.topFailureSignalLabel ? (
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          isSelected
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {aggregate?.topFailureSignalLabel ??
                          item.topFailureSignalLabel}
                      </span>
                    ) : null}
                    {aggregate?.destinations?.map((destination) => (
                      <span
                        key={`${item.id}-${destination.key}`}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          isSelected
                            ? "border-slate-200 bg-white text-slate-700"
                            : "border-slate-200 bg-white text-slate-700",
                        )}
                      >
                        {destination.label}
                      </span>
                    ))}
                  </div>

                  <div
                    className={cn(
                      "mt-3 flex flex-wrap items-center gap-3 text-xs",
                      isSelected ? "text-slate-500" : "text-slate-500",
                    )}
                  >
                    <span>{item.outputHint}</span>
                    {item.latestRunLabel ? (
                      <span>{item.latestRunLabel}</span>
                    ) : null}
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
