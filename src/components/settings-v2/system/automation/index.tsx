import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Bot,
  FileText,
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
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { AutomationHealthPanel } from "./AutomationHealthPanel";
import { AutomationJobDetailsDialog } from "./AutomationJobDetailsDialog";
import {
  AutomationJobDialog,
  AutomationJobDialogSubmit,
  type AutomationJobDialogInitialValues,
} from "./AutomationJobDialog";
import {
  resolveServiceSkillAutomationContext,
  type AutomationServiceSkillContext,
} from "./serviceSkillContext";
import {
  LEGACY_BROWSER_AUTOMATION_NOTICE,
  LEGACY_BROWSER_AUTOMATION_STATUS,
  describeSchedule,
  describeServiceSkillSlotPreview,
  describeServiceSkillTaskLine,
  executionModeLabel,
  formatTime,
  isLegacyBrowserAutomation,
  statusDetailPrefix,
  statusDetailToneClass,
  statusLabel,
  statusVariant,
} from "./automationPresentation";
import type { AutomationWorkspaceTab } from "@/types/page";

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

interface AutomationSettingsProps {
  mode?: AutomationSettingsMode;
  initialSelectedJobId?: string;
  initialWorkspaceTab?: AutomationWorkspaceTab;
  onOpenSettings?: () => void;
  onOpenWorkspace?: () => void;
}

