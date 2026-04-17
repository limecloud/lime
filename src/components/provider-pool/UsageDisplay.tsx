import { AlertTriangle, TrendingUp, Zap, Wallet } from "lucide-react";
import type { UsageInfo } from "@/lib/api/usage";

interface UsageDisplayProps {
  usage: UsageInfo;
  loading?: boolean;
}

/**
 * 用量显示组件
 *
 * 显示订阅类型、总额度、已使用、余额
 * 低余额时显示警告样式
 *
 * _Requirements: 3.3, 3.4_
 */
export function UsageDisplay({ usage, loading }: UsageDisplayProps) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3 mb-3" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    );
  }

  // 计算使用百分比
  const usagePercent =
    usage.usageLimit > 0
      ? Math.round((usage.currentUsage / usage.usageLimit) * 100)
      : 0;

  // 格式化数字
  const formatNumber = (num: number) => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toFixed(1);
  };

  return (
    <div
      className={`rounded-lg border p-4 ${
        usage.isLowBalance
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-border bg-card"
      }`}
    >
      {/* 标题和警告 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">
            {usage.subscriptionTitle || "用量信息"}
          </span>
        </div>
        {usage.isLowBalance && (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-medium">余额不足</span>
          </div>
        )}
      </div>

      {/* 进度条 */}
      <div className="mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              usage.isLowBalance
                ? "bg-amber-500"
                : "bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)]"
            }`}
            style={{ width: `${Math.min(usagePercent, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-muted-foreground">
          <span>已使用 {usagePercent}%</span>
          <span>剩余 {100 - usagePercent}%</span>
        </div>
      </div>

      {/* 数据统计 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <TrendingUp className="h-3 w-3" />
            <span className="text-xs">总额度</span>
          </div>
          <div className="font-semibold text-sm">
            {formatNumber(usage.usageLimit)}
          </div>
        </div>

        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
            <Zap className="h-3 w-3" />
            <span className="text-xs">已使用</span>
          </div>
          <div className="font-semibold text-sm">
            {formatNumber(usage.currentUsage)}
          </div>
        </div>

        <div
          className={`text-center p-2 rounded-lg ${
            usage.isLowBalance
              ? "bg-amber-100 dark:bg-amber-900/30"
              : "bg-muted/50"
          }`}
        >
          <div
            className={`flex items-center justify-center gap-1 mb-1 ${
              usage.isLowBalance
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground"
            }`}
          >
            <Wallet className="h-3 w-3" />
            <span className="text-xs">余额</span>
          </div>
          <div
            className={`font-semibold text-sm ${
              usage.isLowBalance ? "text-amber-600 dark:text-amber-400" : ""
            }`}
          >
            {formatNumber(usage.balance)}
          </div>
        </div>
      </div>
    </div>
  );
}
