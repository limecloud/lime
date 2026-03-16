import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Copy,
  Eye,
  Filter,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  AgentRun,
  AgentRunSource,
  AgentRunStatus,
  executionRunGet,
  executionRunList,
} from "@/lib/api/executionRun";

const PAGE_SIZE = 50;
const AUTO_REFRESH_INTERVAL_MS = 15_000;

type SourceFilter = "all" | AgentRunSource;
type StatusFilter = "all" | AgentRunStatus;

const SOURCE_OPTIONS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "全部来源" },
  { value: "chat", label: "Chat" },
  { value: "skill", label: "Skill" },
  { value: "automation", label: "Automation" },
];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "running", label: "运行中" },
  { value: "success", label: "成功" },
  { value: "error", label: "失败" },
  { value: "timeout", label: "超时" },
  { value: "canceled", label: "已取消" },
  { value: "queued", label: "排队中" },
];

interface ExecutionPanelProps {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
  aside?: ReactNode;
}

function ExecutionPanel({
  icon: Icon,
  title,
  description,
  children,
  aside,
}: ExecutionPanelProps) {
  return (
    <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Icon className="h-4 w-4 text-sky-600" />
            {title}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
      </div>

      <div className="mt-5">{children}</div>
    </article>
  );
}

function SummaryStat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/90 bg-white/88 p-4 shadow-sm">
      <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function SurfacePill({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function DetailField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4",
        className,
      )}
    >
      <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <div className="mt-3 text-sm leading-6 text-slate-700">{children}</div>
    </div>
  );
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "-";
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) return "-";
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(2)}s`;
  return `${(durationMs / 60_000).toFixed(2)}m`;
}

function parseMetadata(raw: string | null | undefined): string {
  if (!raw) return "-";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function statusLabel(status: AgentRunStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "success":
      return "成功";
    case "error":
      return "失败";
    case "canceled":
      return "已取消";
    case "timeout":
      return "超时";
    default:
      return status;
  }
}

function statusClassName(status: AgentRunStatus): string {
  switch (status) {
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "running":
    case "queued":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "error":
    case "timeout":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "canceled":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function sourceLabel(source: AgentRunSource): string {
  switch (source) {
    case "chat":
      return "Chat";
    case "skill":
      return "Skill";
    case "automation":
      return "Automation";
    default:
      return source;
  }
}

function sourceClassName(source: AgentRunSource): string {
  switch (source) {
    case "chat":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "skill":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "automation":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-600";
  }
}

function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  return (
    <SurfacePill className={statusClassName(status)}>
      {statusLabel(status)}
    </SurfacePill>
  );
}

function RunSourceBadge({ source }: { source: AgentRunSource }) {
  return (
    <SurfacePill className={sourceClassName(source)}>
      {sourceLabel(source)}
    </SurfacePill>
  );
}

export function ExecutionTrackerSettings() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sessionKeyword, setSessionKeyword] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);

  const loadRuns = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }

    try {
      const list = await executionRunList(PAGE_SIZE, 0);
      setRuns(list);
      setHasMore(list.length >= PAGE_SIZE);
      setLastSyncedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    } catch (error) {
      toast.error(
        `加载执行轨迹失败: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;

    const timer = window.setInterval(() => {
      void loadRuns({ silent: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshEnabled, loadRuns]);

  const copyText = useCallback(async (text: string, successText: string) => {
    const value = text.trim();
    if (!value || value === "-") {
      toast.info("无可复制内容");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(successText);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }, []);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const list = await executionRunList(PAGE_SIZE, runs.length);
      setRuns((prev) => [...prev, ...list]);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (error) {
      toast.error(
        `加载更多失败: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const handleViewDetail = async (run: AgentRun) => {
    setSelectedRun(run);
    setDetailOpen(true);
    setDetailLoading(true);

    try {
      const latest = await executionRunGet(run.id);
      if (latest) {
        setSelectedRun(latest);
      }
    } catch (error) {
      toast.error(
        `加载详情失败: ${error instanceof Error ? error.message : error}`,
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredRuns = useMemo(() => {
    const keyword = sessionKeyword.trim().toLowerCase();
    return runs.filter((run) => {
      if (sourceFilter !== "all" && run.source !== sourceFilter) return false;
      if (statusFilter !== "all" && run.status !== statusFilter) return false;
      if (!keyword) return true;

      const sessionId = (run.session_id || "").toLowerCase();
      return sessionId.includes(keyword);
    });
  }, [runs, sourceFilter, statusFilter, sessionKeyword]);

  const summary = useMemo(() => {
    const activeCount = runs.filter(
      (run) => run.status === "running" || run.status === "queued",
    ).length;
    const issueCount = runs.filter(
      (run) => run.status === "error" || run.status === "timeout",
    ).length;
    const activeSourceCount = new Set(runs.map((run) => run.source)).size;

    return {
      totalCount: runs.length,
      visibleCount: filteredRuns.length,
      activeCount,
      issueCount,
      activeSourceCount,
    };
  }, [filteredRuns.length, runs]);

  const selectedMetadata = useMemo(
    () => parseMetadata(selectedRun?.metadata),
    [selectedRun?.metadata],
  );
  const selectedErrorMessage = selectedRun?.error_message || "-";
  const selectedSessionId = selectedRun?.session_id || "-";
  const autoRefreshHint = autoRefreshEnabled
    ? `自动刷新中（${AUTO_REFRESH_INTERVAL_MS / 1000}s）`
    : "自动刷新已关闭";
  const latestRunTime = runs[0]?.started_at
    ? formatTime(runs[0].started_at)
    : "暂无记录";

  return (
    <div className="space-y-6 pb-8">
      <section className="relative overflow-hidden rounded-[30px] border border-sky-200/70 bg-[linear-gradient(135deg,rgba(244,250,255,0.98)_0%,rgba(248,250,252,0.98)_48%,rgba(242,248,250,0.96)_100%)] shadow-sm shadow-slate-950/5">
        <div className="pointer-events-none absolute -left-20 top-[-72px] h-56 w-56 rounded-full bg-sky-200/28 blur-3xl" />
        <div className="pointer-events-none absolute right-[-76px] top-[-18px] h-56 w-56 rounded-full bg-emerald-200/24 blur-3xl" />

        <div className="relative flex flex-col gap-6 p-6 lg:p-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
            <div className="max-w-3xl space-y-5">
              <span className="inline-flex items-center rounded-full border border-sky-200 bg-white/85 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-700 shadow-sm">
                EXECUTION TRACKER
              </span>

              <div className="space-y-2">
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900">
                  把 Chat、Skill 和 Automation 的执行轨迹放进同一个排查工作台
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600">
                  这里优先解决“刚刚发生了什么”这个问题。你可以统一看状态、会话 ID、
                  来源引用和错误信息，再决定是否继续下钻到单条详情。
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <SurfacePill className="border-white/90 bg-white/88 text-slate-600 shadow-sm">
                  最近同步 {lastSyncedAt ?? "尚未完成"}
                </SurfacePill>
                <SurfacePill
                  className={cn(
                    autoRefreshEnabled
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-100 text-slate-500",
                  )}
                >
                  {autoRefreshHint}
                </SurfacePill>
                <SurfacePill className="border-white/90 bg-white/88 text-slate-600 shadow-sm">
                  当前可见 {summary.visibleCount} 条
                </SurfacePill>
              </div>
            </div>

            <div className="rounded-[26px] border border-white/90 bg-white/84 p-5 shadow-sm shadow-slate-950/5 backdrop-blur-[2px]">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-200 bg-sky-100 text-sky-700">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-slate-900">
                      当前同步概览
                    </h2>
                    <SurfacePill className="border-slate-200 bg-slate-100 text-slate-600">
                      已加载 {summary.totalCount} 条
                    </SurfacePill>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    列表默认抓取最近一页记录；需要更早记录时可继续向后加载。
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SummaryStat
                  label="活跃任务"
                  value={summary.activeCount.toString()}
                  description="运行中与排队中的任务会优先占据注意力。"
                />
                <SummaryStat
                  label="风险记录"
                  value={summary.issueCount.toString()}
                  description="失败与超时通常值得先查看详情和上下文。"
                />
                <SummaryStat
                  label="来源覆盖"
                  value={summary.activeSourceCount.toString()}
                  description="表示最近这一批记录覆盖了多少种入口来源。"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => void loadRuns()}
                  disabled={loading}
                  className="h-10 rounded-full border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw
                    className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                  />
                  立即刷新
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.14fr)_minmax(320px,0.86fr)]">
        <div className="space-y-6">
          <ExecutionPanel
            icon={Activity}
            title="轨迹列表"
            description="保留表格式信息密度，但把重点状态和操作都收敛到同一张主卡片内。"
            aside={
              <>
                <SurfacePill className="border-slate-200 bg-slate-100 text-slate-600">
                  最近启动 {latestRunTime}
                </SurfacePill>
                <SurfacePill className="border-slate-200 bg-slate-100 text-slate-600">
                  显示 {summary.visibleCount} / {summary.totalCount}
                </SurfacePill>
              </>
            }
          >
            <div className="space-y-4">
              <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white">
                {loading ? (
                  <div className="flex min-h-[260px] items-center justify-center gap-3 px-6 py-12 text-sm text-slate-500">
                    <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                    正在加载最近执行轨迹...
                  </div>
                ) : filteredRuns.length === 0 ? (
                  <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-slate-400">
                      <Activity className="h-5 w-5" />
                    </div>
                    <p className="mt-4 text-base font-medium text-slate-900">
                      暂无匹配的执行记录
                    </p>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                      可以先清空搜索词或放宽状态、来源筛选条件，再重新查看最近同步结果。
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[900px]">
                      <TableHeader>
                        <TableRow className="border-slate-200/80 bg-slate-50/80">
                          <TableHead>开始时间</TableHead>
                          <TableHead>来源</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>耗时</TableHead>
                          <TableHead>会话 ID</TableHead>
                          <TableHead>引用</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRuns.map((run) => (
                          <TableRow
                            key={run.id}
                            className="border-slate-200/70 hover:bg-slate-50/60"
                          >
                            <TableCell className="whitespace-nowrap text-slate-700">
                              {formatTime(run.started_at)}
                            </TableCell>
                            <TableCell>
                              <RunSourceBadge source={run.source} />
                            </TableCell>
                            <TableCell>
                              <RunStatusBadge status={run.status} />
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {formatDuration(run.duration_ms)}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-slate-600">
                              {run.session_id || "-"}
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate text-slate-600">
                              {run.source_ref || "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleViewDetail(run)}
                                className="rounded-full text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                              >
                                <Eye className="mr-1 h-4 w-4" />
                                详情
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {hasMore && !loading ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="rounded-full border-slate-200 bg-white px-4 text-slate-700 hover:bg-slate-50"
                  >
                    {loadingMore ? "加载中..." : "加载更多记录"}
                  </Button>
                </div>
              ) : null}
            </div>
          </ExecutionPanel>
        </div>

        <div className="space-y-6">
          <ExecutionPanel
            icon={Filter}
            title="筛选与同步"
            description="把来源、状态、会话搜索和自动刷新统一放在一张侧栏卡里，减少主列表干扰。"
            aside={
              <SurfacePill
                className={cn(
                  autoRefreshEnabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-100 text-slate-500",
                )}
              >
                {autoRefreshEnabled ? "自动刷新开启" : "自动刷新关闭"}
              </SurfacePill>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3">
                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    来源
                  </p>
                  <Select
                    value={sourceFilter}
                    onValueChange={(value) => setSourceFilter(value as SourceFilter)}
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white text-slate-700">
                      <SelectValue placeholder="来源过滤" />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    状态
                  </p>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as StatusFilter)}
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white text-slate-700">
                      <SelectValue placeholder="状态过滤" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium tracking-[0.12em] text-slate-500">
                    会话搜索
                  </p>
                  <Input
                    value={sessionKeyword}
                    onChange={(event) => setSessionKeyword(event.target.value)}
                    placeholder="按 session_id 搜索"
                    className="h-11 rounded-2xl border-slate-200 bg-white text-slate-700 placeholder:text-slate-400"
                  />
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-slate-900">
                      自动刷新
                    </p>
                    <p className="text-sm leading-6 text-slate-500">
                      打开后会按固定周期静默同步，便于持续观察近期执行状态。
                    </p>
                  </div>
                  <Switch
                    checked={autoRefreshEnabled}
                    onCheckedChange={setAutoRefreshEnabled}
                    aria-label="切换执行轨迹自动刷新"
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <SurfacePill className="border-white/90 bg-white text-slate-600">
                    最近同步 {lastSyncedAt ?? "尚未同步"}
                  </SurfacePill>
                  <SurfacePill className="border-white/90 bg-white text-slate-600">
                    当前结果 {summary.visibleCount} 条
                  </SurfacePill>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => void loadRuns()}
                disabled={loading}
                className="h-10 w-full rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
                />
                手动同步一次
              </Button>
            </div>
          </ExecutionPanel>

          <ExecutionPanel
            icon={Sparkles}
            title="查看约定"
            description="先看状态，再看上下文，最后复制关键字段，避免一开始就陷入原始 metadata。"
          >
            <div className="space-y-3">
              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-sky-200 bg-sky-100 text-sky-700">
                    <Clock3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      先看活跃与失败状态
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      排队中、运行中、失败和超时最容易说明当前系统是否卡住或出现回退。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-100 text-emerald-700">
                    <Eye className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      再看详情里的会话 ID 与来源引用
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      这两个字段通常足够把一次执行和上层交互、工作流节点或自动化入口对应起来。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[22px] border border-slate-200/80 bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl border border-amber-200 bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      metadata 只在需要补充上下文时再看
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      原始 metadata 信息量更大，适合在已经确定问题边界后再下钻，而不是一开始通读。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </ExecutionPanel>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="border border-slate-200 bg-white p-0 shadow-xl sm:max-w-[820px]">
          <div className="border-b border-slate-200/80 px-6 py-5">
            <DialogHeader className="space-y-3 text-left">
              {selectedRun ? (
                <div className="flex flex-wrap items-center gap-2">
                  <RunSourceBadge source={selectedRun.source} />
                  <RunStatusBadge status={selectedRun.status} />
                </div>
              ) : null}
              <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                执行详情
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-500">
                run_id: <code>{selectedRun?.id || "-"}</code>
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="px-6 py-6">
            {detailLoading ? (
              <div className="flex min-h-[240px] items-center justify-center gap-3 text-sm text-slate-500">
                <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
                正在加载执行详情...
              </div>
            ) : selectedRun ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <DetailField label="开始时间">
                    {formatTime(selectedRun.started_at)}
                  </DetailField>
                  <DetailField label="结束时间">
                    {formatTime(selectedRun.finished_at)}
                  </DetailField>
                  <DetailField label="耗时">
                    {formatDuration(selectedRun.duration_ms)}
                  </DetailField>
                  <DetailField label="错误码">
                    {selectedRun.error_code || "-"}
                  </DetailField>
                  <DetailField label="会话 ID" className="md:col-span-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="break-all">{selectedSessionId}</div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyText(selectedSessionId, "会话 ID 已复制")}
                        className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        复制
                      </Button>
                    </div>
                  </DetailField>
                  <DetailField label="来源引用" className="md:col-span-2">
                    {selectedRun.source_ref || "-"}
                  </DetailField>
                  <DetailField label="错误信息" className="md:col-span-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="whitespace-pre-wrap break-words">
                        {selectedErrorMessage}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void copyText(selectedErrorMessage, "错误信息已复制")
                        }
                        className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        复制
                      </Button>
                    </div>
                  </DetailField>
                </div>

                <DetailField label="Metadata">
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyText(selectedMetadata, "Metadata 已复制")}
                        className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="mr-1 h-4 w-4" />
                        复制
                      </Button>
                    </div>
                    <pre className="overflow-x-auto rounded-[18px] border border-slate-200/80 bg-white p-4 text-xs leading-6 text-slate-600">
                      {selectedMetadata}
                    </pre>
                  </div>
                </DetailField>
              </div>
            ) : (
              <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500">
                未找到执行详情
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
