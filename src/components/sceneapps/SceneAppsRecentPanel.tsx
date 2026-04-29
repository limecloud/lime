import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SceneAppsPageParams } from "@/lib/sceneapp";
import type { SceneAppRecentVisitItem } from "./useSceneAppsPageRuntime";

interface SceneAppsRecentPanelProps {
  items: SceneAppRecentVisitItem[];
  onResume: (params: SceneAppsPageParams) => void;
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

export function SceneAppsRecentPanel({
  items,
  onResume,
}: SceneAppsRecentPanelProps) {
  const latestItem = items[0] ?? null;

  if (!latestItem) {
    return null;
  }

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-[760px]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <History className="h-4 w-4 text-lime-700" />
            继续最近场景
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            不用每次重新挑场景、项目和运行上下文，直接从最近一次工作状态继续。
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          className="rounded-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          onClick={() => onResume(latestItem.params)}
        >
          {latestItem.isCurrent ? "已恢复当前上下文" : "恢复上次上下文"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <article className="rounded-[24px] border border-lime-200 bg-lime-50/60 p-4">
          <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
            {latestItem.businessLabel}
          </div>
          <div
            data-testid="sceneapp-recent-latest-title"
            className="mt-2 text-lg font-semibold text-slate-900"
          >
            {latestItem.title}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {latestItem.summary}
          </p>
          <div className="mt-3 text-xs text-slate-500">{latestItem.hint}</div>
          <div className="mt-1 text-xs text-slate-400">
            最近访问：{formatVisitedAt(latestItem.visitedAt)}
          </div>
        </article>

        <div className="flex flex-col gap-3">
          {items.slice(1).map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid={`sceneapp-recent-item-${item.key}`}
              className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
              onClick={() => onResume(item.params)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                    {item.businessLabel}
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-900">
                    {item.title}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  {formatVisitedAt(item.visitedAt)}
                </div>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {item.summary}
              </p>
              <div className="mt-2 text-xs text-slate-500">{item.hint}</div>
            </button>
          ))}
          {items.length === 1 ? (
            <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
              最近只记录到这一条 SceneApp
              工作上下文，继续使用后会在这里累积更多可恢复入口。
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
