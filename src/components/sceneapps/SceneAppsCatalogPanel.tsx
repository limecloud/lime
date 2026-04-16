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
  { value: "all", label: "全部形态" },
  { value: "hybrid", label: "多能力组合" },
  { value: "cloud_managed", label: "云端托管" },
  { value: "browser_grounded", label: "真实浏览器" },
  { value: "local_durable", label: "持续运行" },
  { value: "local_instant", label: "本地即时" },
];

const PATTERN_FILTER_OPTIONS: Array<{
  value: SceneAppPatternFilter;
  label: string;
}> = [
  { value: "all", label: "全部模式" },
  { value: "pipeline", label: "Pipeline" },
  { value: "generator", label: "Generator" },
  { value: "reviewer", label: "Reviewer" },
  { value: "inversion", label: "Inversion" },
  { value: "tool_wrapper", label: "Tool Wrapper" },
];

interface SceneAppsCatalogPanelProps {
  items: SceneAppCatalogCardViewModel[];
  recentItems: SceneAppRecentVisitItem[];
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
          ? "border-slate-900 bg-slate-900 text-white"
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
  return (
    <section
      data-testid="sceneapps-catalog-directory"
      className="space-y-4"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="relative w-full max-w-[360px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            placeholder="搜索场景标题"
            className="h-10 rounded-full border-slate-200 bg-white pl-9"
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </div>

        <div className="flex flex-1 flex-col gap-3">
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

      {recentItems.length > 0 ? (
        <div className="text-sm leading-7 text-slate-500">
          继续最近：
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

      {items.length === 0 ? (
        <div className="text-sm leading-7 text-slate-500">
          当前筛选条件下还没有匹配的 SceneApp。可以先放宽运行形态或设计模式筛选。
        </div>
      ) : (
        <div className="space-y-1">
          {items.map((item) => {
            const isSelected = item.id === selectedSceneAppId;

            return (
              <div
                key={item.id}
                className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-b-0"
              >
                <button
                  type="button"
                  data-testid={`sceneapp-page-card-${item.id}`}
                  className={cn(
                    "text-left text-base transition-colors",
                    isSelected
                      ? "font-semibold text-slate-950"
                      : "font-medium text-slate-700 hover:text-slate-950",
                  )}
                  onClick={() => onSelectSceneApp(item.id)}
                >
                  {item.title}
                </button>
                {isSelected ? (
                  <span className="text-xs text-lime-700">当前</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
