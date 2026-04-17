import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AutomationExecutionMode,
  AutomationJobRecord,
  AutomationJobRequest,
  AutomationOutputFormat,
  AutomationOutputSchema,
  AutomationPayload,
  BrowserSessionAutomationPayload,
  TaskSchedule,
  UpdateAutomationJobRequest,
  type DeliveryConfig,
} from "@/lib/api/automation";
import type { Project } from "@/lib/api/project";
import { createRuntimePoliciesFromAccessMode } from "@/components/agent/chat/utils/accessModeRuntime";
import {
  DEFAULT_AGENT_ACCESS_MODE,
  type AgentAccessMode,
} from "@/components/agent/chat/hooks/agentChatStorage";
import {
  AUTOMATION_ACCESS_MODE_OPTIONS,
  automationAccessModeLabel,
  automationAccessModePolicySummary,
  omitLegacyAutomationAccessModeMetadata,
  resolveAgentTurnAutomationAccessMode,
} from "./automationAccessMode";

export type AutomationJobDialogSubmit =
  | { mode: "create"; request: AutomationJobRequest }
  | { mode: "edit"; id: string; request: UpdateAutomationJobRequest };

type ScheduleKind = TaskSchedule["kind"];

type AutomationJobFormState = {
  name: string;
  description: string;
  enabled: boolean;
  workspace_id: string;
  execution_mode: AutomationExecutionMode;
  payload_kind: AutomationPayload["kind"];
  schedule_kind: ScheduleKind;
  every_secs: string;
  cron_expr: string;
  cron_tz: string;
  at_local: string;
  prompt: string;
  system_prompt: string;
  web_search: boolean;
  agent_content_id: string;
  agent_access_mode: AgentAccessMode;
  agent_request_metadata: Record<string, unknown> | null;
  timeout_secs: string;
  max_retries: string;
  delivery_mode: "none" | "announce";
  delivery_channel: "webhook" | "telegram" | "local_file" | "google_sheets";
  delivery_target: string;
  delivery_output_schema: AutomationOutputSchema;
  delivery_output_format: AutomationOutputFormat;
  best_effort: boolean;
};

export type AutomationJobDialogInitialValues = Partial<AutomationJobFormState>;

const TEXT_ONLY_DELIVERY_CHANNEL = "telegram";
const LEGACY_BROWSER_AUTOMATION_MESSAGE =
  "浏览器自动化已下线，系统不会再自动启动 Chrome。请删除这条旧任务，并改用 Agent 对话任务重建。";

