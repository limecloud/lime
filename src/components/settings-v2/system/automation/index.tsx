import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  Bot,
  FileText,
  Globe,
  History,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AutomationHealthResult,
  AutomationJobRecord,
  AutomationLastDeliveryRecord,
  AutomationOutputFormat,
  AutomationOutputSchema,
  AutomationPayload,
  AutomationSchedulerConfig,
  AutomationStatus,
  createAutomationJob,
  deleteAutomationJob,
  getAutomationHealth,
  getAutomationJobs,
  getAutomationRunHistory,
  getAutomationSchedulerConfig,
  getAutomationStatus,
  runAutomationJobNow,
  updateAutomationJob,
  updateAutomationSchedulerConfig,
} from "@/lib/api/automation";
import type { Project } from "@/lib/api/project";
import { listProjects } from "@/lib/api/project";
import type { AgentRun } from "@/lib/api/executionRun";
import { LatestRunStatusBadge } from "@/components/execution/LatestRunStatusBadge";
import { BrowserRuntimeDebugPanel } from "@/features/browser-runtime";
import {
  getChromeProfileSessions,
  type ChromeProfileSessionInfo,
} from "@/lib/webview-api";
import { AutomationHealthPanel } from "./AutomationHealthPanel";
import {
  AutomationJobDialog,
  AutomationJobDialogSubmit,
  type AutomationJobDialogInitialValues,
} from "./AutomationJobDialog";

function formatTime(value?: string | null): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function describeSchedule(job: AutomationJobRecord): string {
  if (job.schedule.kind === "every") {
    const secs = job.schedule.every_secs;
    if (secs % 3600 === 0) {
      return `每 ${secs / 3600} 小时`;
    }
    if (secs % 60 === 0) {
      return `每 ${secs / 60} 分钟`;
    }
    return `每 ${secs} 秒`;
  }
  if (job.schedule.kind === "cron") {
    return `Cron: ${job.schedule.expr}`;
  }
  return `一次性: ${formatTime(job.schedule.at)}`;
}

function executionModeLabel(
  mode: AutomationJobRecord["execution_mode"],
): string {
  switch (mode) {
    case "intelligent":
      return "智能执行";
    case "skill":
      return "技能执行";
    case "log_only":
      return "只记录";
    default:
      return mode;
  }
}

function payloadKindLabel(kind: AutomationPayload["kind"]): string {
  return kind === "browser_session" ? "浏览器会话任务" : "Agent 对话任务";
}

function describePayload(payload: AutomationPayload): string {
  if (payload.kind === "agent_turn") {
    return payload.prompt;
  }

  const lines = [`资料: ${payload.profile_key ?? payload.profile_id}`];
  if (payload.environment_preset_id) {
    lines.push(`环境预设: ${payload.environment_preset_id}`);
  }
  if (payload.url) {
    lines.push(`启动地址: ${payload.url}`);
  }
  if (payload.target_id) {
    lines.push(`Target ID: ${payload.target_id}`);
  }
  lines.push(`调试窗口: ${payload.open_window ? "打开" : "关闭"}`);
  lines.push(`流模式: ${payload.stream_mode}`);
  return lines.join("\n");
}

function parseRunMetadata(run: AgentRun): Record<string, unknown> | null {
  if (!run.metadata) {
    return null;
  }
  try {
    const parsed = JSON.parse(run.metadata);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveRunSessionId(run: AgentRun): string | null {
  if (run.session_id) {
    return run.session_id;
  }
  const metadata = parseRunMetadata(run);
  const metadataSessionId = metadata?.session_id;
  return typeof metadataSessionId === "string" && metadataSessionId.trim()
    ? metadataSessionId
    : null;
}

function resolveLatestBrowserRun(runs: AgentRun[]): AgentRun | null {
  return runs.find((run) => Boolean(resolveRunSessionId(run))) ?? null;
}

function resolveBrowserLifecycleStatus(run: AgentRun): string | null {
  const metadata = parseRunMetadata(run);
  const lifecycle = metadata?.browser_lifecycle_state;
  return typeof lifecycle === "string" && lifecycle.trim() ? lifecycle : null;
}

function resolveRunHumanReason(run: AgentRun): string | null {
  const metadata = parseRunMetadata(run);
  const reason = metadata?.human_reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

function resolveRunInfoMessage(run: AgentRun): string | null {
  const reason = resolveRunHumanReason(run);
  if (!reason) {
    return null;
  }
  if (run.error_message && run.error_message.trim() === reason) {
    return null;
  }
  return reason;
}

function resolveRunDelivery(
  run: AgentRun,
): AutomationLastDeliveryRecord | null {
  const metadata = parseRunMetadata(run);
  const delivery = metadata?.delivery;
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return null;
  }

  const deliveryRecord = delivery as Record<string, unknown>;
  const success = deliveryRecord.success;
  const message = deliveryRecord.message;
  const outputKind = deliveryRecord.output_kind;
  const outputSchema = deliveryRecord.output_schema;
  const outputFormat = deliveryRecord.output_format;
  const outputPreview = deliveryRecord.output_preview;
  const attemptedAt = deliveryRecord.attempted_at;
  if (
    typeof success !== "boolean" ||
    typeof message !== "string" ||
    typeof outputKind !== "string" ||
    typeof outputSchema !== "string" ||
    typeof outputFormat !== "string" ||
    typeof outputPreview !== "string" ||
    typeof attemptedAt !== "string"
  ) {
    return null;
  }

  return {
    success,
    message,
    channel:
      typeof deliveryRecord.channel === "string"
        ? deliveryRecord.channel
        : null,
    target:
      typeof deliveryRecord.target === "string" ? deliveryRecord.target : null,
    output_kind: outputKind,
    output_schema:
      outputSchema === "json" ||
      outputSchema === "table" ||
      outputSchema === "csv" ||
      outputSchema === "links"
        ? outputSchema
        : "text",
    output_format: outputFormat === "json" ? "json" : "text",
    output_preview: outputPreview,
    delivery_attempt_id:
      typeof deliveryRecord.delivery_attempt_id === "string"
        ? deliveryRecord.delivery_attempt_id
        : null,
    run_id:
      typeof deliveryRecord.run_id === "string" ? deliveryRecord.run_id : null,
    execution_retry_count:
      typeof deliveryRecord.execution_retry_count === "number"
        ? deliveryRecord.execution_retry_count
        : null,
    delivery_attempts:
      typeof deliveryRecord.delivery_attempts === "number"
        ? deliveryRecord.delivery_attempts
        : null,
    attempted_at: attemptedAt,
  };
}

function statusLabel(status?: string | null): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "success":
      return "成功";
    case "running":
      return "运行中";
    case "waiting_for_human":
      return "等待人工处理";
    case "human_controlling":
      return "人工接管中";
    case "agent_resuming":
      return "恢复给 Agent";
    case "error":
      return "失败";
    case "timeout":
      return "超时";
    default:
      return "待执行";
  }
}

