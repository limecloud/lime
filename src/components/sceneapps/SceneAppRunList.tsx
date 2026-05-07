import { useEffect, useMemo, useState } from "react";
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

const RUNS_PAGE_SIZE = 6;

export function SceneAppRunList({
  runs,
  loading,
  error,
  selectedRunId,
  onSelectRun,
}: SceneAppRunListProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(runs.length / RUNS_PAGE_SIZE));
  const pagedRuns = useMemo(() => {
    const startIndex = (page - 1) * RUNS_PAGE_SIZE;
    return runs.slice(startIndex, startIndex + RUNS_PAGE_SIZE);
  }, [page, runs]);

  useEffect(() => {
    if (!runs.length) {
      setPage(1);
      return;
    }

    if (!selectedRunId) {
      setPage((currentPage) => Math.min(currentPage, totalPages));
      return;
    }

    const selectedRunIndex = runs.findIndex((run) => run.runId === selectedRunId);
    if (selectedRunIndex === -1) {
      setPage((currentPage) => Math.min(currentPage, totalPages));
      return;
    }

    const nextPage = Math.floor(selectedRunIndex / RUNS_PAGE_SIZE) + 1;
    setPage((currentPage) => (currentPage === nextPage ? currentPage : nextPage));
  }, [runs, selectedRunId, totalPages]);

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">结果记录</div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            看最近几轮结果。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {runs.length > 0 ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
              共 {runs.length} 条
            </span>
          ) : null}
          {totalPages > 1 ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
              第 {page} / {totalPages} 页
            </span>
          ) : null}
        </div>
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
        <div className="mt-4 space-y-3">
          <div className="flex flex-col gap-2.5">
            {pagedRuns.map((run) => (
              <button
                key={run.runId}
                type="button"
                data-testid={`sceneapp-run-item-${run.runId}`}
                className={cn(
                  "rounded-[18px] border p-3 text-left transition-colors",
                  selectedRunId === run.runId
                    ? "border-lime-300 bg-lime-50/70 shadow-sm shadow-lime-950/5"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                )}
                onClick={() => onSelectRun(run.runId)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      RUN_STATUS_CLASSNAMES[run.status],
                    )}
                  >
                    {run.statusLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    {run.sourceLabel}
                  </span>
                  {run.failureSignalLabel ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                      卡点
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-medium text-slate-900">
                      {run.runId}
                    </div>
                    <div className="mt-1 line-clamp-1 text-xs text-slate-500">
                      启动于 {run.startedAtLabel}
                    </div>
                  </div>
                  {selectedRunId === run.runId ? (
                    <span className="rounded-full border border-lime-200 bg-white px-2 py-0.5 text-[10px] font-medium text-lime-700">
                      当前查看
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">
                  {run.summary}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    交付：{run.deliveryLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    结束：{run.finishedAtLabel}
                  </span>
                </div>
                {run.failureSignalLabel ? (
                  <div className="mt-2 line-clamp-1 text-xs text-amber-700">
                    当前卡点：{run.failureSignalLabel}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div
                data-testid="sceneapp-run-list-pagination-status"
                className="text-xs text-slate-500"
              >
                第 {page} / {totalPages} 页
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="sceneapp-run-list-prev-page"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={page === 1}
                  onClick={() =>
                    setPage((currentPage) => Math.max(1, currentPage - 1))
                  }
                >
                  上一页
                </button>
                <button
                  type="button"
                  data-testid="sceneapp-run-list-next-page"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={page === totalPages}
                  onClick={() =>
                    setPage((currentPage) =>
                      Math.min(totalPages, currentPage + 1),
                    )
                  }
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
