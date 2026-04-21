import type {
  SceneAppContextReferenceItemViewModel,
  SceneAppDeliveryPartViewModel,
  SceneAppExecutionSummaryViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp/product";
import { Button } from "@/components/ui/button";
import { SceneAppProjectPackRuntimePanel } from "@/components/sceneapps/SceneAppProjectPackRuntimePanel";
import {
  buildSceneAppExecutionPromptActions,
  type SceneAppExecutionPromptAction,
  type SceneAppQuickReviewAction,
} from "@/lib/sceneapp";
import type { SceneAppExecutionContentPostEntry } from "./sceneAppExecutionContentPosts";

interface SceneAppExecutionSummaryCardProps {
  summary?: SceneAppExecutionSummaryViewModel | null;
  latestPackResultDetailView?: SceneAppRunDetailViewModel | null;
  latestPackResultLoading?: boolean;
  latestPackResultUsesFallback?: boolean;
  onReviewCurrentProject?: () => void;
  onSaveAsSkill?: () => void;
  onOpenSceneAppDetail?: () => void;
  onOpenSceneAppGovernance?: () => void;
  humanReviewAvailable?: boolean;
  humanReviewLoading?: boolean;
  quickReviewActions?: SceneAppQuickReviewAction[];
  quickReviewPending?: boolean;
  onOpenHumanReview?: () => void;
  onApplyQuickReview?: (
    actionKey: SceneAppQuickReviewAction["key"],
  ) => void;
  onDeliveryArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
  onGovernanceAction?: (
    action: SceneAppRunDetailViewModel["governanceActionEntries"][number],
  ) => void;
  onGovernanceArtifactAction?: (
    action: SceneAppRunDetailViewModel["governanceArtifactEntries"][number],
  ) => void;
  onEntryAction?: (
    action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>,
  ) => void;
  contentPostEntries?: SceneAppExecutionContentPostEntry[];
  onContentPostAction?: (entry: SceneAppExecutionContentPostEntry) => void;
  promptActionPending?: boolean;
  onPromptAction?: (action: SceneAppExecutionPromptAction) => void;
}

function renderPartChips(
  items: SceneAppDeliveryPartViewModel[],
  className: string,
  testId?: string,
) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid={testId}>
      {items.map((item) => (
        <span
          key={item.key}
          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${className}`}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

function formatReferenceItemLabel(
  item: SceneAppContextReferenceItemViewModel,
): string {
  return [item.label, item.usageLabel, item.feedbackLabel]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" · ");
}

function resolveRuntimeToneClass(
  tone: NonNullable<
    SceneAppExecutionSummaryViewModel["runtimeBackflow"]
  >["statusTone"],
): string {
  switch (tone) {
    case "accent":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "success":
      return "border-lime-200 bg-lime-50 text-lime-700";
    case "watch":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "risk":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "default":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function resolvePromptActionToneClass(
  tone: SceneAppExecutionPromptAction["tone"],
  disabled: boolean,
): string {
  if (disabled) {
    return "border-slate-200 bg-slate-100 text-slate-400";
  }

  switch (tone) {
    case "positive":
      return "border-lime-200 bg-lime-50/80 text-slate-900 hover:border-lime-300 hover:bg-white";
    case "warning":
      return "border-amber-200 bg-amber-50/80 text-slate-900 hover:border-amber-300 hover:bg-white";
    case "neutral":
    default:
      return "border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50";
  }
}

function resolveContentPostReadinessToneClass(
  tone: SceneAppExecutionContentPostEntry["readinessTone"],
): string {
  switch (tone) {
    case "success":
      return "border-lime-200 bg-lime-50 text-lime-700";
    case "watch":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "default":
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function buildExecutionFollowupDestinations(
  detailView: SceneAppRunDetailViewModel,
): Array<{
  key: string;
  label: string;
  description: string;
}> {
  const destinations: Array<{
    key: string;
    label: string;
    description: string;
  }> = [];
  const actionKeys = new Set(
    detailView.governanceActionEntries.map((entry) => entry.key),
  );
  const artifactKinds = new Set(
    detailView.governanceArtifactEntries.map((entry) => entry.artifactRef.kind),
  );

  if (
    actionKeys.has("weekly-review-pack") ||
    (artifactKinds.has("evidence_summary") &&
      artifactKinds.has("review_decision_markdown"))
  ) {
    destinations.push({
      key: "weekly-review",
      label: "周会复盘",
      description: "证据摘要与人工复核已经适合带去业务复盘，方便快速对齐卡点和下一步。",
    });
  }

  if (
    actionKeys.has("structured-governance-pack") ||
    artifactKinds.has("review_decision_json")
  ) {
    destinations.push({
      key: "task-center",
      label: "生成工作台",
      description:
        "这轮结果的复盘材料已经整理好，后续更适合回到生成工作台继续推进下一步。",
    });
  }

  if (detailView.entryAction?.kind === "open_automation_job") {
    destinations.push({
      key: "automation-job",
      label: "持续流程 / 自动化",
      description: "这轮结果已经挂到持续任务，可以继续跟进调度频率、运行历史与交付状态。",
    });
  }

  if (detailView.deliveryArtifactEntries.length > 0) {
    destinations.push({
      key: "delivery-editing",
      label: "结果编辑 / 发布",
      description: "主稿和结果文件已经可直接打开，适合继续编辑、复核或进入发布前处理。",
    });
  }

  return destinations;
}

export function SceneAppExecutionSummaryCard({
  summary,
  latestPackResultDetailView = null,
  latestPackResultLoading = false,
  latestPackResultUsesFallback = false,
  onReviewCurrentProject,
  onSaveAsSkill,
  onOpenSceneAppDetail,
  onOpenSceneAppGovernance,
  humanReviewAvailable = false,
  humanReviewLoading = false,
  quickReviewActions = [],
  quickReviewPending = false,
  onOpenHumanReview,
  onApplyQuickReview,
  onDeliveryArtifactAction,
  onGovernanceAction,
  onGovernanceArtifactAction,
  onEntryAction,
  contentPostEntries = [],
  onContentPostAction,
  promptActionPending = false,
  onPromptAction,
}: SceneAppExecutionSummaryCardProps) {
  if (!summary) {
    return null;
  }

  const followupDestinations = latestPackResultDetailView
    ? buildExecutionFollowupDestinations(latestPackResultDetailView)
    : [];
  const promptActions = latestPackResultDetailView
    ? buildSceneAppExecutionPromptActions(latestPackResultDetailView)
    : [];
  const deliveryContractLabel =
    summary.projectPackPlan?.packKindLabel ?? summary.deliveryContractLabel;
  const deliveryDestinationLabel =
    summary.projectPackPlan?.viewerLabel || deliveryContractLabel || "待补齐";
  const scorecardSummaryLabel =
    summary.scorecardProfileRef ||
    (summary.scorecardMetricKeys.length > 0
      ? `${summary.scorecardMetricKeys.length} 项判断指标`
      : "待补齐");
  const hasFollowupSection = Boolean(
    onReviewCurrentProject ||
      onSaveAsSkill ||
      onOpenSceneAppDetail ||
      onOpenSceneAppGovernance ||
      humanReviewAvailable ||
      quickReviewActions.length ||
      latestPackResultDetailView,
  );

  return (
    <section
      className="mx-4 mb-3 rounded-[24px] border border-slate-200/80 bg-white px-4 py-4 shadow-sm shadow-slate-950/5"
      data-testid="sceneapp-execution-summary-card"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium tracking-[0.08em] text-sky-700">
              做法执行摘要
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">
                {summary.title}
              </h3>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                {summary.businessLabel}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {summary.summary}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {summary.typeLabel}
            </span>
            <span className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-1 text-[11px] font-medium text-lime-700">
              {deliveryContractLabel}
            </span>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
              {summary.planningStatusLabel}
            </span>
          </div>
        </div>

        <div className="rounded-[20px] border border-sky-200 bg-sky-50/70 p-4">
          <div className="text-xs font-medium text-slate-500">
            进入生成前已编译
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            {summary.planningSummary}
          </p>
          <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <span className="font-medium text-slate-900">执行主链：</span>
              {summary.executionChainLabel}
            </div>
            <div data-testid="sceneapp-execution-summary-reference-count">
              <span className="font-medium text-slate-900">当前带入：</span>
              {summary.referenceCount} 条参考对象
            </div>
            <div>
              <span className="font-medium text-slate-900">结果去向：</span>
              {deliveryDestinationLabel}
            </div>
            <div>
              <span className="font-medium text-slate-900">判断口径：</span>
              {scorecardSummaryLabel}
            </div>
          </div>
        </div>

        {summary.runtimeBackflow ? (
          <section
            className="rounded-[20px] border border-emerald-200/80 bg-emerald-50/60 p-4"
            data-testid="sceneapp-execution-summary-runtime-backflow"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-500">
                  运行态回流
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {summary.runtimeBackflow.summary}
                </p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${resolveRuntimeToneClass(summary.runtimeBackflow.statusTone)}`}
              >
                {summary.runtimeBackflow.statusLabel}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <span className="font-medium text-slate-900">最近运行：</span>
                {summary.runtimeBackflow.sourceLabel}
              </div>
              <div>
                <span className="font-medium text-slate-900">交付完成：</span>
                {summary.runtimeBackflow.deliveryCompletionLabel}
              </div>
              <div>
                <span className="font-medium text-slate-900">证据链：</span>
                {summary.runtimeBackflow.evidenceSourceLabel}
              </div>
              <div>
                <span className="font-medium text-slate-900">运行时间：</span>
                {summary.runtimeBackflow.finishedAtLabel ||
                  summary.runtimeBackflow.startedAtLabel}
              </div>
            </div>
            <div className="mt-3 text-sm leading-6 text-slate-700">
              <span className="font-medium text-slate-900">下一步：</span>
              {summary.runtimeBackflow.nextAction}
            </div>
            {summary.runtimeBackflow.scorecardActionLabel ||
            summary.runtimeBackflow.topFailureSignalLabel ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {summary.runtimeBackflow.scorecardActionLabel ? (
                  <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {summary.runtimeBackflow.scorecardActionLabel}
                  </span>
                ) : null}
                {summary.runtimeBackflow.topFailureSignalLabel ? (
                  <span className="rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    {summary.runtimeBackflow.topFailureSignalLabel}
                  </span>
                ) : null}
              </div>
            ) : null}
            {summary.runtimeBackflow.deliveryCompletedParts.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  已完成部件
                </div>
                {renderPartChips(
                  summary.runtimeBackflow.deliveryCompletedParts,
                  "border-lime-200 bg-white text-lime-700",
                  "sceneapp-execution-summary-runtime-completed-parts",
                )}
              </div>
            ) : null}
            {summary.runtimeBackflow.deliveryMissingParts.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  待补部件
                </div>
                {renderPartChips(
                  summary.runtimeBackflow.deliveryMissingParts,
                  "border-amber-200 bg-white text-amber-700",
                  "sceneapp-execution-summary-runtime-missing-parts",
                )}
              </div>
            ) : null}
            {summary.runtimeBackflow.observedFailureSignals.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  已观测信号
                </div>
                {renderPartChips(
                  summary.runtimeBackflow.observedFailureSignals,
                  "border-rose-200 bg-white text-rose-700",
                  "sceneapp-execution-summary-runtime-failure-signals",
                )}
              </div>
            ) : null}
            {summary.runtimeBackflow.governanceArtifacts.length ? (
              <div className="mt-3">
                <div className="text-xs font-medium text-slate-500">
                  复盘材料
                </div>
                {renderPartChips(
                  summary.runtimeBackflow.governanceArtifacts,
                  "border-sky-200 bg-white text-sky-700",
                  "sceneapp-execution-summary-runtime-governance",
                )}
              </div>
            ) : null}
          </section>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-medium text-slate-900">
              当前带入对象
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              这一轮开工前，参考、风格、偏好和项目结果已经被压成同一份可继续复用的准备基线。
            </p>
            {renderPartChips(
              summary.activeLayers,
              "border-sky-200 bg-white text-sky-700",
              "sceneapp-execution-summary-active-layers",
            )}
            {summary.referenceItems.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {summary.referenceItems.slice(0, 4).map((item) => (
                  <span
                    key={item.key}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                  >
                    {formatReferenceItemLabel(item)}
                  </span>
                ))}
                {summary.referenceItems.length > 4 ? (
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    +{summary.referenceItems.length - 4} 条参考
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前没有显式带入参考对象，生成将主要依赖当前输入与项目上下文。
              </p>
            )}
            {summary.tasteSummary ? (
              <div className="mt-3 text-sm leading-6 text-slate-700">
                <span className="font-medium text-slate-900">风格摘要：</span>
                {summary.tasteSummary}
              </div>
            ) : null}
            {summary.feedbackSummary ? (
              <div className="mt-2 text-sm leading-6 text-slate-700">
                <span className="font-medium text-slate-900">最近反馈：</span>
                {summary.feedbackSummary}
              </div>
            ) : null}
          </section>

          <section
            className="rounded-[20px] border border-slate-200 bg-white p-4"
            data-testid="sceneapp-execution-summary-project-pack"
          >
            <div className="text-sm font-medium text-slate-900">
              结果去向与交付
            </div>
            {summary.projectPackPlan ? (
              <>
                <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  <div>
                    <span className="font-medium text-slate-900">结果形态：</span>
                    {summary.projectPackPlan.packKindLabel}
                  </div>
                  <div>
                    <span className="font-medium text-slate-900">完成判断：</span>
                    {summary.projectPackPlan.completionStrategyLabel}
                  </div>
                  {summary.projectPackPlan.primaryPart ? (
                    <div>
                      <span className="font-medium text-slate-900">默认主结果：</span>
                      {summary.projectPackPlan.primaryPart}
                    </div>
                  ) : null}
                  {summary.projectPackPlan.viewerLabel ? (
                    <div>
                      <span className="font-medium text-slate-900">查看入口：</span>
                      {summary.projectPackPlan.viewerLabel}
                    </div>
                  ) : null}
                </div>
                {renderPartChips(
                  summary.projectPackPlan.requiredParts,
                  "border-lime-200 bg-lime-50 text-lime-700",
                )}
                {summary.projectPackPlan.notes.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.projectPackPlan.notes.map((note) => (
                      <span
                        key={note}
                        className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700"
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                当前这套做法还没有明确结果去向，后续需要继续补齐。
              </p>
            )}
          </section>

          <section
            className="rounded-[20px] border border-slate-200 bg-white p-4"
            data-testid="sceneapp-execution-summary-scorecard"
          >
            <div className="text-sm font-medium text-slate-900">
              这轮怎么判断
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              这里保留继续复核、放量或回退时最关键的判断线索，不把经营判断藏在后台。
            </p>
            {summary.scorecardProfileRef ? (
              <div className="mt-3 text-sm leading-6 text-slate-700">
                <span className="font-medium text-slate-900">判断基线：</span>
                {summary.scorecardProfileRef}
              </div>
            ) : null}
            {renderPartChips(
              summary.scorecardMetricKeys,
              "border-emerald-200 bg-emerald-50 text-emerald-700",
              "sceneapp-execution-summary-scorecard-metrics",
            )}
            {renderPartChips(
              summary.scorecardFailureSignals,
              "border-amber-200 bg-amber-50 text-amber-700",
              "sceneapp-execution-summary-scorecard-failure-signals",
            )}
          </section>
        </div>

        <SceneAppProjectPackRuntimePanel
          title="最近可消费结果"
          description="生成主执行面直接回看最近一轮可继续编辑、复核或发布的结果样本，不再只停留在摘要说明。"
          emptyMessage="当前还没有可直接打开的结果样本，先继续跑出一轮带真实结果文件回流的结果包。"
          testIdPrefix="sceneapp-execution-summary"
          className="border-slate-200 bg-slate-50/70"
          runDetailView={latestPackResultDetailView}
          loading={latestPackResultLoading}
          usesFallbackRun={latestPackResultUsesFallback}
          onDeliveryArtifactAction={onDeliveryArtifactAction}
        />

        {hasFollowupSection ? (
          <section
            className="rounded-[18px] border border-slate-200 bg-white px-4 py-4"
            data-testid="sceneapp-execution-summary-followup-actions"
          >
            <div className="text-xs font-medium text-slate-500">继续动作</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              如果要补上下文、查看经营口径或继续做人工复核，直接回到同一套做法闭环。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onReviewCurrentProject ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sceneapp-execution-summary-review-current-project"
                  onClick={onReviewCurrentProject}
                >
                  复盘当前项目
                </Button>
              ) : null}
              {onSaveAsSkill ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sceneapp-execution-summary-save-as-skill"
                  onClick={onSaveAsSkill}
                >
                  沉淀为做法
                </Button>
              ) : null}
              {onOpenSceneAppDetail ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sceneapp-execution-summary-open-detail"
                  onClick={onOpenSceneAppDetail}
                >
                  回生成准备
                </Button>
              ) : null}
              {onOpenSceneAppGovernance ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sceneapp-execution-summary-open-governance"
                  onClick={onOpenSceneAppGovernance}
                >
                  去做法复盘
                </Button>
              ) : null}
              {humanReviewAvailable ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="sceneapp-execution-summary-open-human-review"
                  onClick={onOpenHumanReview}
                >
                  {humanReviewLoading ? "准备人工复核…" : "填写人工复核"}
                </Button>
              ) : null}
            </div>
            {latestPackResultUsesFallback ? (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                当前主运行还在继续，做法复盘会优先定位到最近一轮已交付样本，方便直接延续结果消费与放量判断。
              </p>
            ) : null}
            {humanReviewAvailable && quickReviewActions.length ? (
              <div className="mt-4">
                <div className="text-xs font-medium text-slate-500">
                  轻量判断
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {quickReviewActions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      data-testid={`sceneapp-execution-summary-quick-review-${action.key}`}
                      disabled={quickReviewPending}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => onApplyQuickReview?.(action.key)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {latestPackResultDetailView &&
            (followupDestinations.length ||
              promptActions.length ||
              latestPackResultDetailView.governanceActionEntries.length ||
              latestPackResultDetailView.governanceArtifactEntries.length ||
              latestPackResultDetailView.entryAction) ? (
              <div
                className="mt-4 rounded-[18px] border border-slate-200 bg-slate-50/70 p-4"
                data-testid="sceneapp-execution-summary-orchestration"
              >
                <div className="text-xs font-medium text-slate-500">
                  生成后动作编排
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  同一轮结果现在可以直接进入复盘、复盘材料准备或底层运行入口恢复，不再只是回页面找下一步。
                </p>

                {followupDestinations.length ? (
                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                    {followupDestinations.map((item) => (
                      <article
                        key={item.key}
                        className="rounded-[18px] border border-white bg-white px-3 py-3"
                      >
                        <div className="text-sm font-medium text-slate-900">
                          {item.label}
                        </div>
                        <div className="mt-2 text-xs leading-5 text-slate-600">
                          {item.description}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {latestPackResultDetailView.governanceActionEntries.length ||
                promptActions.length ||
                latestPackResultDetailView.entryAction ? (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-slate-500">
                      推荐动作
                    </div>
                    <div className="mt-2 grid gap-3 xl:grid-cols-2">
                      {latestPackResultDetailView.governanceActionEntries.map(
                        (entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            data-testid={`sceneapp-execution-summary-governance-action-${entry.key}`}
                            className="rounded-[18px] border border-lime-200 bg-lime-50/80 p-3 text-left transition-colors hover:border-lime-300 hover:bg-white"
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
                        ),
                      )}

                      {latestPackResultDetailView.entryAction ? (
                        <button
                          type="button"
                          data-testid="sceneapp-execution-summary-entry-action"
                          className="rounded-[18px] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                          onClick={() =>
                            onEntryAction?.(latestPackResultDetailView.entryAction!)
                          }
                        >
                          <div className="text-sm font-medium text-slate-900">
                            {latestPackResultDetailView.entryAction.label}
                          </div>
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            {latestPackResultDetailView.entryAction.helperText}
                          </div>
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {promptActions.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-slate-500">
                      同聊推进
                    </div>
                    <div className="mt-2 grid gap-3 xl:grid-cols-2">
                      {promptActions.map((action) => {
                        const disabled =
                          promptActionPending || Boolean(action.disabledReason);

                        return (
                          <button
                            key={action.key}
                            type="button"
                            data-testid={`sceneapp-execution-summary-prompt-action-${action.key}`}
                            disabled={disabled}
                            className={`rounded-[18px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:bg-slate-100 ${resolvePromptActionToneClass(action.tone, disabled)}`}
                            onClick={() => onPromptAction?.(action)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">
                                {action.label}
                              </span>
                              {action.disabledReason ? (
                                <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-amber-700">
                                  需先处理前置项
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-slate-600">
                              {action.helperText}
                            </div>
                            {action.disabledReason ? (
                              <div className="mt-2 text-[11px] leading-5 text-amber-700">
                                当前阻塞：{action.disabledReason}
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {contentPostEntries.length ? (
                  <div
                    className="mt-4"
                    data-testid="sceneapp-execution-summary-content-posts"
                  >
                    <div className="text-xs font-medium text-slate-500">
                      最近发布产物
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      当前会话里刚整理出来的发布稿、渠道预览稿和上传稿，会直接回流到这里继续复核，不需要离开生成主执行面。
                    </p>
                    <div className="mt-3 grid gap-3 xl:grid-cols-3">
                      {contentPostEntries.map((entry) => (
                        <button
                          key={entry.key}
                          type="button"
                          data-testid={`sceneapp-execution-summary-content-post-${entry.key}`}
                          className="rounded-[18px] border border-slate-200 bg-white p-3 text-left transition-colors hover:border-slate-300 hover:bg-slate-50"
                          onClick={() => onContentPostAction?.(entry)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">
                              {entry.label}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${resolveContentPostReadinessToneClass(entry.readinessTone)}`}
                            >
                              {entry.readinessLabel}
                            </span>
                            {entry.platformLabel ? (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-sky-700">
                                {entry.platformLabel}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 text-xs leading-5 text-slate-600">
                            {entry.helperText}
                          </div>
                          {entry.companionEntries.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {entry.companionEntries.map((companion) => (
                                <span
                                  key={companion.key}
                                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                                >
                                  {companion.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-2 truncate text-[11px] leading-5 text-slate-500">
                            {entry.pathLabel}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {latestPackResultDetailView.governanceArtifactEntries.length ? (
                  <div className="mt-4">
                    <div className="text-xs font-medium text-slate-500">
                      基础复盘材料
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {latestPackResultDetailView.governanceArtifactEntries.map(
                        (entry) => (
                          <button
                            key={entry.key}
                            type="button"
                            data-testid={`sceneapp-execution-summary-governance-artifact-${entry.key}`}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => onGovernanceArtifactAction?.(entry)}
                          >
                            {entry.label}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {summary.notes.length ? (
          <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-xs font-medium text-slate-500">规划备注</div>
            <div
              className="mt-2 flex flex-wrap gap-2"
              data-testid="sceneapp-execution-summary-notes"
            >
              {summary.notes.map((note) => (
                <span
                  key={note}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700"
                >
                  {note}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default SceneAppExecutionSummaryCard;