function statusVariant(status?: string | null) {
  if (status === "success") {
    return "default" as const;
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "agent_resuming"
  ) {
    return "secondary" as const;
  }
  if (status === "waiting_for_human" || status === "human_controlling") {
    return "outline" as const;
  }
  if (status === "error" || status === "timeout") {
    return "destructive" as const;
  }
  return "outline" as const;
}

function runDisplayStatus(run: AgentRun): string {
  if (run.status === "running") {
    const lifecycleStatus = resolveBrowserLifecycleStatus(run);
    if (lifecycleStatus) {
      return lifecycleStatus;
    }
  }
  return run.status;
}

function runStatusVariant(run: AgentRun) {
  return statusVariant(runDisplayStatus(run));
}

function runInfoToneClass(run: AgentRun): string {
  switch (runDisplayStatus(run)) {
    case "waiting_for_human":
      return "border-orange-200 bg-orange-50/80 text-orange-700";
    case "human_controlling":
      return "border-amber-200 bg-amber-50/80 text-amber-700";
    case "agent_resuming":
      return "border-sky-200 bg-sky-50/80 text-sky-700";
    default:
      return "border-slate-200/80 bg-white text-slate-600";
  }
}

function statusDetailToneClass(status?: string | null): string {
  switch (status) {
    case "waiting_for_human":
      return "text-orange-700";
    case "human_controlling":
      return "text-amber-700";
    case "agent_resuming":
      return "text-sky-700";
    case "error":
    case "timeout":
      return "text-rose-700";
    default:
      return "text-slate-500";
  }
}

function statusDetailPrefix(status?: string | null): string {
  switch (status) {
    case "waiting_for_human":
    case "human_controlling":
      return "当前阻塞";
    case "agent_resuming":
      return "恢复说明";
    case "error":
    case "timeout":
      return "最近异常";
    default:
      return "运行说明";
  }
}

function resolveDeliveryOutputFormat(
  format?: AutomationOutputFormat | null,
): AutomationOutputFormat {
  return format === "json" ? "json" : "text";
}

function resolveDeliveryOutputSchema(
  job: AutomationJobRecord,
): AutomationOutputSchema {
  switch (job.delivery.output_schema) {
    case "json":
    case "table":
    case "csv":
    case "links":
    case "text":
      return job.delivery.output_schema;
    default:
      return resolveDeliveryOutputFormat(job.delivery.output_format) === "json"
        ? "json"
        : "text";
  }
}

function deliveryModeLabel(job: AutomationJobRecord): string {
  return job.delivery.mode === "announce" ? "任务完成后投递" : "关闭";
}

function deliveryChannelLabel(channel?: string | null): string {
  switch (channel) {
    case "webhook":
      return "Webhook";
    case "google_sheets":
      return "Google Sheets";
    case "local_file":
      return "本地文件";
    case "telegram":
      return "Telegram";
    default:
      return channel?.trim() ? channel : "-";
  }
}

function outputSchemaLabel(schema: AutomationOutputSchema): string {
  switch (schema) {
    case "json":
      return "JSON 对象";
    case "table":
      return "表格";
    case "csv":
      return "CSV";
    case "links":
      return "链接列表";
    default:
      return "文本摘要";
  }
}

function outputFormatLabel(format: AutomationOutputFormat): string {
  return format === "json" ? "JSON 编码" : "文本编码";
}

