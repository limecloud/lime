import { RefreshCw } from "lucide-react";
import type { AutomationJobRecord } from "@/lib/api/automation";
import type { AgentRun } from "@/lib/api/executionRun";
import type {
  SceneAppAutomationWorkspaceCardViewModel,
  SceneAppRunDetailViewModel,
} from "@/lib/sceneapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { SceneAppRunDetailPanel } from "@/components/sceneapps/SceneAppRunDetailPanel";
import {
  buildSceneAppExecutionFollowupDestinations,
  type SceneAppExecutionFollowupDestination,
} from "@/components/sceneapps/sceneAppExecutionFollowupDestinations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_LABEL,
  LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_NOTE,
  type AutomationServiceSkillContext,
} from "./serviceSkillContext";
import {
  LEGACY_BROWSER_AUTOMATION_NOTICE,
  LEGACY_BROWSER_AUTOMATION_STATUS,
  describeAgentTurnAccessMode,
  deliveryChannelLabel,
  deliveryModeLabel,
  deliveryStatusVariant,
  deliveryToneClass,
  describePayload,
  describeSchedule,
  describeServiceSkillSlotPreview,
  describeServiceSkillTaskLine,
  formatTime,
  isLegacyBrowserAutomation,
  outputFormatLabel,
  outputSchemaLabel,
  payloadKindLabel,
  resolveDeliveryOutputFormat,
  resolveDeliveryOutputSchema,
  resolveRunDelivery,
  resolveRunInfoMessage,
  resolveRunServiceSkillContext,
  resolveRunSessionId,
  runDisplayStatus,
  runInfoToneClass,
  runStatusVariant,
  statusLabel,
  statusVariant,
} from "./automationPresentation";

interface AutomationJobDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: AutomationJobRecord | null;
  workspaceName: string | null;
  serviceSkillContext: AutomationServiceSkillContext | null;
  jobRuns: AgentRun[];
  historyLoading: boolean;
  sceneAppSummaryCard?: SceneAppAutomationWorkspaceCardViewModel | null;
  sceneAppRunDetailView?: SceneAppRunDetailViewModel | null;
  sceneAppLoading?: boolean;
  sceneAppError?: string | null;
  onOpenSceneAppDetail?: () => void;
  onOpenSceneAppGovernance?: () => void;
  onReviewCurrentProject?: () => void;
  sceneAppSavedAsInspiration?: boolean;
  onSaveSceneAppAsInspiration?: () => void;
  onOpenInspirationLibrary?: () => void;
  onSceneAppDeliveryArtifactAction?: (
    action: SceneAppRunDetailViewModel["deliveryArtifactEntries"][number],
  ) => void;
  onSceneAppGovernanceAction?: (
    action: SceneAppRunDetailViewModel["governanceActionEntries"][number],
  ) => void;
  onSceneAppGovernanceArtifactAction?: (
    action: SceneAppRunDetailViewModel["governanceArtifactEntries"][number],
  ) => void;
  onSceneAppEntryAction?: (
    action: NonNullable<SceneAppRunDetailViewModel["entryAction"]>,
  ) => void;
  onRefreshHistory: (jobId: string) => Promise<void> | void;
}

