import {
  type SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { cn } from "@/lib/utils";

interface SceneAppRunDetailPanelProps {
  hasSelectedSceneApp: boolean;
  runDetailView: SceneAppRunDetailViewModel | null;
  loading: boolean;
  error?: string | null;
  onDeliveryArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
  onEntryAction?: (
    action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>,
  ) => void;
  onGovernanceAction?: (
    action: SceneAppRunDetailViewModel["governanceActionEntries"][number],
  ) => void;
  onGovernanceArtifactAction?: (
    action: SceneAppRunDetailViewModel["governanceArtifactEntries"][number],
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

export function SceneAppRunDetailPanel({
  hasSelectedSceneApp,
  runDetailView,
  loading,
  error,
  onDeliveryArtifactAction,
  onEntryAction,
  onGovernanceAction,
  onGovernanceArtifactAction,
}: SceneAppRunDetailPanelProps) {
  if (!hasSelectedSceneApp) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-5 text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
        先选择一个 SceneApp，运行详情才会跟着回流到这里。
      </section>
    );
  }

  if (loading && !runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">运行详情</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          正在加载运行详情…
        </div>
      </section>
    );
  }

  if (error && !runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">运行详情</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">
          {error}
        </div>
      </section>
    );
  }

  if (!runDetailView) {
    return (
      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
        <div className="text-sm font-semibold text-slate-900">运行详情</div>
        <div className="mt-5 rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
          当前还没有可查看的运行详情，先试跑一轮再回来复盘。
        </div>
      </section>
    );
  }

  const entryAction = runDetailView.entryAction;

  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">运行详情</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            用业务解释看这次运行，而不是只看底层状态字段。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              刷新中
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
      </div>

      <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
        <div className="text-[11px] font-semibold tracking-[0.08em] text-lime-700">
          {runDetailView.stageLabel}
        </div>
        <p
          data-testid="sceneapp-run-detail-summary"
          className="mt-2 text-sm leading-7 text-slate-800"
        >
          {runDetailView.summary}
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {runDetailView.nextAction}
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">运行 ID</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.runId}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">来源</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.sourceLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">结果数</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.artifactCount} 份
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">开始时间</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.startedAtLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">结束时间</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.finishedAtLabel}
          </div>
        </article>

        <article className="rounded-[22px] border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">运行时长</div>
          <div className="mt-2 text-sm font-medium text-slate-900">
            {runDetailView.durationLabel}
          </div>
        </article>
      </div>

      <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">交付复盘</div>
            <div className="mt-2 text-sm font-medium text-slate-900">
              {runDetailView.deliveryCompletionLabel}
            </div>
          </div>
          {runDetailView.failureSignalLabel ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
              当前卡点：{runDetailView.failureSignalLabel}
            </span>
          ) : null}
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {runDetailView.deliverySummary}
        </p>

        {runDetailView.deliveryArtifactEntries.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">结果入口</div>
            <div className="mt-2 grid gap-3 xl:grid-cols-2">
              {runDetailView.deliveryArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={`sceneapp-run-detail-artifact-entry-${entry.key}`}
                  className="rounded-[18px] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
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
          </div>
        ) : null}

        {runDetailView.deliveryRequiredParts.length ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <div>
              <div className="text-xs font-medium text-slate-500">交付合同</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryRequiredParts.map((part) => (
                  <span
                    key={`required-${part.key}`}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {part.label}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">已交付部件</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryCompletedParts.length ? (
                  runDetailView.deliveryCompletedParts.map((part) => (
                    <span
                      key={`completed-${part.key}`}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
                    >
                      {part.label}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">暂未确认</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500">缺失部件</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runDetailView.deliveryMissingParts.length ? (
                  runDetailView.deliveryMissingParts.map((part) => (
                    <span
                      key={`missing-${part.key}`}
                      className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700"
                    >
                      {part.label}
                    </span>
                  ))
                ) : runDetailView.deliveryPartCoverageKnown ? (
                  <span className="text-sm text-slate-500">当前无缺件</span>
                ) : (
                  <span className="text-sm text-slate-500">部件明细待回流</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500">证据与复核</div>
            <div className="mt-2 text-sm font-medium text-slate-900">
              {runDetailView.evidenceSourceLabel}
            </div>
          </div>
          {runDetailView.deliveryViewerLabel ? (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700">
              结果入口：{runDetailView.deliveryViewerLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <article className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              请求遥测
            </div>
            <p
              data-testid="sceneapp-run-detail-request-telemetry"
              className="mt-2 text-sm leading-6 text-slate-700"
            >
              {runDetailView.requestTelemetryLabel}
            </p>
          </article>

          <article className="rounded-[18px] border border-slate-200 bg-slate-50 p-3">
            <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-500">
              Artifact 校验
            </div>
            <p
              data-testid="sceneapp-run-detail-artifact-validator"
              className="mt-2 text-sm leading-6 text-slate-700"
            >
              {runDetailView.artifactValidatorLabel}
            </p>
          </article>
        </div>

        {runDetailView.governanceArtifactEntries.length ? (
          <div className="mt-4">
            {runDetailView.governanceActionEntries.length ? (
              <div>
                <div className="text-xs font-medium text-slate-500">治理动作</div>
                <div className="mt-2 grid gap-3 xl:grid-cols-2">
                  {runDetailView.governanceActionEntries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      data-testid={`sceneapp-run-detail-governance-action-${entry.key}`}
                      className="rounded-[18px] border border-lime-200 bg-lime-50/70 p-3 text-left transition-colors hover:border-lime-300 hover:bg-white"
                      onClick={() => onGovernanceAction?.(entry)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">
                          {entry.label}
                        </span>
                        <span className="rounded-full border border-lime-200 bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-lime-700">
                          打开 {entry.primaryArtifactLabel}
                        </span>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-600">
                        {entry.helperText}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              className={cn(
                "text-xs font-medium text-slate-500",
                runDetailView.governanceActionEntries.length ? "mt-4" : "",
              )}
            >
              治理入口
            </div>
            <div className="mt-2 grid gap-3 xl:grid-cols-2">
              {runDetailView.governanceArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  data-testid={`sceneapp-run-detail-governance-entry-${entry.key}`}
                  className="rounded-[18px] border border-slate-200 bg-slate-50 p-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
                  onClick={() => onGovernanceArtifactAction?.(entry)}
                >
                  <div className="text-sm font-medium text-slate-900">
                    {entry.label}
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
          </div>
        ) : null}

        {runDetailView.verificationFailureOutcomes.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">当前复核阻塞</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {runDetailView.verificationFailureOutcomes.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {runDetailView.evidenceKnownGaps.length ? (
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">当前证据缺口</div>
            <div
              data-testid="sceneapp-run-detail-evidence-gaps"
              className="mt-2 flex flex-wrap gap-2"
            >
              {runDetailView.evidenceKnownGaps.map((gap) => (
                <span
                  key={gap}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                >
                  {gap}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {entryAction ? (
        <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-xs font-medium text-slate-500">继续动作</div>
          <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm leading-6 text-slate-600">
              {entryAction.helperText}
            </p>
            <button
              type="button"
              data-testid="sceneapp-run-detail-entry-action"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900"
              onClick={() => onEntryAction?.(entryAction)}
            >
              {entryAction.label}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
          详情接口暂时不可用，当前先展示列表里的摘要信息。{error}
        </div>
      ) : null}
    </section>
  );
}