function deliveryStatusVariant(success: boolean) {
  return success ? ("default" as const) : ("destructive" as const);
}

function deliveryToneClass(
  delivery: AutomationLastDeliveryRecord | null | undefined,
): string {
  if (!delivery) {
    return "border-slate-200/80 bg-slate-50/70 text-slate-500";
  }
  return delivery.success
    ? "border-emerald-200 bg-emerald-50/80 text-emerald-700"
    : "border-rose-200 bg-rose-50/80 text-rose-700";
}

type AutomationWorkspaceTemplate = {
  id: string;
  tag: string;
  name: string;
  description: string;
  detail: string;
  actionLabel: string;
  icon: typeof Bot;
  initialValues?: AutomationJobDialogInitialValues | null;
};

const WORKSPACE_TEMPLATES: AutomationWorkspaceTemplate[] = [
  {
    id: "daily-brief",
    tag: "定时摘要",
    name: "每日摘要",
    description: "每天固定时间整理项目或工作区的关键进展。",
    detail: "适合日报、晨报和巡检总结。",
    actionLabel: "使用摘要模板",
    icon: Bell,
    initialValues: {
      name: "每日摘要",
      description: "按固定时间生成一份中文摘要",
      payload_kind: "agent_turn",
      schedule_kind: "cron",
      cron_expr: "0 9 * * *",
      cron_tz: "Asia/Shanghai",
      prompt:
        "请总结最近一个周期内的关键进展、异常和待办，输出一份简洁的中文摘要。",
      delivery_mode: "none",
    },
  },
  {
    id: "browser-check",
    tag: "浏览器巡检",
    name: "浏览器巡检",
    description: "定时打开指定页面，执行浏览器任务或等待人工接管。",
    detail: "适合店铺后台、投放平台和控制台检查。",
    actionLabel: "使用巡检模板",
    icon: Globe,
    initialValues: {
      name: "浏览器巡检",
      description: "按固定间隔执行浏览器巡检",
      payload_kind: "browser_session",
      schedule_kind: "every",
      every_secs: "1800",
      browser_url: "https://",
      browser_open_window: false,
      browser_stream_mode: "events",
      delivery_mode: "none",
    },
  },
  {
    id: "structured-delivery",
    tag: "结果投递",
    name: "结构化投递",
    description: "把结果整理成结构化输出，再投递到文件或外部渠道。",
    detail: "适合 Webhook、本地文件和表格同步。",
    actionLabel: "使用投递模板",
    icon: FileText,
    initialValues: {
      name: "结构化结果投递",
      description: "按固定周期生成结构化结果并投递",
      payload_kind: "agent_turn",
      schedule_kind: "every",
      every_secs: "3600",
      prompt: "请整理本轮结果，输出结构化摘要并保留关键字段。",
      delivery_mode: "announce",
      delivery_channel: "local_file",
      delivery_output_schema: "json",
      delivery_output_format: "json",
      best_effort: true,
    },
  },
  {
    id: "blank",
    tag: "空白创建",
    name: "空白任务",
    description: "从零定义调度、payload 和输出，不受模板约束。",
    detail: "适合已经熟悉 automation 模型的配置场景。",
    actionLabel: "新建空白任务",
    icon: Plus,
  },
];

export type AutomationSettingsMode = "full" | "workspace" | "settings";
type AutomationWorkspaceTab = "tasks" | "overview";

interface AutomationSettingsProps {
  mode?: AutomationSettingsMode;
  onOpenSettings?: () => void;
  onOpenWorkspace?: () => void;
}

