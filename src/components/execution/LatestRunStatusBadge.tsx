import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  AgentRun,
  AgentRunSource,
  AgentRunStatus,
  executionRunList,
} from "@/lib/api/executionRun";

interface LatestRunStatusBadgeProps {
  source: AgentRunSource;
  label?: string;
  className?: string;
  pollMs?: number;
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

function statusVariant(status: AgentRunStatus) {
  if (status === "success") return "default" as const;
  if (status === "running" || status === "queued") return "secondary" as const;
  if (status === "error" || status === "timeout") return "destructive" as const;
  return "outline" as const;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function LatestRunStatusBadge({
  source,
  label = "最近执行",
  className,
  pollMs = 15_000,
}: LatestRunStatusBadgeProps) {
  const [latestRun, setLatestRun] = useState<AgentRun | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await executionRunList(30, 0);
      const run = list.find((item) => item.source === source) || null;
      setLatestRun(run);
    } catch {
      // 查询失败时保持静默，避免干扰主流程
    }
  }, [source]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, pollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  const statusText = useMemo(() => {
    if (!latestRun) return "暂无记录";
    return statusLabel(latestRun.status);
  }, [latestRun]);

  if (!latestRun) {
    return (
      <div className={className}>
        <span className="text-xs text-muted-foreground">{label}: 暂无记录</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <Badge variant={statusVariant(latestRun.status)}>{statusText}</Badge>
        <span className="truncate">
          时间: {formatTime(latestRun.started_at)}
        </span>
      </div>
    </div>
  );
}