export function AutomationSettings({
  mode = "full",
  initialSelectedJobId,
  initialWorkspaceTab,
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
  const [schedulerSaving, setSchedulerSaving] = useState(false);
  const [jobSaving, setJobSaving] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [dialogInitialValues, setDialogInitialValues] =
    useState<AutomationJobDialogInitialValues | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<AutomationWorkspaceTab>(
    initialWorkspaceTab ?? "tasks",
  );
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const autoOpenedInitialJobIdRef = useRef<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );
  const serviceSkillContextByJobId = useMemo(() => {
    const mapping = new Map<string, AutomationServiceSkillContext>();
    jobs.forEach((job) => {
      const context = resolveServiceSkillAutomationContext(job.payload);
      if (context) {
        mapping.set(job.id, context);
      }
    });
    return mapping;
  }, [jobs]);
  const selectedServiceSkillContext = useMemo(
    () =>
      selectedJobId
        ? (serviceSkillContextByJobId.get(selectedJobId) ?? null)
        : null,
    [selectedJobId, serviceSkillContextByJobId],
  );
  const legacyBrowserJobCount = useMemo(
    () => jobs.filter((job) => isLegacyBrowserAutomation(job)).length,
    [jobs],
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
          if (
            initialSelectedJobId &&
            nextJobs.some((job) => job.id === initialSelectedJobId)
          ) {
            return initialSelectedJobId;
          }
          if (current && nextJobs.some((job) => job.id === current)) {
            return current;
          }
          return null;
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
    [initialSelectedJobId, showWorkspacePanels],
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

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!showWorkspacePanels || !initialSelectedJobId) {
      return;
    }

    setSelectedJobId((current) => {
      if (current === initialSelectedJobId) {
        return current;
      }
      if (jobs.length === 0) {
        return initialSelectedJobId;
      }
      if (jobs.some((job) => job.id === initialSelectedJobId)) {
        return initialSelectedJobId;
      }
      return current;
    });
  }, [initialSelectedJobId, jobs, showWorkspacePanels]);

  useEffect(() => {
    if (!initialSelectedJobId) {
      autoOpenedInitialJobIdRef.current = null;
      return;
    }
    if (!showWorkspacePanels) {
      return;
    }
    if (!jobs.some((job) => job.id === initialSelectedJobId)) {
      return;
    }
    if (autoOpenedInitialJobIdRef.current === initialSelectedJobId) {
      return;
    }
    setSelectedJobId(initialSelectedJobId);
    setDetailDialogOpen(true);
    autoOpenedInitialJobIdRef.current = initialSelectedJobId;
  }, [initialSelectedJobId, jobs, showWorkspacePanels]);

  useEffect(() => {
    if (!showWorkspacePanels || !initialWorkspaceTab) {
      return;
    }

    setWorkspaceTab(initialWorkspaceTab);
  }, [initialWorkspaceTab, showWorkspacePanels]);

  useEffect(() => {
    if (!showWorkspacePanels) {
      setDetailDialogOpen(false);
      setJobRuns([]);
      return;
    }
    if (!selectedJobId || !detailDialogOpen) {
      setJobRuns([]);
      return;
    }
    void refreshHistory(selectedJobId);
  }, [detailDialogOpen, refreshHistory, selectedJobId, showWorkspacePanels]);

  useEffect(() => {
    if (detailDialogOpen && !selectedJob) {
      setDetailDialogOpen(false);
    }
  }, [detailDialogOpen, selectedJob]);

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
      setDetailDialogOpen(true);
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
    if (isLegacyBrowserAutomation(job)) {
      toast.error(LEGACY_BROWSER_AUTOMATION_NOTICE);
      return;
    }

    setRunningJobId(job.id);
    try {
      const result = await runAutomationJobNow(job.id);
      toast.success(
        `执行完成: 成功 ${result.success_count}，失败 ${result.failed_count}，超时 ${result.timeout_count}`,
      );
      await refreshAll(true);
      await refreshHistory(job.id);
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

  function openJobDetails(jobId: string) {
    setSelectedJobId(jobId);
    setDetailDialogOpen(true);
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
      ? "默认进入任务视图，当前只保留 Agent 对话任务的创建与运行。统计和风险提醒收进单独的概览页。"
      : "统一管理 Agent 自动化任务的创建、运行历史和调度器配置。";

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
                <WorkbenchInfoTip
                  ariaLabel="自动化工作台说明"
                  content={heroDescription}
                  tone="mint"
                />
              </div>
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
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-xl text-slate-900">
                    调度器设置
                  </CardTitle>
                  <WorkbenchInfoTip
                    ariaLabel="调度器设置说明"
                    content="这里只保留全局开关、轮询间隔和历史保留。任务创建与运行处理不再和设置区混排。"
                    tone="slate"
                  />
                </div>
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
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <CardTitle className="text-xl text-slate-900">
                        先创建任务，再处理执行细节
                      </CardTitle>
                      <WorkbenchInfoTip
                        ariaLabel="任务入口说明"
                        content="默认页只保留 Agent 对话任务相关动作。模板负责预填 schedule、payload 和 delivery，浏览器自动化不再提供创建入口。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => openCreateDialog()}>
                    <Plus className="mr-2 h-4 w-4" />
                    空白新建
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {legacyBrowserJobCount > 0 ? (
                  <div className="mb-4 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-800">
                    检测到 {legacyBrowserJobCount}{" "}
                    条旧浏览器自动化任务。系统已停用这类任务，不会再后台启动
                    Chrome；请删除旧任务，并改用 Agent 对话任务重建。
                  </div>
                ) : null}
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
                          <span className="inline-flex items-center gap-2">
                            {template.name}
                            <WorkbenchInfoTip
                              ariaLabel={`${template.name}模板说明`}
                              content={template.detail}
                              tone="slate"
                            />
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                          {template.description}
                        </p>
                        <Button
                          data-testid={`automation-template-${template.id}`}
                          variant="ghost"
                          className="mt-5 w-full justify-between rounded-[16px] border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                          onClick={() =>
                            openCreateDialog(template.initialValues)
                          }
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

            <div className="space-y-6">
              <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-xl text-slate-900">
                          任务列表
                        </CardTitle>
                        <WorkbenchInfoTip
                          ariaLabel="任务列表说明"
                          content="每个 job 都绑定工作区、调度规则和 payload。详情改为按需打开，点击任务行或详情按钮查看运行历史、输出投递和 payload 摘要。"
                          tone="slate"
                        />
                      </div>
                    </div>
                    <Badge variant="outline">{jobs.length} 个 job</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {jobs.length ? (
                    <Table className="min-w-[1120px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[320px]">任务</TableHead>
                          <TableHead className="min-w-[140px]">
                            工作区
                          </TableHead>
                          <TableHead className="min-w-[150px]">调度</TableHead>
                          <TableHead className="min-w-[110px]">模式</TableHead>
                          <TableHead className="min-w-[210px]">状态</TableHead>
                          <TableHead className="min-w-[150px]">
                            执行窗口
                          </TableHead>
                          <TableHead className="min-w-[240px] text-right">
                            操作
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.map((job) => {
                          const jobDetailMessage = riskyJobMessageMap.get(
                            job.id,
                          );
                          const serviceSkillContext =
                            serviceSkillContextByJobId.get(job.id) ?? null;
                          const serviceSkillTaskLine = serviceSkillContext
                            ? describeServiceSkillTaskLine(serviceSkillContext)
                            : null;
                          const serviceSkillSlotPreview = serviceSkillContext
                            ? describeServiceSkillSlotPreview(
                                serviceSkillContext,
                              )
                            : null;
                          const legacyBrowserJob =
                            isLegacyBrowserAutomation(job);
                          return (
                            <TableRow
                              key={job.id}
                              data-testid={`automation-job-row-${job.id}`}
                              className={
                                selectedJobId === job.id
                                  ? "cursor-pointer bg-slate-50"
                                  : "cursor-pointer"
                              }
                              onClick={() => openJobDetails(job.id)}
                            >
                              <TableCell className="align-top">
                                <div className="space-y-1">
                                  <div className="font-medium text-slate-900">
                                    {job.name}
                                  </div>
                                  <div className="max-w-[320px] text-xs leading-5 text-slate-500">
                                    {job.description || "未填写任务描述"}
                                  </div>
                                  {serviceSkillContext ? (
                                    <div
                                      data-testid={`automation-job-service-skill-summary-${job.id}`}
                                      className="space-y-1.5 pt-1"
                                    >
                                      <div className="flex flex-wrap gap-2">
                                        <Badge
                                          variant="outline"
                                          className="border-sky-200 bg-sky-50 text-sky-700"
                                        >
                                          技能任务
                                        </Badge>
                                        <Badge variant="outline">
                                          {serviceSkillContext.runnerLabel}
                                        </Badge>
                                        <Badge variant="outline">
                                          {
                                            serviceSkillContext.executionLocationLabel
                                          }
                                        </Badge>
                                        <Badge variant="outline">
                                          {serviceSkillContext.sourceLabel}
                                        </Badge>
                                      </div>
                                      {serviceSkillTaskLine ? (
                                        <div className="max-w-[360px] text-xs leading-5 text-slate-600">
                                          {serviceSkillTaskLine}
                                        </div>
                                      ) : null}
                                      {serviceSkillSlotPreview ? (
                                        <div className="max-w-[360px] text-xs leading-5 text-slate-500">
                                          参数摘要: {serviceSkillSlotPreview}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
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
                                    <Badge
                                      variant={statusVariant(job.last_status)}
                                    >
                                      {statusLabel(job.last_status)}
                                    </Badge>
                                    {legacyBrowserJob ? (
                                      <Badge variant="outline">
                                        {LEGACY_BROWSER_AUTOMATION_STATUS}
                                      </Badge>
                                    ) : null}
                                    {!job.enabled ? (
                                      <Badge variant="outline">已停用</Badge>
                                    ) : null}
                                    {job.auto_disabled_until ? (
                                      <Badge variant="destructive">
                                        冷却中
                                      </Badge>
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
                                <div
                                  data-testid={`automation-job-run-window-${job.id}`}
                                  className="space-y-1"
                                >
                                  <div>下次: {formatTime(job.next_run_at)}</div>
                                  <div className="text-xs text-slate-400">
                                    最近: {formatTime(job.last_run_at)}
                                  </div>
                                </div>
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
                                    disabled={
                                      runningJobId === job.id ||
                                      legacyBrowserJob
                                    }
                                  >
                                    <Play className="mr-1 h-4 w-4" />
                                    {legacyBrowserJob
                                      ? LEGACY_BROWSER_AUTOMATION_STATUS
                                      : runningJobId === job.id
                                        ? "执行中"
                                        : "运行"}
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
                                    className="gap-1.5 text-slate-600"
                                    data-testid={`automation-job-open-details-${job.id}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openJobDetails(job.id);
                                    }}
                                  >
                                    <History className="h-4 w-4" />
                                    详情
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
                    <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                      <div className="text-base font-medium text-slate-900">
                        还没有 automation job
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        从这里开始创建结构化任务，之后所有定时执行都只走这套链路。
                      </p>
                      <Button
                        className="mt-5"
                        onClick={() => openCreateDialog()}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        新建第一条任务
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="overview" className="mt-0 space-y-6">
            <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-xl text-slate-900">
                        运行概览
                      </CardTitle>
                      <WorkbenchInfoTip
                        ariaLabel="运行概览说明"
                        content="统计、健康与风险提醒统一收在这里，不再进入任务首屏。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <LatestRunStatusBadge
                    source="automation"
                    label="统一执行状态"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">
                      调度器
                    </div>
                    <div className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
                      {status?.running ? "运行中" : "已停止"}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">
                      最近轮询
                    </div>
                    <div className="mt-3 text-base font-semibold text-slate-900">
                      {formatTime(status?.last_polled_at)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">
                      下次轮询
                    </div>
                    <div className="mt-3 text-base font-semibold text-slate-900">
                      {formatTime(status?.next_poll_at)}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <div className="text-sm font-medium text-slate-900">
                      活跃任务
                    </div>
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
      <AutomationJobDetailsDialog
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        job={selectedJob}
        workspaceName={
          selectedJob
            ? (workspaceNameMap.get(selectedJob.workspace_id) ?? null)
            : null
        }
        serviceSkillContext={selectedServiceSkillContext}
        jobRuns={jobRuns}
        historyLoading={historyLoading}
        onRefreshHistory={refreshHistory}
      />
    </div>
  );
}