export function AutomationSettings({
  mode = "full",
  onOpenSettings,
  onOpenWorkspace,
}: AutomationSettingsProps) {
  const workspaceOnly = mode === "workspace";
  const settingsOnly = mode === "settings";
  const showWorkspacePanels = !settingsOnly;
  const showSchedulerEditor = !workspaceOnly;
  const [loading, setLoading] = useState(true);
  const [schedulerConfig, setSchedulerConfig] =
    useState<AutomationSchedulerConfig | null>(null);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [jobs, setJobs] = useState<AutomationJobRecord[]>([]);
  const [health, setHealth] = useState<AutomationHealthResult | null>(null);
  const [workspaces, setWorkspaces] = useState<Project[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobRuns, setJobRuns] = useState<AgentRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [browserSessions, setBrowserSessions] = useState<
    ChromeProfileSessionInfo[]
  >([]);
  const [browserSessionsLoading, setBrowserSessionsLoading] = useState(false);
  const [schedulerSaving, setSchedulerSaving] = useState(false);
  const [jobSaving, setJobSaving] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogInitialValues, setDialogInitialValues] =
    useState<AutomationJobDialogInitialValues | null>(null);
  const [workspaceTab, setWorkspaceTab] =
    useState<AutomationWorkspaceTab>("tasks");

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const selectedBrowserRun = useMemo(
    () =>
      selectedJob?.payload.kind === "browser_session"
        ? resolveLatestBrowserRun(jobRuns)
        : null,
    [jobRuns, selectedJob],
  );
  const selectedBrowserSessionId = useMemo(
    () => (selectedBrowserRun ? resolveRunSessionId(selectedBrowserRun) : null),
    [selectedBrowserRun],
  );
  const selectedBrowserInfoMessage = useMemo(
    () =>
      selectedBrowserRun ? resolveRunInfoMessage(selectedBrowserRun) : null,
    [selectedBrowserRun],
  );
  const selectedBrowserProfileKey = useMemo(
    () =>
      selectedJob?.payload.kind === "browser_session"
        ? (selectedJob.payload.profile_key ?? "")
        : "",
    [selectedJob],
  );

  const workspaceNameMap = useMemo(() => {
    const mapping = new Map<string, string>();
    workspaces.forEach((workspace) => {
      mapping.set(workspace.id, workspace.name);
    });
    return mapping;
  }, [workspaces]);
  const riskyJobMessageMap = useMemo(() => {
    const mapping = new Map<string, string>();
    health?.risky_jobs.forEach((job) => {
      if (job.detail_message?.trim()) {
        mapping.set(job.job_id, job.detail_message.trim());
      }
    });
    return mapping;
  }, [health]);

  const refreshAll = useCallback(
    async (silent: boolean = false) => {
      if (!silent) {
        setLoading(true);
      }
      try {
        const [nextSchedulerConfig, nextStatus, nextJobs, nextWorkspaces] =
          await Promise.all([
            getAutomationSchedulerConfig(),
            getAutomationStatus(),
            getAutomationJobs(),
            listProjects(),
          ]);
        const nextHealth = await getAutomationHealth({
          top_limit: Math.max(6, nextJobs.length),
        });

        setSchedulerConfig(nextSchedulerConfig);
        setStatus(nextStatus);
        setJobs(nextJobs);
        setHealth(nextHealth);
        setWorkspaces(nextWorkspaces);
        setSelectedJobId((current) => {
          if (!showWorkspacePanels) {
            return null;
          }
          if (current && nextJobs.some((job) => job.id === current)) {
            return current;
          }
          return nextJobs[0]?.id ?? null;
        });
      } catch (error) {
        toast.error(
          `加载自动化设置失败: ${error instanceof Error ? error.message : error}`,
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [showWorkspacePanels],
  );

  const refreshHistory = useCallback(async (jobId: string) => {
    setHistoryLoading(true);
    try {
      const runs = await getAutomationRunHistory(jobId, 15);
      setJobRuns(runs);
    } catch (error) {
      toast.error(
        `加载任务历史失败: ${error instanceof Error ? error.message : error}`,
      );
      setJobRuns([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const refreshBrowserSessions = useCallback(
    async (silent: boolean = false) => {
      if (selectedJob?.payload.kind !== "browser_session") {
        setBrowserSessions([]);
        return;
      }
      if (!silent) {
        setBrowserSessionsLoading(true);
      }
      try {
        const sessions = await getChromeProfileSessions();
        setBrowserSessions(sessions);
      } catch (error) {
        if (!silent) {
          toast.error(
            `加载浏览器运行会话失败: ${
              error instanceof Error ? error.message : error
            }`,
          );
        }
        setBrowserSessions([]);
      } finally {
        if (!silent) {
          setBrowserSessionsLoading(false);
        }
      }
    },
    [selectedJob],
  );

  const handleBrowserRuntimeMessage = useCallback(
    (message: { type: "success" | "error"; text: string }) => {
      if (message.type === "error") {
        toast.error(message.text);
        return;
      }
      toast.success(message.text);
      if (selectedJob?.payload.kind === "browser_session") {
        void refreshAll(true);
        void refreshHistory(selectedJob.id);
        void refreshBrowserSessions(true);
      }
    },
    [refreshAll, refreshBrowserSessions, refreshHistory, selectedJob],
  );

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!showWorkspacePanels) {
      setJobRuns([]);
      return;
    }
    if (!selectedJobId) {
      setJobRuns([]);
      return;
    }
    void refreshHistory(selectedJobId);
  }, [refreshHistory, selectedJobId, showWorkspacePanels]);

  useEffect(() => {
    if (!showWorkspacePanels) {
      setBrowserSessions([]);
      setBrowserSessionsLoading(false);
      return;
    }
    if (selectedJob?.payload.kind !== "browser_session") {
      setBrowserSessions([]);
      setBrowserSessionsLoading(false);
      return;
    }
    void refreshBrowserSessions(true);
  }, [
    refreshBrowserSessions,
    selectedBrowserSessionId,
    selectedJob,
    showWorkspacePanels,
  ]);

  async function handleSaveScheduler() {
    if (!schedulerConfig) {
      return;
    }

    setSchedulerSaving(true);
    try {
      await updateAutomationSchedulerConfig({
        ...schedulerConfig,
        poll_interval_secs: Math.max(5, schedulerConfig.poll_interval_secs),
      });
      toast.success("调度器配置已保存");
      await refreshAll(true);
    } catch (error) {
      toast.error(
        `保存调度器失败: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setSchedulerSaving(false);
    }
  }

  async function handleSubmitJob(payload: AutomationJobDialogSubmit) {
    setJobSaving(true);
    try {
      const result =
        payload.mode === "create"
          ? await createAutomationJob(payload.request)
          : await updateAutomationJob(payload.id, payload.request);

      toast.success(payload.mode === "create" ? "任务已创建" : "任务已更新");
      setDialogOpen(false);
      setDialogInitialValues(null);
      await refreshAll(true);
      setSelectedJobId(result.id);
      await refreshHistory(result.id);
    } catch (error) {
      toast.error(
        `保存任务失败: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    } finally {
      setJobSaving(false);
    }
  }

  async function handleDeleteJob(job: AutomationJobRecord) {
    if (!window.confirm(`确认删除自动化任务“${job.name}”吗？`)) {
      return;
    }

    try {
      await deleteAutomationJob(job.id);
      toast.success("任务已删除");
      await refreshAll(true);
    } catch (error) {
      toast.error(
        `删除任务失败: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async function handleRunNow(job: AutomationJobRecord) {
    setRunningJobId(job.id);
    try {
      const result = await runAutomationJobNow(job.id);
      if (job.payload.kind === "browser_session") {
        toast.success(
          "浏览器任务已启动，后续挂起与恢复状态会随会话控制同步回写。",
        );
      } else {
        toast.success(
          `执行完成: 成功 ${result.success_count}，失败 ${result.failed_count}，超时 ${result.timeout_count}`,
        );
      }
      await refreshAll(true);
      await refreshHistory(job.id);
      if (job.payload.kind === "browser_session") {
        await refreshBrowserSessions(true);
      }
    } catch (error) {
      toast.error(
        `执行任务失败: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setRunningJobId(null);
    }
  }

  function openCreateDialog(
    initialValues?: AutomationJobDialogInitialValues | null,
  ) {
    setDialogMode("create");
    setDialogInitialValues(initialValues ?? null);
    setDialogOpen(true);
  }

  function openEditDialog(job: AutomationJobRecord) {
    setSelectedJobId(job.id);
    setDialogMode("edit");
    setDialogInitialValues(null);
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    setDialogOpen(open);
    if (!open) {
      setDialogInitialValues(null);
    }
  }

  const heroTitle = settingsOnly
    ? "自动化设置"
    : workspaceOnly
      ? "自动化"
      : "自动化工作台";
  const heroDescription = settingsOnly
    ? "这里只管理全局调度器开关、轮询间隔和执行历史保留。任务创建和运行处理都在左侧自动化工作台完成。"
    : workspaceOnly
      ? "默认进入任务视图，先创建任务、再处理列表与详情。统计和风险提醒收进单独的概览页。"
      : "统一管理自动化任务的创建、运行历史和调度器配置。";

  if (loading || !schedulerConfig) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(245,250,246,0.96)_0%,rgba(255,255,255,0.98)_52%,rgba(241,247,255,0.96)_100%)] p-6 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-slate-500">
              Automation Workspace
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-slate-900 text-white shadow-lg shadow-slate-900/10">
                  <Bot className="h-5 w-5" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {heroTitle}
                </h2>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-slate-500">
                {heroDescription}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showWorkspacePanels ? (
              <Button variant="default" onClick={() => openCreateDialog()}>
                <Plus className="mr-2 h-4 w-4" />
                新建任务
              </Button>
            ) : null}
            {workspaceOnly && onOpenSettings ? (
              <Button variant="outline" onClick={onOpenSettings}>
                自动化设置
              </Button>
            ) : null}
            {settingsOnly && onOpenWorkspace ? (
              <Button variant="outline" onClick={onOpenWorkspace}>
                打开任务工作台
              </Button>
            ) : null}
            <Button
              variant={showWorkspacePanels ? "outline" : "default"}
              onClick={() => void refreshAll(true)}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              刷新
            </Button>
          </div>
        </div>

        {showWorkspacePanels ? (
          <div className="mt-5">
            <Tabs
              value={workspaceTab}
              onValueChange={(value) =>
                setWorkspaceTab(value as AutomationWorkspaceTab)
              }
            >
              <TabsList className="grid h-auto w-full max-w-[420px] grid-cols-2 rounded-[22px] border border-slate-200/80 bg-white/86 p-1 shadow-sm shadow-slate-950/5">
                <TabsTrigger
                  value="tasks"
                  data-testid="automation-tab-tasks"
                  className="rounded-[16px] px-4 py-3"
                >
                  任务
                </TabsTrigger>
                <TabsTrigger
                  value="overview"
                  data-testid="automation-tab-overview"
                  className="rounded-[16px] px-4 py-3"
                >
                  概览
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        ) : null}
      </div>

      {showSchedulerEditor ? (
        <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-xl text-slate-900">
                  调度器设置
                </CardTitle>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  这里只保留全局开关、轮询间隔和历史保留。任务创建与运行处理不再和设置区混排。
                </p>
              </div>
              <Badge variant={schedulerConfig.enabled ? "default" : "outline"}>
                {schedulerConfig.enabled ? "已启用" : "已停用"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      启用调度器
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      后台轮询 automation_jobs 表
                    </div>
                  </div>
                  <Switch
                    checked={schedulerConfig.enabled}
                    onCheckedChange={(checked) =>
                      setSchedulerConfig((current) =>
                        current ? { ...current, enabled: checked } : current,
                      )
                    }
                  />
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      记录执行历史
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      写入统一的 agent_runs 表
                    </div>
                  </div>
                  <Switch
                    checked={schedulerConfig.enable_history}
                    onCheckedChange={(checked) =>
                      setSchedulerConfig((current) =>
                        current
                          ? { ...current, enable_history: checked }
                          : current,
                      )
                    }
                  />
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="text-sm font-medium text-slate-900">
                  轮询间隔（秒）
                </div>
                <Input
                  className="mt-3"
                  type="number"
                  min={5}
                  value={schedulerConfig.poll_interval_secs}
                  onChange={(event) =>
                    setSchedulerConfig((current) =>
                      current
                        ? {
                            ...current,
                            poll_interval_secs: Number(event.target.value) || 5,
                          }
                        : current,
                    )
                  }
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={() => void handleSaveScheduler()}
                disabled={schedulerSaving}
              >
                {schedulerSaving ? "保存中..." : "保存调度器"}
              </Button>
              <div className="text-sm text-slate-500">
                最近轮询 {formatTime(status?.last_polled_at)}，下次轮询{" "}
                {formatTime(status?.next_poll_at)}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showWorkspacePanels ? (
        <Tabs
          value={workspaceTab}
          onValueChange={(value) =>
            setWorkspaceTab(value as AutomationWorkspaceTab)
          }
          className="space-y-0"
        >
          <TabsContent value="tasks" className="mt-0 space-y-6">
            <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-medium tracking-[0.14em] text-slate-500">
                      任务入口
                    </div>
                    <CardTitle className="mt-2 text-xl text-slate-900">
                      先创建任务，再处理执行细节
                    </CardTitle>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      默认页只保留任务相关动作。模板负责预填 schedule、payload 和 delivery，统计不再占据首屏。
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => openCreateDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    空白新建
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {WORKSPACE_TEMPLATES.map((template) => {
                    const Icon = template.icon;
                    return (
                      <div
                        key={template.id}
                        className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-5"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-white text-slate-700 shadow-sm shadow-slate-950/5">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
                            {template.tag}
                          </span>
                        </div>
                        <div className="mt-4 text-base font-semibold text-slate-900">
                          {template.name}
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {template.description}
                        </p>
                        <p className="mt-3 text-xs leading-5 text-slate-500">
                          {template.detail}
                        </p>
                        <Button
                          data-testid={`automation-template-${template.id}`}
                          variant="ghost"
                          className="mt-5 w-full justify-between rounded-[16px] border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                          onClick={() => openCreateDialog(template.initialValues)}
                        >
                          {template.actionLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(340px,0.82fr)]">
              <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-xl text-slate-900">
                        任务列表
                      </CardTitle>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        每个 job 都绑定工作区、调度规则和 payload，不再依赖 markdown
                        任务文件。
                      </p>
                    </div>
                    <Badge variant="outline">{jobs.length} 个 job</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {jobs.length ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>任务</TableHead>
                          <TableHead>工作区</TableHead>
                          <TableHead>调度</TableHead>
                          <TableHead>模式</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>下次执行</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.map((job) => {
                          const jobDetailMessage = riskyJobMessageMap.get(job.id);
                          return (
                            <TableRow
                              key={job.id}
                              className={
                                selectedJobId === job.id ? "bg-slate-50" : undefined
                              }
                              onClick={() => setSelectedJobId(job.id)}
                            >
                              <TableCell className="align-top">
                                <div className="space-y-1">
                                  <div className="font-medium text-slate-900">
                                    {job.name}
                                  </div>
                                  <div className="max-w-[320px] text-xs leading-5 text-slate-500">
                                    {job.description || "未填写任务描述"}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="align-top text-sm text-slate-500">
                                {workspaceNameMap.get(job.workspace_id) ??
                                  job.workspace_id}
                              </TableCell>
                              <TableCell className="align-top text-sm text-slate-500">
                                {describeSchedule(job)}
                              </TableCell>
                              <TableCell className="align-top text-sm text-slate-500">
                                {executionModeLabel(job.execution_mode)}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap gap-2">
                                    <Badge variant={statusVariant(job.last_status)}>
                                      {statusLabel(job.last_status)}
                                    </Badge>
                                    {!job.enabled ? (
                                      <Badge variant="outline">已停用</Badge>
                                    ) : null}
                                    {job.auto_disabled_until ? (
                                      <Badge variant="destructive">冷却中</Badge>
                                    ) : null}
                                  </div>
                                  {jobDetailMessage ? (
                                    <div
                                      className={`max-w-[260px] text-xs leading-5 ${statusDetailToneClass(
                                        job.last_status,
                                      )}`}
                                    >
                                      {statusDetailPrefix(job.last_status)}:{" "}
                                      {jobDetailMessage}
                                    </div>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="align-top text-sm text-slate-500">
                                {formatTime(job.next_run_at)}
                              </TableCell>
                              <TableCell className="align-top">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleRunNow(job);
                                    }}
                                    disabled={runningJobId === job.id}
                                  >
                                    <Play className="mr-1 h-4 w-4" />
                                    {runningJobId === job.id ? "执行中" : "运行"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openEditDialog(job);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedJobId(job.id);
                                    }}
                                  >
                                    <History className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteJob(job);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center">
                      <div className="text-base font-medium text-slate-900">
                        还没有 automation job
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        从这里开始创建结构化任务，之后所有定时执行都只走这套链路。
                      </p>
                      <Button className="mt-5" onClick={() => openCreateDialog()}>
                        <Plus className="mr-2 h-4 w-4" />
                        新建第一条任务
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-6">
                <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-xl text-slate-900">
                      任务详情与历史
                    </CardTitle>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      选择左侧 job 后，这里会显示最近执行记录和当前 payload 摘要。
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedJob ? (
                      <>
                        <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold text-slate-900">
                                {selectedJob.name}
                              </div>
                              <div className="mt-1 text-sm text-slate-500">
                                {workspaceNameMap.get(selectedJob.workspace_id) ??
                                  selectedJob.workspace_id}
                              </div>
                            </div>
                            <Badge variant={statusVariant(selectedJob.last_status)}>
                              {statusLabel(selectedJob.last_status)}
                            </Badge>
                          </div>
                          <div className="mt-4 space-y-2 text-sm text-slate-500">
                            <div>
                              任务类型: {payloadKindLabel(selectedJob.payload.kind)}
                            </div>
                            <div>调度: {describeSchedule(selectedJob)}</div>
                            <div>
                              下次执行: {formatTime(selectedJob.next_run_at)}
                            </div>
                            <div>
                              最近执行: {formatTime(selectedJob.last_run_at)}
                            </div>
                            <div>最后错误: {selectedJob.last_error || "-"}</div>
                          </div>
                          {selectedJob.payload.kind === "browser_session" &&
                          selectedBrowserRun &&
                          selectedBrowserInfoMessage ? (
                            <div
                              className={`mt-4 rounded-[18px] border px-4 py-3 text-sm leading-6 ${runInfoToneClass(
                                selectedBrowserRun,
                              )}`}
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.14em]">
                                <span>运行态说明</span>
                                <Badge
                                  variant={runStatusVariant(selectedBrowserRun)}
                                >
                                  {statusLabel(
                                    runDisplayStatus(selectedBrowserRun),
                                  )}
                                </Badge>
                              </div>
                              <div className="mt-2">
                                {selectedBrowserInfoMessage}
                              </div>
                            </div>
                          ) : null}
                          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                            <div className="rounded-[18px] border border-slate-200/80 bg-white px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-medium text-slate-900">
                                  输出契约
                                </div>
                                <Badge
                                  variant={
                                    selectedJob.delivery.mode === "announce"
                                      ? "secondary"
                                      : "outline"
                                  }
                                >
                                  {deliveryModeLabel(selectedJob)}
                                </Badge>
                              </div>
                              <div className="mt-3 space-y-2 text-sm text-slate-500">
                                <div>
                                  输出目标:{" "}
                                  {selectedJob.delivery.mode === "announce"
                                    ? deliveryChannelLabel(
                                        selectedJob.delivery.channel,
                                      )
                                    : "-"}
                                </div>
                                <div>
                                  输出契约:{" "}
                                  {outputSchemaLabel(
                                    resolveDeliveryOutputSchema(selectedJob),
                                  )}
                                </div>
                                <div>
                                  投递编码:{" "}
                                  {outputFormatLabel(
                                    resolveDeliveryOutputFormat(
                                      selectedJob.delivery.output_format,
                                    ),
                                  )}
                                </div>
                                <div>
                                  目标地址:{" "}
                                  {selectedJob.delivery.mode === "announce"
                                    ? selectedJob.delivery.target || "-"
                                    : "-"}
                                </div>
                                <div>
                                  失败策略:{" "}
                                  {selectedJob.delivery.mode !== "announce"
                                    ? "未启用"
                                    : selectedJob.delivery.best_effort
                                      ? "投递失败不阻塞任务"
                                      : "投递失败记为任务失败"}
                                </div>
                              </div>
                            </div>
                            <div
                              className={`rounded-[18px] border px-4 py-3 ${deliveryToneClass(
                                selectedJob.last_delivery,
                              )}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-medium text-slate-900">
                                  最近一次投递结果
                                </div>
                                <Badge
                                  variant={
                                    selectedJob.last_delivery
                                      ? deliveryStatusVariant(
                                          selectedJob.last_delivery.success,
                                        )
                                      : "outline"
                                  }
                                >
                                  {selectedJob.last_delivery
                                    ? selectedJob.last_delivery.success
                                      ? "投递成功"
                                      : "投递失败"
                                    : "暂无记录"}
                                </Badge>
                              </div>
                              {selectedJob.last_delivery ? (
                                <>
                                  <div className="mt-3 space-y-2 text-sm">
                                    <div>
                                      时间:{" "}
                                      {formatTime(
                                        selectedJob.last_delivery.attempted_at,
                                      )}
                                    </div>
                                    <div>
                                      渠道:{" "}
                                      {deliveryChannelLabel(
                                        selectedJob.last_delivery.channel,
                                      )}
                                    </div>
                                    <div>
                                      目标:{" "}
                                      {selectedJob.last_delivery.target || "-"}
                                    </div>
                                    <div>
                                      契约:{" "}
                                      {outputSchemaLabel(
                                        selectedJob.last_delivery.output_schema,
                                      )}{" "}
                                      /{" "}
                                      {outputFormatLabel(
                                        selectedJob.last_delivery.output_format,
                                      )}
                                    </div>
                                    <div>
                                      投递键:{" "}
                                      {selectedJob.last_delivery
                                        .delivery_attempt_id || "-"}
                                    </div>
                                    <div>
                                      执行重试:{" "}
                                      {selectedJob.last_delivery
                                        .execution_retry_count ?? 0}
                                      {" / "}
                                      投递尝试:{" "}
                                      {selectedJob.last_delivery
                                        .delivery_attempts ?? 0}
                                    </div>
                                    <div>
                                      结果: {selectedJob.last_delivery.message}
                                    </div>
                                  </div>
                                  <div className="mt-3 whitespace-pre-wrap rounded-[14px] border border-white/70 bg-white/70 px-3 py-2 text-xs leading-5 text-slate-600">
                                    {selectedJob.last_delivery.output_preview ||
                                      "无输出预览"}
                                  </div>
                                </>
                              ) : (
                                <div className="mt-3 text-sm leading-6">
                                  {selectedJob.delivery.mode === "announce"
                                    ? "任务尚未产生投递记录。"
                                    : "当前任务未启用输出投递。"}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="mt-4 whitespace-pre-wrap rounded-[18px] border border-slate-200/80 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
                            {describePayload(selectedJob.payload)}
                          </div>
                        </div>

                        {selectedJob.payload.kind === "browser_session" ? (
                          <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-base font-semibold text-slate-900">
                                  浏览器实时接管
                                </div>
                                <div className="mt-1 text-sm leading-6 text-slate-500">
                                  直接复用现有 browser session
                                  状态机处理人工接管、等待继续和恢复执行。
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void refreshBrowserSessions()}
                                disabled={browserSessionsLoading}
                              >
                                <RefreshCw
                                  className={`mr-2 h-4 w-4 ${
                                    browserSessionsLoading ? "animate-spin" : ""
                                  }`}
                                />
                                {browserSessionsLoading
                                  ? "刷新中..."
                                  : "刷新运行会话"}
                              </Button>
                            </div>
                            <div className="mt-4 grid gap-2 text-sm text-slate-500 md:grid-cols-2">
                              <div>
                                最近可接管运行:{" "}
                                {selectedBrowserRun
                                  ? formatTime(selectedBrowserRun.started_at)
                                  : "-"}
                              </div>
                              <div>Session: {selectedBrowserSessionId ?? "-"}</div>
                              <div>
                                资料 Key: {selectedBrowserProfileKey || "-"}
                              </div>
                              <div>当前运行会话数: {browserSessions.length}</div>
                            </div>
                            <div className="mt-4">
                              <BrowserRuntimeDebugPanel
                                sessions={browserSessions}
                                onMessage={handleBrowserRuntimeMessage}
                                embedded
                                initialProfileKey={
                                  selectedBrowserProfileKey || undefined
                                }
                                initialSessionId={
                                  selectedBrowserSessionId || undefined
                                }
                              />
                            </div>
                          </div>
                        ) : null}

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-slate-900">
                              最近运行
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void refreshHistory(selectedJob.id)}
                            >
                              <RefreshCw className="mr-2 h-4 w-4" />
                              刷新
                            </Button>
                          </div>

                          {historyLoading ? (
                            <div className="flex h-28 items-center justify-center">
                              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                            </div>
                          ) : jobRuns.length ? (
                            jobRuns.map((run) => {
                              const infoMessage = resolveRunInfoMessage(run);
                              const delivery = resolveRunDelivery(run);
                              return (
                                <div
                                  key={run.id}
                                  className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4"
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
                                      {run.error_message}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })
                          ) : (
                            <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-6 text-sm text-slate-500">
                              还没有运行记录。
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                        选择左侧任务后查看详情。
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="overview" className="mt-0 space-y-6">
            <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-xl text-slate-900">
                      运行概览
                    </CardTitle>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      统计、健康与风险提醒统一收在这里，不再进入任务首屏。
                    </p>
                  </div>
                  <LatestRunStatusBadge source="automation" label="统一执行状态" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">调度器</div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                      {status?.running ? "运行中" : "已停止"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">最近轮询</div>
                    <div className="mt-3 text-base font-semibold text-slate-900">
                      {formatTime(status?.last_polled_at)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">下次轮询</div>
                    <div className="mt-3 text-base font-semibold text-slate-900">
                      {formatTime(status?.next_poll_at)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">活跃任务</div>
                    <div className="mt-3 text-base font-semibold text-slate-900">
                      {status?.active_job_name ?? "当前空闲"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <AutomationHealthPanel health={health} status={status} />
          </TabsContent>
        </Tabs>
      ) : null}

      <AutomationJobDialog
        open={dialogOpen}
        mode={dialogMode}
        job={dialogMode === "edit" ? selectedJob : null}
        workspaces={workspaces}
        initialValues={dialogMode === "create" ? dialogInitialValues : null}
        saving={jobSaving}
        onOpenChange={handleDialogOpenChange}
        onSubmit={handleSubmitJob}
      />
    </div>
  );
}