export function AutomationJobDetailsDialog({
  open,
  onOpenChange,
  job,
  workspaceName,
  serviceSkillContext,
  jobRuns,
  historyLoading,
  sceneAppSummaryCard = null,
  sceneAppRunDetailView = null,
  sceneAppLoading = false,
  sceneAppError = null,
  onOpenSceneAppDetail,
  onOpenSceneAppGovernance,
  onReviewCurrentProject,
  sceneAppSavedAsInspiration = false,
  onSaveSceneAppAsInspiration,
  onOpenInspirationLibrary,
  onSceneAppDeliveryArtifactAction,
  onSceneAppGovernanceAction,
  onSceneAppGovernanceArtifactAction,
  onSceneAppEntryAction,
  onRefreshHistory,
}: AutomationJobDetailsDialogProps) {
  const followupDestinations = sceneAppRunDetailView
    ? buildSceneAppExecutionFollowupDestinations(sceneAppRunDetailView)
    : [];
  const resolveFollowupDestinationAction = (
    destination: SceneAppExecutionFollowupDestination,
  ): { label: string; onClick: () => void } | null => {
    const action = destination.action;
    if (!action) {
      return null;
    }

    switch (action.kind) {
      case "review_current_project":
        return onReviewCurrentProject
          ? {
              label: action.label,
              onClick: onReviewCurrentProject,
            }
          : null;
      case "governance_action":
        return onSceneAppGovernanceAction
          ? {
              label: action.label,
              onClick: () => onSceneAppGovernanceAction(action.entry),
            }
          : null;
      case "governance_artifact":
        return onSceneAppGovernanceArtifactAction
          ? {
              label: action.label,
              onClick: () => onSceneAppGovernanceArtifactAction(action.entry),
            }
          : null;
      case "entry_action":
        return onSceneAppEntryAction
          ? {
              label: action.label,
              onClick: () => onSceneAppEntryAction(action.entry),
            }
          : null;
      case "delivery_artifact":
        return onSceneAppDeliveryArtifactAction
          ? {
              label: action.label,
              onClick: () => onSceneAppDeliveryArtifactAction(action.entry),
            }
          : null;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open && Boolean(job)} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-[1120px]"
        className="lime-workbench-theme-scope max-h-[calc(100vh-32px)] overflow-hidden rounded-[28px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-0"
      >
        {job ? (
          <div
            data-testid="automation-job-details-dialog"
            className="flex max-h-[calc(100vh-32px)] flex-col rounded-[28px] bg-white"
          >
            <DialogHeader className="shrink-0 border-b border-slate-200/70 bg-white px-4 py-4 sm:px-6 sm:py-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-[22px] font-semibold tracking-tight text-slate-900">
                    持续流程详情
                  </DialogTitle>
                  <WorkbenchInfoTip
                    ariaLabel="持续流程详情说明"
                    content="查看这条持续流程的状态、输出去向和最近运行；需要迁移旧浏览器流程时，也在这里确认遗留配置和风险提示。"
                    tone="mint"
                  />
                </div>
                <DialogDescription className="text-sm text-slate-500">
                  查看这条持续流程的状态、输出去向和最近运行。
                </DialogDescription>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    这条：{job.name}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    归属：{workspaceName ?? job.workspace_id}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    调度：{describeSchedule(job)}
                  </span>
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700">
                    方式：{payloadKindLabel(job.payload.kind)}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      isLegacyBrowserAutomation(job)
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    当前状态：{statusLabel(job.last_status)}
                  </span>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5">
              <div className="space-y-5">
                <div className="rounded-[22px] border border-slate-200/80 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900">
                        {job.name}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {workspaceName ?? job.workspace_id}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={statusVariant(job.last_status)}>
                        {statusLabel(job.last_status)}
                      </Badge>
                      {isLegacyBrowserAutomation(job) ? (
                        <Badge variant="outline">
                          {LEGACY_BROWSER_AUTOMATION_STATUS}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm text-slate-500 md:grid-cols-2 xl:grid-cols-3">
                    <div>开始方式: {payloadKindLabel(job.payload.kind)}</div>
                    {!isLegacyBrowserAutomation(job) ? (
                      <div>
                        权限模式: {describeAgentTurnAccessMode(job.payload)}
                      </div>
                    ) : null}
                    <div>调度: {describeSchedule(job)}</div>
                    <div>下次执行: {formatTime(job.next_run_at)}</div>
                    <div>最近执行: {formatTime(job.last_run_at)}</div>
                    <div className="md:col-span-2 xl:col-span-2">
                      最后错误: {job.last_error || "-"}
                    </div>
                  </div>
                  {isLegacyBrowserAutomation(job) ? (
                    <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                      <div className="font-medium text-amber-900">
                        浏览器自动化已下线
                      </div>
                      <div className="mt-2">
                        {LEGACY_BROWSER_AUTOMATION_NOTICE}
                      </div>
                    </div>
                  ) : null}
                </div>

                {serviceSkillContext ? (
                  <div className="rounded-[22px] border border-sky-200/80 bg-sky-50 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-900">
                        技能流程上下文
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          {serviceSkillContext.runnerLabel}
                        </Badge>
                        <Badge variant="outline">
                          {serviceSkillContext.executionLocationLabel}
                        </Badge>
                        {serviceSkillContext.executionLocationLegacyCompat ? (
                          <Badge variant="outline">
                            {LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_LABEL}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <div>技能: {serviceSkillContext.title}</div>
                      <div>目录来源: {serviceSkillContext.sourceLabel}</div>
                      <div>主题: {serviceSkillContext.theme || "-"}</div>
                      <div>
                        主稿绑定: {serviceSkillContext.contentId || "-"}
                      </div>
                    </div>
                    {serviceSkillContext.executionLocationLegacyCompat ? (
                      <div className="mt-3 text-xs leading-5 text-sky-700">
                        {LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_NOTE}
                      </div>
                    ) : null}
                    {serviceSkillContext.slotSummary.length ? (
                      <div className="mt-3 rounded-[16px] border border-slate-200/80 bg-white px-3 py-3">
                        <div className="text-xs font-medium text-slate-700">
                          参数摘要
                        </div>
                        <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-600 md:grid-cols-2">
                          {serviceSkillContext.slotSummary.map((item) => (
                            <div key={item.key}>
                              <span className="font-medium text-slate-700">
                                {item.label}
                              </span>
                              : {item.value}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {serviceSkillContext.userInput ? (
                      <div className="mt-3 rounded-[16px] border border-slate-200/80 bg-white px-3 py-3 text-sm leading-6 text-slate-600">
                        <div className="text-xs font-medium text-slate-700">
                          补充要求
                        </div>
                        <div className="mt-1">
                          {serviceSkillContext.userInput}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {sceneAppSummaryCard ||
                sceneAppRunDetailView ||
                sceneAppLoading ||
                sceneAppError ? (
                  <div className="space-y-4">
                    <div className="rounded-[22px] border border-lime-200/80 bg-lime-50/70 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            接回生成
                          </div>
                          <div className="mt-1 text-sm leading-6 text-slate-600">
                            这条持续流程已经接回生成；除了调度状态，还会继续回流这轮结果、结果材料和下一步判断。
                          </div>
                        </div>
                        {sceneAppSummaryCard ? (
                          <Badge variant="secondary">
                            {sceneAppSummaryCard.statusLabel}
                          </Badge>
                        ) : null}
                      </div>

                      {sceneAppLoading && !sceneAppSummaryCard ? (
                        <div className="mt-4 rounded-[18px] border border-dashed border-lime-200 bg-white/80 px-4 py-4 text-sm text-slate-600">
                          正在回流这条持续流程对应的做法摘要…
                        </div>
                      ) : null}

                      {sceneAppSummaryCard ? (
                        <>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <span className="rounded-full border border-white bg-white px-3 py-1 text-xs font-medium text-slate-700">
                              {sceneAppSummaryCard.title}
                            </span>
                          </div>

                          <div className="mt-4 rounded-[18px] border border-white bg-white/90 px-4 py-4">
                            <div className="text-sm leading-7 text-slate-800">
                              {sceneAppSummaryCard.summary}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-600">
                              先做：{sceneAppSummaryCard.nextAction}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-[18px] border border-white bg-white/90 px-4 py-3">
                              <div className="text-xs font-medium text-slate-500">
                                持续流程概览
                              </div>
                              <div className="mt-2 text-sm font-medium text-slate-900">
                                {sceneAppSummaryCard.automationSummary}
                              </div>
                            </div>
                            <div className="rounded-[18px] border border-white bg-white/90 px-4 py-3">
                              <div className="text-xs font-medium text-slate-500">
                                最近结果
                              </div>
                              <div className="mt-2 text-sm font-medium text-slate-900">
                                {sceneAppSummaryCard.latestAutomationLabel}
                              </div>
                            </div>
                          </div>

                          {sceneAppSummaryCard.scorecardAggregate ? (
                            <div
                              className="mt-4 rounded-[18px] border border-white bg-white/90 px-4 py-4"
                              data-testid="automation-sceneapp-scorecard-aggregate"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-xs font-medium text-slate-500">
                                  这轮判断
                                </div>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                                  {
                                    sceneAppSummaryCard.scorecardAggregate
                                      .statusLabel
                                  }
                                </span>
                                {sceneAppSummaryCard.scorecardAggregate
                                  .actionLabel ? (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                                    {
                                      sceneAppSummaryCard.scorecardAggregate
                                        .actionLabel
                                    }
                                  </span>
                                ) : null}
                                {sceneAppSummaryCard.scorecardAggregate
                                  .topFailureSignalLabel ? (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                                    {
                                      sceneAppSummaryCard.scorecardAggregate
                                        .topFailureSignalLabel
                                    }
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 text-sm leading-6 text-slate-800">
                                {sceneAppSummaryCard.scorecardAggregate.summary}
                              </div>
                              <div className="mt-2 text-sm leading-6 text-slate-600">
                                先做：
                                {
                                  sceneAppSummaryCard.scorecardAggregate
                                    .nextAction
                                }
                              </div>
                              {followupDestinations.length ? (
                                <div
                                  className="mt-4 grid gap-3 md:grid-cols-2"
                                  data-testid="automation-sceneapp-destination-actions"
                                >
                                  {followupDestinations.map((destination) => {
                                    const destinationAction =
                                      resolveFollowupDestinationAction(
                                        destination,
                                      );

                                    return (
                                      <article
                                        key={destination.key}
                                        className="rounded-[16px] border border-slate-200/80 bg-slate-50/70 px-3 py-3"
                                      >
                                        <div className="text-sm font-medium text-slate-900">
                                          {destination.label}
                                        </div>
                                        <div className="mt-2 text-xs leading-5 text-slate-600">
                                          {destination.description}
                                        </div>
                                        {destinationAction ? (
                                          <div className="mt-3">
                                            <Button
                                              type="button"
                                              size="sm"
                                              variant="outline"
                                              data-testid={`automation-sceneapp-destination-action-${destination.key}`}
                                              onClick={
                                                destinationAction.onClick
                                              }
                                            >
                                              {destinationAction.label}
                                            </Button>
                                          </div>
                                        ) : destination.key ===
                                          "automation-job" ? (
                                          <div className="mt-3 text-xs leading-5 text-slate-500">
                                            当前就在这条持续流程里，无需再跳转一次。
                                          </div>
                                        ) : null}
                                      </article>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={onOpenSceneAppDetail}
                            >
                              回补这轮信息
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={onOpenSceneAppGovernance}
                            >
                              看这轮结果
                            </Button>
                          </div>
                        </>
                      ) : null}

                      {sceneAppError && !sceneAppRunDetailView ? (
                        <div className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                          {sceneAppError}
                        </div>
                      ) : null}
                    </div>

                    <SceneAppRunDetailPanel
                      hasSelectedSceneApp={
                        Boolean(sceneAppSummaryCard) ||
                        sceneAppLoading ||
                        Boolean(sceneAppError)
                      }
                      runDetailView={sceneAppRunDetailView}
                      loading={sceneAppLoading}
                      error={sceneAppError}
                      savedAsInspiration={sceneAppSavedAsInspiration}
                      onSaveAsInspiration={onSaveSceneAppAsInspiration}
                      onOpenInspirationLibrary={onOpenInspirationLibrary}
                      onDeliveryArtifactAction={
                        onSceneAppDeliveryArtifactAction
                      }
                      onGovernanceAction={onSceneAppGovernanceAction}
                      onGovernanceArtifactAction={
                        onSceneAppGovernanceArtifactAction
                      }
                    />
                  </div>
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                  <div className="rounded-[18px] border border-slate-200/80 bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-900">
                        输出契约
                      </div>
                      <Badge
                        variant={
                          job.delivery.mode === "announce"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {deliveryModeLabel(job)}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-slate-500">
                      <div>
                        输出目标:{" "}
                        {job.delivery.mode === "announce"
                          ? deliveryChannelLabel(job.delivery.channel)
                          : "-"}
                      </div>
                      <div>
                        输出契约:{" "}
                        {outputSchemaLabel(resolveDeliveryOutputSchema(job))}
                      </div>
                      <div>
                        投递编码:{" "}
                        {outputFormatLabel(
                          resolveDeliveryOutputFormat(
                            job.delivery.output_format,
                          ),
                        )}
                      </div>
                      <div>
                        目标地址:{" "}
                        {job.delivery.mode === "announce"
                          ? job.delivery.target || "-"
                          : "-"}
                      </div>
                      <div>
                        失败策略:{" "}
                        {job.delivery.mode !== "announce"
                          ? "未启用"
                          : job.delivery.best_effort
                            ? "投递失败不阻塞本轮"
                            : "投递失败记为本轮失败"}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded-[18px] border px-4 py-3 ${deliveryToneClass(
                      job.last_delivery,
                    )}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-slate-900">
                        最近一次投递结果
                      </div>
                      <Badge
                        variant={
                          job.last_delivery
                            ? deliveryStatusVariant(job.last_delivery.success)
                            : "outline"
                        }
                      >
                        {job.last_delivery
                          ? job.last_delivery.success
                            ? "投递成功"
                            : "投递失败"
                          : "暂无记录"}
                      </Badge>
                    </div>
                    {job.last_delivery ? (
                      <>
                        <div className="mt-3 space-y-2 text-sm">
                          <div>
                            时间: {formatTime(job.last_delivery.attempted_at)}
                          </div>
                          <div>
                            渠道:{" "}
                            {deliveryChannelLabel(job.last_delivery.channel)}
                          </div>
                          <div>目标: {job.last_delivery.target || "-"}</div>
                          <div>
                            契约:{" "}
                            {outputSchemaLabel(job.last_delivery.output_schema)}{" "}
                            /{" "}
                            {outputFormatLabel(job.last_delivery.output_format)}
                          </div>
                          <div>
                            投递键:{" "}
                            {job.last_delivery.delivery_attempt_id || "-"}
                          </div>
                          <div>
                            执行重试:{" "}
                            {job.last_delivery.execution_retry_count ?? 0}
                            {" / "}
                            投递尝试: {job.last_delivery.delivery_attempts ?? 0}
                          </div>
                          <div>结果: {job.last_delivery.message}</div>
                        </div>
                        <div className="mt-3 whitespace-pre-wrap rounded-[14px] border border-slate-200/80 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                          {job.last_delivery.output_preview || "无输出预览"}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 text-sm leading-6">
                        {job.delivery.mode === "announce"
                          ? "这条持续流程还没产生投递记录。"
                          : "这条持续流程当前未启用输出投递。"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-200/80 bg-white px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">
                    当前起手内容
                  </div>
                  <div className="mt-3 whitespace-pre-wrap rounded-[14px] border border-slate-200/80 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600">
                    {describePayload(job.payload)}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">
                      最近运行
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void onRefreshHistory(job.id)}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />
                      刷新
                    </Button>
                  </div>

                  {historyLoading ? (
                    <div className="flex h-28 items-center justify-center rounded-[22px] border border-slate-200/80 bg-slate-50">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : jobRuns.length ? (
                    jobRuns.map((run) => {
                      const infoMessage = resolveRunInfoMessage(run);
                      const delivery = resolveRunDelivery(run);
                      const runServiceSkillContext =
                        resolveRunServiceSkillContext(run, serviceSkillContext);
                      const runServiceSkillTaskLine = runServiceSkillContext
                        ? describeServiceSkillTaskLine(runServiceSkillContext)
                        : null;
                      const runServiceSkillSlotPreview = runServiceSkillContext
                        ? describeServiceSkillSlotPreview(
                            runServiceSkillContext,
                          )
                        : null;

                      return (
                        <div
                          key={run.id}
                          className="rounded-[20px] border border-slate-200/80 bg-slate-50 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="text-sm text-slate-900">
                              {formatTime(run.started_at)}
                            </div>
                            <Badge variant={runStatusVariant(run)}>
                              {statusLabel(runDisplayStatus(run))}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                            <span>ID: {run.id}</span>
                            <span>
                              Session: {resolveRunSessionId(run) ?? "-"}
                            </span>
                            <span>完成: {formatTime(run.finished_at)}</span>
                          </div>
                          {infoMessage ? (
                            <div
                              className={`mt-3 rounded-[16px] border px-3 py-2 text-xs leading-5 ${runInfoToneClass(
                                run,
                              )}`}
                            >
                              {infoMessage}
                            </div>
                          ) : null}
                          {runServiceSkillContext ? (
                            <div
                              data-testid={`automation-run-service-skill-summary-${run.id}`}
                              className="mt-3 rounded-[16px] border border-sky-200/80 bg-sky-50 px-3 py-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-xs font-medium text-slate-900">
                                  技能流程运行上下文
                                </div>
                                <Badge variant="outline">
                                  {runServiceSkillContext.runnerLabel}
                                </Badge>
                                <Badge variant="outline">
                                  {
                                    runServiceSkillContext.executionLocationLabel
                                  }
                                </Badge>
                                {runServiceSkillContext.executionLocationLegacyCompat ? (
                                  <Badge variant="outline">
                                    {
                                      LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_LABEL
                                    }
                                  </Badge>
                                ) : null}
                              </div>
                              {runServiceSkillTaskLine ? (
                                <div className="mt-2 text-xs leading-5 text-slate-700">
                                  {runServiceSkillTaskLine}
                                </div>
                              ) : null}
                              {runServiceSkillContext.executionLocationLegacyCompat ? (
                                <div className="mt-1 text-xs leading-5 text-sky-700">
                                  {LEGACY_SERVICE_SKILL_EXECUTION_COMPAT_NOTE}
                                </div>
                              ) : null}
                              {runServiceSkillSlotPreview ? (
                                <div className="mt-1 text-xs leading-5 text-slate-600">
                                  参数摘要: {runServiceSkillSlotPreview}
                                </div>
                              ) : null}
                              {runServiceSkillContext.userInput ? (
                                <div className="mt-1 text-xs leading-5 text-slate-500">
                                  补充要求: {runServiceSkillContext.userInput}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {delivery ? (
                            <div
                              className={`mt-3 rounded-[16px] border px-3 py-2 ${deliveryToneClass(
                                delivery,
                              )}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                                <span>
                                  输出投递 /{" "}
                                  {deliveryChannelLabel(delivery.channel)}
                                </span>
                                <Badge
                                  variant={deliveryStatusVariant(
                                    delivery.success,
                                  )}
                                >
                                  {delivery.success ? "成功" : "失败"}
                                </Badge>
                              </div>
                              <div className="mt-2 text-xs leading-5">
                                {delivery.message}
                              </div>
                            </div>
                          ) : null}
                          {run.error_message ? (
                            <div className="mt-3 rounded-[16px] border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-600">
                              <div className="font-medium">失败原因</div>
                              <div className="mt-1">{run.error_message}</div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                      还没有运行记录。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
