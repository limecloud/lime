import { type SceneAppRunListItemViewModel } from "@/lib/sceneapp";
import { cn } from "@/lib/utils";

interface SceneAppRunListProps {
  runs: SceneAppRunListItemViewModel[];
  loading: boolean;
  error?: string | null;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}

const RUN_STATUS_CLASSNAMES = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  canceled: "border-amber-200 bg-amber-50 text-amber-700",
  timeout: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

export function SceneAppRunList({
  runs,
  loading,
  error,
  selectedRunId,
  onSelectRun,
}: SceneAppRunListProps) {
  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div>
        <div className="text-sm font-semibold text-slate-900">结果记录</div>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          同一个 Skill 在不同项目和时间里的最近结果，会统一回到这里。
        </p>
      </div>

      {loading ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在加载结果记录…
        </div>
      ) : error ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {error}
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          当前还没有结果记录，适合先做第一轮试跑。
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {runs.slice(0, 6).map((run) => (
            <button
              key={run.runId}
              type="button"
              data-testid={`sceneapp-run-item-${run.runId}`}
              className={cn(
                "rounded-[22px] border p-4 text-left transition-colors",
                selectedRunId === run.runId
                  ? "border-lime-300 bg-lime-50/70 shadow-sm shadow-lime-950/5"
                  : "border-slate-200 bg-slate-50/70 hover:border-slate-300 hover:bg-slate-50",
              )}
              onClick={() => onSelectRun(run.runId)}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-900">
                    {run.runId}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    启动于 {run.startedAtLabel}
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                    RUN_STATUS_CLASSNAMES[run.status],
                  )}
                >
                  {run.statusLabel}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-slate-600">
                {run.summary}
              </p>

              <div className="mt-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
                <div>
                  <span className="font-medium text-slate-700">来源：</span>
                  {run.sourceLabel}
                </div>
                <div>
                  <span className="font-medium text-slate-700">交付：</span>
                  {run.deliveryLabel}
                </div>
                <div>
                  <span className="font-medium text-slate-700">结束：</span>
                  {run.finishedAtLabel}
                </div>
              </div>
              {run.failureSignalLabel ? (
                <div className="mt-3">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    当前卡点：{run.failureSignalLabel}
                  </span>
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
