import type { SceneAppRunDetailViewModel } from "@/lib/sceneapp";
import { cn } from "@/lib/utils";

interface SceneAppProjectPackRuntimePanelProps {
  title: string;
  description: string;
  emptyMessage: string;
  testIdPrefix: string;
  className?: string;
  runDetailView: SceneAppRunDetailViewModel | null;
  loading?: boolean;
  usesFallbackRun?: boolean;
  onDeliveryArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
}

const RUN_STATUS_CLASSNAMES = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  canceled: "border-amber-200 bg-amber-50 text-amber-700",
  timeout: "border-rose-200 bg-rose-50 text-rose-700",
} as const;

export function SceneAppProjectPackRuntimePanel({
  title,
  description,
  emptyMessage,
  testIdPrefix,
  className,
  runDetailView,
  loading = false,
  usesFallbackRun = false,
  onDeliveryArtifactAction,
}: SceneAppProjectPackRuntimePanelProps) {
  return (
    <section
      className={cn(
        "rounded-[24px] border border-slate-200 bg-white p-4",
        className,
      )}
      data-testid={`${testIdPrefix}-runtime-pack`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-900">{title}</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {runDetailView ? (
          <div className="flex flex-wrap items-center gap-2">
            {loading ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                回流中
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                RUN_STATUS_CLASSNAMES[runDetailView.status],
              )}
            >
              {runDetailView.statusLabel}
            </span>
          </div>
        ) : null}
      </div>

      {loading && !runDetailView ? (
        <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
          正在回流最近可消费结果…
        </div>
      ) : !runDetailView ? (
        <div className="mt-4 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <>
          {usesFallbackRun ? (
            <div
              data-testid={`${testIdPrefix}-runtime-fallback-note`}
              className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800"
            >
              当前最近一次运行还在继续，这里先回看最近一轮已交付样本，避免准备页和评分页只剩查看方式文案、没有实际结果入口。
            </div>
          ) : null}

          <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
            <div>
              <span className="font-medium text-slate-900">结果来源：</span>
              {runDetailView.sourceLabel}
            </div>
            <div>
              <span className="font-medium text-slate-900">交付完成：</span>
              {runDetailView.deliveryCompletionLabel}
            </div>
            <div>
              <span className="font-medium text-slate-900">查看方式：</span>
              {runDetailView.deliveryViewerLabel ??
                runDetailView.packViewerLabel ??
                "沿当前结果文件打开"}
            </div>
            <div>
              <span className="font-medium text-slate-900">结果时间：</span>
              {runDetailView.finishedAtLabel || runDetailView.startedAtLabel}
            </div>
          </div>

          <p className="mt-3 text-sm leading-6 text-slate-600">
            {runDetailView.summary}
          </p>

          {runDetailView.failureSignalLabel ? (
            <div className="mt-3">
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                当前卡点：{runDetailView.failureSignalLabel}
              </span>
            </div>
          ) : null}

          {runDetailView.deliveryArtifactEntries.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {runDetailView.deliveryArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={`${testIdPrefix}-artifact-entry-${entry.key}`}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
                  disabled={!onDeliveryArtifactAction}
                  onClick={() => onDeliveryArtifactAction?.(entry)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {entry.label}
                    </span>
                    {entry.isPrimary ? (
                      <span className="rounded-full border border-lime-200 bg-lime-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-lime-700">
                        PRIMARY
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {entry.pathLabel}
                  </div>
                  <div className="mt-2 text-xs leading-5 text-slate-500">
                    {entry.helperText}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-[18px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
              当前最近可参考的样本还没有可直接打开的结果文件路径，先继续跑出一份带真实文件回流的结果包。
            </div>
          )}
        </>
      )}
    </section>
  );
}