function toDateTimeLocal(value?: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function createDefaultForm(workspaces: Project[]): AutomationJobFormState {
  return {
    name: "",
    description: "",
    enabled: true,
    workspace_id: workspaces[0]?.id ?? "",
    execution_mode: "intelligent",
    payload_kind: "agent_turn",
    schedule_kind: "every",
    every_secs: "300",
    cron_expr: "0 9 * * *",
    cron_tz: "Asia/Shanghai",
    at_local: "",
    prompt: "",
    system_prompt: "",
    web_search: false,
    agent_content_id: "",
    agent_access_mode: DEFAULT_AGENT_ACCESS_MODE,
    agent_request_metadata: null,
    timeout_secs: "",
    max_retries: "3",
    delivery_mode: "none",
    delivery_channel: "webhook",
    delivery_target: "",
    delivery_output_schema: "text",
    delivery_output_format: "text",
    best_effort: true,
  };
}

function createCreateForm(
  workspaces: Project[],
  initialValues?: AutomationJobDialogInitialValues | null,
): AutomationJobFormState {
  return {
    ...createDefaultForm(workspaces),
    ...(initialValues ?? {}),
    payload_kind: "agent_turn",
  };
}

function normalizeDeliveryOutputSchema(
  schema?: string | null,
  format?: AutomationOutputFormat | null,
): AutomationOutputSchema {
  switch (schema) {
    case "json":
    case "table":
    case "csv":
    case "links":
    case "text":
      return schema;
    default:
      return format === "json" ? "json" : "text";
  }
}

function normalizeDeliveryOutputContract(
  channel: AutomationJobFormState["delivery_channel"],
  outputSchema: AutomationOutputSchema,
  outputFormat: AutomationOutputFormat,
): {
  outputSchema: AutomationOutputSchema;
  outputFormat: AutomationOutputFormat;
} {
  if (channel === TEXT_ONLY_DELIVERY_CHANNEL) {
    return {
      outputSchema: "text",
      outputFormat: "text",
    };
  }
  return {
    outputSchema,
    outputFormat,
  };
}

function buildDeliveryConfig(form: AutomationJobFormState): DeliveryConfig {
  if (form.delivery_mode !== "announce") {
    return {
      mode: "none",
      channel: null,
      target: null,
      best_effort: true,
      output_schema: "text",
      output_format: "text",
    };
  }

  const contract = normalizeDeliveryOutputContract(
    form.delivery_channel,
    form.delivery_output_schema,
    form.delivery_output_format,
  );

  return {
    mode: "announce",
    channel: form.delivery_channel,
    target: form.delivery_target.trim() || null,
    best_effort: form.best_effort,
    output_schema: contract.outputSchema,
    output_format: contract.outputFormat,
  };
}

function createFormFromJob(
  job: AutomationJobRecord,
  workspaces: Project[],
): AutomationJobFormState {
  const form = createDefaultForm(workspaces);
  form.name = job.name;
  form.description = job.description ?? "";
  form.enabled = job.enabled;
  form.workspace_id = job.workspace_id;
  form.execution_mode = job.execution_mode;
  form.payload_kind = job.payload.kind;
  if (job.payload.kind === "agent_turn") {
    form.prompt = job.payload.prompt;
    form.system_prompt = job.payload.system_prompt ?? "";
    form.web_search = job.payload.web_search;
    form.agent_content_id = job.payload.content_id ?? "";
    form.agent_access_mode = resolveAgentTurnAutomationAccessMode(job.payload);
    form.agent_request_metadata = job.payload.request_metadata ?? null;
  }
  form.timeout_secs = job.timeout_secs ? String(job.timeout_secs) : "";
  form.max_retries = String(job.max_retries);
  form.delivery_mode = job.delivery.mode === "announce" ? "announce" : "none";
  form.delivery_channel =
    job.delivery.channel === "telegram"
      ? "telegram"
      : job.delivery.channel === "google_sheets"
        ? "google_sheets"
        : job.delivery.channel === "local_file"
          ? "local_file"
          : "webhook";
  form.delivery_target = job.delivery.target ?? "";
  const deliveryOutputContract = normalizeDeliveryOutputContract(
    form.delivery_channel,
    normalizeDeliveryOutputSchema(
      job.delivery.output_schema,
      job.delivery.output_format,
    ),
    job.delivery.output_format === "json" ? "json" : "text",
  );
  form.delivery_output_schema = deliveryOutputContract.outputSchema;
  form.delivery_output_format = deliveryOutputContract.outputFormat;
  form.best_effort = job.delivery.best_effort;

  if (job.schedule.kind === "every") {
    form.schedule_kind = "every";
    form.every_secs = String(job.schedule.every_secs);
  } else if (job.schedule.kind === "cron") {
    form.schedule_kind = "cron";
    form.cron_expr = job.schedule.expr;
    form.cron_tz = job.schedule.tz ?? "";
  } else {
    form.schedule_kind = "at";
    form.at_local = toDateTimeLocal(job.schedule.at);
  }

  return form;
}

function buildSchedule(form: AutomationJobFormState): TaskSchedule {
  if (form.schedule_kind === "every") {
    const every_secs = Number(form.every_secs);
    if (!Number.isFinite(every_secs) || every_secs < 60) {
      throw new Error("轮询间隔不能小于 60 秒");
    }
    return { kind: "every", every_secs };
  }

  if (form.schedule_kind === "cron") {
    if (!form.cron_expr.trim()) {
      throw new Error("Cron 表达式不能为空");
    }
    return {
      kind: "cron",
      expr: form.cron_expr.trim(),
      tz: form.cron_tz.trim() || null,
    };
  }

  if (!form.at_local) {
    throw new Error("一次性任务时间不能为空");
  }

  const date = new Date(form.at_local);
  if (Number.isNaN(date.getTime())) {
    throw new Error("一次性任务时间格式无效");
  }

  return {
    kind: "at",
    at: date.toISOString(),
  };
}

function scheduleHint(form: AutomationJobFormState): string {
  if (form.schedule_kind === "every") {
    const secs = Number(form.every_secs);
    if (!Number.isFinite(secs) || secs <= 0) {
      return "按固定秒级间隔轮询。";
    }
    if (secs % 3600 === 0) {
      return `每 ${secs / 3600} 小时执行一次`;
    }
    if (secs % 60 === 0) {
      return `每 ${secs / 60} 分钟执行一次`;
    }
    return `每 ${secs} 秒执行一次`;
  }
  if (form.schedule_kind === "cron") {
    return "使用 Cron 表达式驱动执行。";
  }
  return form.at_local
    ? "一次性任务，到点后自动停用。"
    : "选择一次性触发时间。";
}

function buildLegacyBrowserPayloadSummary(
  payload: BrowserSessionAutomationPayload,
): Array<{ label: string; value: string }> {
  return [
    {
      label: "浏览器资料",
      value: payload.profile_key ?? payload.profile_id,
    },
    {
      label: "启动地址",
      value: payload.url?.trim() || "使用资料默认启动地址",
    },
    {
      label: "环境预设",
      value: payload.environment_preset_id?.trim() || "未设置",
    },
    {
      label: "Target ID",
      value: payload.target_id?.trim() || "未设置",
    },
    {
      label: "调试窗口",
      value: payload.open_window ? "打开" : "关闭",
    },
    {
      label: "流模式",
      value: payload.stream_mode,
    },
  ];
}

export function AutomationJobDialog({
  open,
  mode,
  job,
  workspaces,
  initialValues,
  saving,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  job?: AutomationJobRecord | null;
  workspaces: Project[];
  initialValues?: AutomationJobDialogInitialValues | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: AutomationJobDialogSubmit) => Promise<void>;
}) {
  const [form, setForm] = useState<AutomationJobFormState>(() =>
    createCreateForm(workspaces, initialValues),
  );
  const [error, setError] = useState<string | null>(null);
  const isLegacyBrowserJob =
    mode === "edit" && job?.payload.kind === "browser_session";
  const legacyBrowserPayload =
    isLegacyBrowserJob && job?.payload.kind === "browser_session"
      ? job.payload
      : null;
  const legacyBrowserSummary = useMemo(
    () =>
      legacyBrowserPayload
        ? buildLegacyBrowserPayloadSummary(legacyBrowserPayload)
        : [],
    [legacyBrowserPayload],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    setForm(
      mode === "edit" && job
        ? createFormFromJob(job, workspaces)
        : createCreateForm(workspaces, initialValues),
    );
  }, [initialValues, job, mode, open, workspaces]);

  const scheduleSummary = useMemo(() => scheduleHint(form), [form]);
  const isTextOnlyDelivery =
    form.delivery_channel === TEXT_ONLY_DELIVERY_CHANNEL;
  const workspaceLabel = useMemo(
    () =>
      workspaces.find((workspace) => workspace.id === form.workspace_id)
        ?.name ??
      form.workspace_id ??
      "未选择",
    [form.workspace_id, workspaces],
  );
  const dialogTitle = mode === "create" ? "新建自动化任务" : "编辑自动化任务";
  const dialogSummary = isLegacyBrowserJob
    ? "查看历史配置快照并迁移到新的 Agent 对话任务。"
    : "配置任务名称、调度、提示词和输出投递。";
  const dialogTipContent = isLegacyBrowserJob
    ? "浏览器自动化已下线，当前弹窗只保留历史配置展示与迁移参考，不允许继续保存。"
    : "用结构化 job 承载 Agent 对话任务，统一管理调度、工作区、输出投递和运行历史。";
  const scheduleKindLabel =
    form.schedule_kind === "every"
      ? "固定间隔"
      : form.schedule_kind === "cron"
        ? "Cron"
        : "一次性";
  const accessModeLabel = automationAccessModeLabel(form.agent_access_mode);

  async function handleSubmit() {
    try {
      setError(null);

      if (isLegacyBrowserJob) {
        throw new Error(LEGACY_BROWSER_AUTOMATION_MESSAGE);
      }

      if (!form.name.trim()) {
        throw new Error("任务名称不能为空");
      }
      if (!form.workspace_id.trim()) {
        throw new Error("请选择工作区");
      }

      const schedule = buildSchedule(form);
      if (!form.prompt.trim()) {
        throw new Error("任务提示词不能为空");
      }
      const runtimePolicies = createRuntimePoliciesFromAccessMode(
        form.agent_access_mode,
      );
      const payload: AutomationPayload = {
        kind: "agent_turn",
        prompt: form.prompt.trim(),
        system_prompt: form.system_prompt.trim() || null,
        web_search: form.web_search,
        content_id: form.agent_content_id.trim() || null,
        approval_policy: runtimePolicies.approvalPolicy,
        sandbox_policy: runtimePolicies.sandboxPolicy,
        request_metadata: omitLegacyAutomationAccessModeMetadata(
          form.agent_request_metadata,
        ),
      };
      const timeout_secs = form.timeout_secs.trim()
        ? Number(form.timeout_secs)
        : null;
      const max_retries = Number(form.max_retries);

      if (
        timeout_secs !== null &&
        (!Number.isFinite(timeout_secs) || timeout_secs <= 0)
      ) {
        throw new Error("超时时间必须为正整数");
      }
      if (!Number.isFinite(max_retries) || max_retries < 1) {
        throw new Error("最大重试次数不能小于 1");
      }
      if (form.delivery_mode === "announce" && !form.delivery_target.trim()) {
        throw new Error("请输入输出目标");
      }
      const delivery = buildDeliveryConfig(form);

      if (mode === "create") {
        await onSubmit({
          mode: "create",
          request: {
            name: form.name.trim(),
            description: form.description.trim() || null,
            enabled: form.enabled,
            workspace_id: form.workspace_id,
            execution_mode: form.execution_mode,
            schedule,
            payload,
            delivery,
            timeout_secs,
            max_retries,
          },
        });
      } else if (job) {
        await onSubmit({
          mode: "edit",
          id: job.id,
          request: {
            name: form.name.trim(),
            description: form.description.trim() || null,
            enabled: form.enabled,
            workspace_id: form.workspace_id,
            execution_mode: form.execution_mode,
            schedule,
            payload,
            delivery,
            timeout_secs: timeout_secs ?? undefined,
            clear_timeout_secs: timeout_secs === null,
            max_retries,
          },
        });
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "保存任务失败",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        maxWidth="max-w-[820px]"
        className="max-h-[calc(100vh-32px)] overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-0"
      >
        <div className="flex max-h-[calc(100vh-32px)] flex-col rounded-[28px] bg-white">
          <DialogHeader className="shrink-0 border-b border-slate-200/70 bg-white px-4 py-4 sm:px-6 sm:py-5">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-[22px] font-semibold tracking-tight text-slate-900">
                  {dialogTitle}
                </DialogTitle>
                <WorkbenchInfoTip
                  ariaLabel="自动化任务弹窗说明"
                  content={dialogTipContent}
                  tone="mint"
                />
              </div>
              <DialogDescription className="text-sm text-slate-500">
                {dialogSummary}
              </DialogDescription>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  工作区：{workspaceLabel}
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  调度：{scheduleKindLabel}
                </span>
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    isLegacyBrowserJob
                      ? "border-amber-200 bg-amber-50 text-amber-700"
                      : "border-sky-200 bg-sky-50 text-sky-700"
                  }`}
                >
                  任务类型：
                  {isLegacyBrowserJob
                    ? "浏览器自动化（已下线）"
                    : "Agent 对话任务"}
                </span>
                <span
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    form.delivery_mode === "announce"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600"
                  }`}
                >
                  输出投递：
                  {form.delivery_mode === "announce" ? "已启用" : "未启用"}
                </span>
                {!isLegacyBrowserJob ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                    权限：{accessModeLabel}
                  </span>
                ) : null}
                {!isLegacyBrowserJob ? (
                  <span
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                      form.enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    任务状态：{form.enabled ? "已启用" : "已停用"}
                  </span>
                ) : null}
              </div>
            </div>
          </DialogHeader>

          <div
            data-testid="automation-job-dialog-scroll-area"
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 sm:px-6 sm:pb-6 sm:pt-5"
          >
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="automation-job-name">任务名称</Label>
                <Input
                  id="automation-job-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如：每日品牌线索巡检"
                />
              </div>
              <div className="space-y-2">
                <Label>工作区</Label>
                <Select
                  value={form.workspace_id}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, workspace_id: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择工作区" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces.map((workspace) => (
                      <SelectItem key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <Label htmlFor="automation-job-description">任务描述</Label>
              <Textarea
                id="automation-job-description"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="说明 automation 触发后希望得到什么结果"
                className="min-h-[90px]"
              />
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-4">
              <div className="space-y-2">
                <Label>任务类型</Label>
                <Select value={form.payload_kind} disabled>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent_turn">Agent 对话任务</SelectItem>
                    {isLegacyBrowserJob ? (
                      <SelectItem value="browser_session">
                        浏览器自动化（已下线）
                      </SelectItem>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>执行模式</Label>
                <Select
                  value={form.execution_mode}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      execution_mode: value as AutomationExecutionMode,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="intelligent">智能执行</SelectItem>
                    <SelectItem value="skill">技能执行</SelectItem>
                    <SelectItem value="log_only">只记录</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>最大重试</Label>
                <Input
                  value={form.max_retries}
                  type="number"
                  min={1}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      max_retries: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>超时秒数</Label>
                <Input
                  value={form.timeout_secs}
                  type="number"
                  min={1}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timeout_secs: event.target.value,
                    }))
                  }
                  placeholder="留空表示不限制"
                />
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
              <div className="grid gap-5 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>调度方式</Label>
                  <Select
                    value={form.schedule_kind}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        schedule_kind: value as ScheduleKind,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="every">固定间隔</SelectItem>
                      <SelectItem value="cron">Cron</SelectItem>
                      <SelectItem value="at">一次性</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.schedule_kind === "every" ? (
                  <div className="space-y-2 md:col-span-2">
                    <Label>间隔秒数</Label>
                    <Input
                      value={form.every_secs}
                      type="number"
                      min={60}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          every_secs: event.target.value,
                        }))
                      }
                    />
                  </div>
                ) : null}

                {form.schedule_kind === "cron" ? (
                  <>
                    <div className="space-y-2 md:col-span-2">
                      <Label>Cron 表达式</Label>
                      <Input
                        value={form.cron_expr}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            cron_expr: event.target.value,
                          }))
                        }
                        placeholder="0 9 * * *"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>时区</Label>
                      <Input
                        value={form.cron_tz}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            cron_tz: event.target.value,
                          }))
                        }
                        placeholder="Asia/Shanghai"
                      />
                    </div>
                  </>
                ) : null}

                {form.schedule_kind === "at" ? (
                  <div className="space-y-2 md:col-span-2">
                    <Label>触发时间</Label>
                    <Input
                      value={form.at_local}
                      type="datetime-local"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          at_local: event.target.value,
                        }))
                      }
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-3 text-xs text-slate-500">
                {scheduleSummary}
              </div>
            </div>

            {isLegacyBrowserJob && legacyBrowserPayload ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
                  <div className="font-medium text-amber-900">
                    浏览器自动化已下线
                  </div>
                  <div className="mt-2">
                    {LEGACY_BROWSER_AUTOMATION_MESSAGE}
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50 px-4 py-4">
                  <div className="text-sm font-medium text-slate-900">
                    历史配置快照
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                    {legacyBrowserSummary.map((item) => (
                      <div key={item.label}>
                        <span className="font-medium text-slate-900">
                          {item.label}
                        </span>
                        : {item.value}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs leading-5 text-slate-500">
                    这份配置只保留展示，不允许继续保存或执行。
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-5 space-y-2">
                  <Label htmlFor="automation-job-prompt">执行提示词</Label>
                  <Textarea
                    id="automation-job-prompt"
                    value={form.prompt}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        prompt: event.target.value,
                      }))
                    }
                    placeholder="描述自动化真正要执行的工作内容"
                    className="min-h-[120px] sm:min-h-[140px]"
                  />
                </div>

                <div className="mt-5 space-y-2">
                  <Label htmlFor="automation-job-system-prompt">
                    附加系统指令
                  </Label>
                  <Textarea
                    id="automation-job-system-prompt"
                    value={form.system_prompt}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        system_prompt: event.target.value,
                      }))
                    }
                    placeholder="可选，控制这条 automation 的执行风格"
                    className="min-h-[96px] sm:min-h-[110px]"
                  />
                </div>
                <div className="mt-5 grid gap-4 rounded-[24px] border border-slate-200/80 bg-white/80 p-4 md:grid-cols-3">
                  <div className="flex items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        启用任务
                      </div>
                      <div className="text-xs text-slate-500">
                        关闭后 job 不参与轮询
                      </div>
                    </div>
                    <Switch
                      checked={form.enabled}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({ ...current, enabled: checked }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        允许 Web 搜索
                      </div>
                      <div className="text-xs text-slate-500">
                        为这个 job 单独开启搜索能力
                      </div>
                    </div>
                    <Switch
                      checked={form.web_search}
                      onCheckedChange={(checked) =>
                        setForm((current) => ({
                          ...current,
                          web_search: checked,
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <div className="text-sm font-medium text-slate-900">
                      权限模式
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {automationAccessModePolicySummary(
                        form.agent_access_mode,
                      )}
                    </div>
                    <div className="mt-3">
                      <Select
                        value={form.agent_access_mode}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            agent_access_mode: value as AgentAccessMode,
                          }))
                        }
                      >
                        <SelectTrigger aria-label="自动化权限模式">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AUTOMATION_ACCESS_MODE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-white/80 p-4">
                  <div className="grid gap-5 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label>输出模式</Label>
                      <Select
                        value={form.delivery_mode}
                        onValueChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            delivery_mode: value as "none" | "announce",
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">关闭</SelectItem>
                          <SelectItem value="announce">
                            任务完成后投递
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {form.delivery_mode === "announce" ? (
                      <>
                        <div className="space-y-2">
                          <Label>输出目标</Label>
                          <Select
                            value={form.delivery_channel}
                            onValueChange={(value) =>
                              setForm((current) => {
                                const deliveryChannel = value as
                                  | "webhook"
                                  | "telegram"
                                  | "local_file"
                                  | "google_sheets";
                                const contract =
                                  normalizeDeliveryOutputContract(
                                    deliveryChannel,
                                    current.delivery_output_schema,
                                    current.delivery_output_format,
                                  );
                                return {
                                  ...current,
                                  delivery_channel: deliveryChannel,
                                  delivery_output_schema: contract.outputSchema,
                                  delivery_output_format: contract.outputFormat,
                                };
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="webhook">Webhook</SelectItem>
                              <SelectItem value="google_sheets">
                                Google Sheets
                              </SelectItem>
                              <SelectItem value="local_file">
                                本地文件
                              </SelectItem>
                              <SelectItem value="telegram">Telegram</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>输出契约</Label>
                          <Select
                            disabled={isTextOnlyDelivery}
                            value={form.delivery_output_schema}
                            onValueChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                delivery_output_schema:
                                  value as AutomationOutputSchema,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">文本摘要</SelectItem>
                              <SelectItem value="json">JSON 对象</SelectItem>
                              <SelectItem value="table">表格</SelectItem>
                              <SelectItem value="csv">CSV</SelectItem>
                              <SelectItem value="links">链接列表</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>输出格式</Label>
                          <Select
                            disabled={isTextOnlyDelivery}
                            value={form.delivery_output_format}
                            onValueChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                delivery_output_format:
                                  value as AutomationOutputFormat,
                              }))
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">文本摘要</SelectItem>
                              <SelectItem value="json">结构化 JSON</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {form.delivery_mode === "announce" ? (
                    <>
                      <div className="mt-4 space-y-2">
                        <Label>目标地址</Label>
                        <Input
                          value={form.delivery_target}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              delivery_target: event.target.value,
                            }))
                          }
                          placeholder={
                            form.delivery_channel === "telegram"
                              ? "bot_token:chat_id"
                              : form.delivery_channel === "google_sheets"
                                ? "spreadsheet_id=...;sheet=AgentOutput;credentials_file=ABSOLUTE_PATH_TO_SERVICE_ACCOUNT.json"
                                : form.delivery_channel === "local_file"
                                  ? "输入输出文件绝对路径"
                                  : "https://example.com/webhook"
                          }
                        />
                      </div>
                      <div className="mt-4 flex items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            投递失败不阻塞任务
                          </div>
                          <div className="text-xs text-slate-500">
                            关闭后投递失败也会记为 job 执行失败
                          </div>
                        </div>
                        <Switch
                          checked={form.best_effort}
                          onCheckedChange={(checked) =>
                            setForm((current) => ({
                              ...current,
                              best_effort: checked,
                            }))
                          }
                        />
                      </div>
                      <div className="mt-4 rounded-[18px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-xs leading-5 text-slate-500">
                        {form.delivery_channel === "webhook"
                          ? "Webhook 适合系统对接；当前会携带 output_schema、output_format、结构化 output_data，以及稳定的 delivery_attempt_id 幂等键。"
                          : form.delivery_channel === "google_sheets"
                            ? "Google Sheets 使用 service account 直连，目标格式为 spreadsheet_id=...;sheet=...;credentials_file=绝对路径，可选 include_header=true 和 value_input_option=USER_ENTERED；追加行会自动带 delivery_attempt_id 等元数据列。"
                            : form.delivery_channel === "local_file"
                              ? "本地文件适合先落最小输出闭环；text 会按契约渲染，json 会写入结构化 payload。"
                              : "Telegram 继续作为兼容通知通道，只发送文本提醒，不承诺结构化输出契约。"}
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            )}

            {error ? (
              <div className="mt-5 rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {error}
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-200/70 bg-white/92 px-4 py-4 sm:px-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving || isLegacyBrowserJob}
            >
              {saving
                ? "保存中..."
                : isLegacyBrowserJob
                  ? "该类型不可保存"
                  : mode === "create"
                    ? "创建任务"
                    : "保存修改"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
