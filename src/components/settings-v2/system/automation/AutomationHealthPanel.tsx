import { Activity, AlertTriangle, Clock3, PauseCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AutomationHealthResult, AutomationStatus } from "@/lib/api/automation";

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
      return status || "待执行";
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

function SummaryPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: number;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-sm text-slate-600">
      <Icon className="h-4 w-4 text-slate-500" />
      <span>{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  );
}

export function AutomationHealthPanel({
  health,
  status,
}: {
  health: AutomationHealthResult | null;
  status: AutomationStatus | null;
}) {
  const riskyJobs = health?.risky_jobs.slice(0, 6) ?? [];

  return (
    <Card className="rounded-[28px] border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl text-slate-900">风险提醒</CardTitle>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              统计只作为辅助提醒，优先处理等待人工、失败和冷却中的持续流程。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={status?.running ? "default" : "outline"}>
              {status?.running ? "轮询运行中" : "轮询已停止"}
            </Badge>
            <Badge variant="outline">
              累计执行 {status?.total_executions ?? 0}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <SummaryPill
            icon={Activity}
            label="启用"
            value={health?.enabled_jobs ?? 0}
          />
          <SummaryPill
            icon={Clock3}
            label="待执行"
            value={health?.pending_jobs ?? 0}
          />
          <SummaryPill
            icon={AlertTriangle}
            label="24h 失败"
            value={health?.failed_last_24h ?? 0}
          />
          <SummaryPill
            icon={PauseCircle}
            label="冷却"
            value={health?.cooldown_jobs ?? 0}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
          <span>最近轮询: {formatTime(status?.last_polled_at)}</span>
          <span>下次轮询: {formatTime(status?.next_poll_at)}</span>
          <span>最近轮询命中: {status?.last_job_count ?? 0}</span>
        </div>

        {riskyJobs.length ? (
          <div className="space-y-3">
            {riskyJobs.map((job) => (
              <div
                key={job.job_id}
                className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {job.name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      失败 {job.consecutive_failures} 次，重试 {job.retry_count}{" "}
                      次
                    </div>
                  </div>
                  <Badge variant={statusVariant(job.status)}>
                    {statusLabel(job.status)}
                  </Badge>
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  冷却结束: {formatTime(job.auto_disabled_until)} · 更新时间:{" "}
                  {formatTime(job.updated_at)}
                </div>
                {job.detail_message ? (
                  <div className="mt-3 rounded-[16px] border border-slate-200/80 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                    {job.detail_message}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/60 p-6 text-sm text-slate-500">
            当前没有高风险持续流程。
          </div>
        )}
      </CardContent>
    </Card>
  );
}
