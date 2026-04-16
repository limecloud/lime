import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { SceneAppCatalogCardViewModel } from "@/lib/sceneapp";
import { cn } from "@/lib/utils";
import type {
  SceneAppPatternFilter,
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
  searchQuery: string;
  typeFilter: SceneAppTypeFilter;
  patternFilter: SceneAppPatternFilter;
  selectedSceneAppId: string | null;
  onSearchQueryChange: (value: string) => void;
  onTypeFilterChange: (value: SceneAppTypeFilter) => void;
  onPatternFilterChange: (value: SceneAppPatternFilter) => void;
  onSelectSceneApp: (sceneappId: string) => void;
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
  searchQuery,
  typeFilter,
  patternFilter,
  selectedSceneAppId,
  onSearchQueryChange,
  onTypeFilterChange,
  onPatternFilterChange,
  onSelectSceneApp,
}: SceneAppsCatalogPanelProps) {
  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-slate-900">场景目录</div>
          <p className="text-sm leading-6 text-slate-500">
            先按目标结果挑选，再决定要不要继续沉淀下一条 SceneApp。
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchQuery}
            placeholder="搜索结果目标、模式或基础设施"
            className="h-10 rounded-full border-slate-200 bg-slate-50 pl-9"
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
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

      {items.length === 0 ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-500">
          当前筛选条件下还没有匹配的 SceneApp。可以先放宽运行形态或设计模式筛选。
        </div>
      ) : (
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {items.map((item) => {
            const isSelected = item.id === selectedSceneAppId;

            return (
              <button
                key={item.id}
                type="button"
                data-testid={`sceneapp-page-card-${item.id}`}
                className={cn(
                  "flex min-h-[214px] flex-col rounded-[24px] border p-4 text-left transition-colors",
                  isSelected
                    ? "border-lime-300 bg-lime-50/70 shadow-sm shadow-lime-950/5"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70",
                )}
                onClick={() => onSelectSceneApp(item.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
                      {item.businessLabel}
                    </div>
                    <h3 className="mt-1 text-base font-semibold text-slate-900">
                      {item.title}
                    </h3>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {item.typeLabel}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {item.valueStatement}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {item.summary}
                </p>

                <div className="mt-auto flex flex-col gap-2 pt-4 text-xs text-slate-500">
                  <div>
                    <span className="font-medium text-slate-700">产出：</span>
                    {item.outputHint}
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">模式：</span>
                    {item.patternSummary}
                  </div>
                  <div className="pt-1 text-xs font-medium text-slate-700">
                    点击进入详情
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
