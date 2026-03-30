import { RefreshCw } from "lucide-react";
import type { AutomationJobRecord } from "@/lib/api/automation";
import type { AgentRun } from "@/lib/api/executionRun";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AutomationServiceSkillContext } from "./serviceSkillContext";
import {
  LEGACY_BROWSER_AUTOMATION_NOTICE,
  LEGACY_BROWSER_AUTOMATION_STATUS,
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
  onRefreshHistory,
}: AutomationJobDetailsDialogProps) {
  return (
    <Dialog open={open && Boolean(job)} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-[1120px]"
        className="max-h-[calc(100vh-32px)] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-0"
      >
        {job ? (
          <div
            data-testid="automation-job-details-dialog"
            className="flex max-h-[calc(100vh-32px)] flex-col rounded-[28px] bg-[linear-gradient(135deg,rgba(246,250,244,0.96)_0%,rgba(255,255,255,0.98)_48%,rgba(241,247,255,0.98)_100%)]"
          >
            <DialogHeader className="shrink-0 border-b border-slate-200/70 px-4 py-4 sm:px-6 sm:py-5">
              <DialogTitle>任务详情与历史</DialogTitle>
              <DialogDescription className="space-y-1 text-sm leading-6 text-slate-500">
                <span className="block font-medium text-slate-900">
                  {job.name}
                </span>
                <span className="block">
                  {workspaceName ?? job.workspace_id} · {describeSchedule(job)} ·{" "}
                  {payloadKindLabel(job.payload.kind)}
                </span>
              </DialogDescription>
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
                    <div>任务类型: {payloadKindLabel(job.payload.kind)}</div>
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
                        技能任务上下文
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                          {serviceSkillContext.runnerLabel}
                        </Badge>
                        <Badge variant="outline">
                          {serviceSkillContext.executionLocationLabel}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <div>技能项: {serviceSkillContext.title}</div>
                      <div>目录来源: {serviceSkillContext.sourceLabel}</div>
                      <div>工作主题: {serviceSkillContext.theme || "-"}</div>
                      <div>主稿绑定: {serviceSkillContext.contentId || "-"}</div>
                    </div>
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
                        <div className="mt-1">{serviceSkillContext.userInput}</div>
                      </div>
                    ) : null}
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
                          job.delivery.mode === "announce" ? "secondary" : "outline"
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
                          resolveDeliveryOutputFormat(job.delivery.output_format),
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
                            ? "投递失败不阻塞任务"
                            : "投递失败记为任务失败"}
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
                          <div>时间: {formatTime(job.last_delivery.attempted_at)}</div>
                          <div>
                            渠道: {deliveryChannelLabel(job.last_delivery.channel)}
                          </div>
                          <div>目标: {job.last_delivery.target || "-"}</div>
                          <div>
                            契约:{" "}
                            {outputSchemaLabel(job.last_delivery.output_schema)} /{" "}
                            {outputFormatLabel(job.last_delivery.output_format)}
                          </div>
                          <div>
                            投递键: {job.last_delivery.delivery_attempt_id || "-"}
                          </div>
                          <div>
                            执行重试: {job.last_delivery.execution_retry_count ?? 0}
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
                          ? "任务尚未产生投递记录。"
                          : "当前任务未启用输出投递。"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[18px] border border-slate-200/80 bg-white px-4 py-3">
                  <div className="text-sm font-medium text-slate-900">
                    当前 payload
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
                      const runServiceSkillContext = resolveRunServiceSkillContext(
                        run,
                        serviceSkillContext,
                      );
                      const runServiceSkillTaskLine = runServiceSkillContext
                        ? describeServiceSkillTaskLine(runServiceSkillContext)
                        : null;
                      const runServiceSkillSlotPreview = runServiceSkillContext
                        ? describeServiceSkillSlotPreview(runServiceSkillContext)
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
                            <span>Session: {resolveRunSessionId(run) ?? "-"}</span>
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
                                  技能任务运行上下文
                                </div>
                                <Badge variant="outline">
                                  {runServiceSkillContext.runnerLabel}
                                </Badge>
                                <Badge variant="outline">
                                  {runServiceSkillContext.executionLocationLabel}
                                </Badge>
                              </div>
                              {runServiceSkillTaskLine ? (
                                <div className="mt-2 text-xs leading-5 text-slate-700">
                                  {runServiceSkillTaskLine}
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
                                  输出投递 / {deliveryChannelLabel(delivery.channel)}
                                </span>
                                <Badge
                                  variant={deliveryStatusVariant(delivery.success)}
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
