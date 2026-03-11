/**
 * 数据统计页面组件
 *
 * 参考成熟产品的数据统计实现
 * 功能包括：使用统计数据展示、Token 消耗统计等
 */

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  MessageSquare,
  Timer,
  Coins,
  TrendingUp,
  Download,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getDailyUsageTrends,
  getModelUsageRanking,
  getUsageStats,
  type DailyUsage,
  type ModelUsage,
  type UsageStatsResponse,
} from "@/lib/api/usageStats";

export function StatsSettings() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<"week" | "month" | "all">("month");

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usageStats, ranking, trends] = await Promise.all([
        getUsageStats(timeRange),
        getModelUsageRanking(timeRange),
        getDailyUsageTrends(timeRange),
      ]);

      setStats(usageStats);
      setModelUsage(ranking);
      setDailyUsage(trends);
    } catch (e) {
      console.error("加载统计数据失败:", e);
      setError(e instanceof Error ? e.message : "加载统计数据失败");
      setStats(null);
      setModelUsage([]);
      setDailyUsage([]);
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatTime = (minutes: number): string => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}m`;
  };

  const StatCard = ({
    icon: Icon,
    label,
    value,
    subvalue,
    trend,
  }: {
    icon: any;
    label: string;
    value: string;
    subvalue?: string;
    trend?: number;
  }) => (
    <div className="flex-1 min-w-[140px] p-4 rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold text-primary mb-1">{value}</div>
      {subvalue && (
        <div className="text-xs text-muted-foreground">{subvalue}</div>
      )}
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          <TrendingUp className="h-3 w-3 text-green-500" />
          <span className="text-xs text-green-500">{trend}%</span>
        </div>
      )}
    </div>
  );

  const maxDailyTokens =
    dailyUsage.length > 0
      ? Math.max(...dailyUsage.map((day) => day.tokens))
      : 0;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* 时间范围选择 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">使用统计</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTimeRange("week")}
            className={cn(
              "px-3 py-1.5 rounded text-sm transition-colors",
              timeRange === "week"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            本周
          </button>
          <button
            onClick={() => setTimeRange("month")}
            className={cn(
              "px-3 py-1.5 rounded text-sm transition-colors",
              timeRange === "month"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            本月
          </button>
          <button
            onClick={() => setTimeRange("all")}
            className={cn(
              "px-3 py-1.5 rounded text-sm transition-colors",
              timeRange === "all"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            全部
          </button>
          <button
            onClick={loadStats}
            disabled={loading}
            className="p-2 rounded hover:bg-muted transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : stats ? (
        <>
          {/* 今日统计 */}
          <div>
            <h3 className="text-sm font-medium mb-3">今日</h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              <StatCard
                icon={MessageSquare}
                label="对话"
                value={stats.today_conversations.toString()}
                subvalue={`${stats.today_messages} 条消息`}
              />
              <StatCard
                icon={Coins}
                label="Token"
                value={formatNumber(stats.today_tokens)}
              />
              <StatCard
                icon={Timer}
                label="时长"
                value={formatTime(
                  Math.round(
                    (stats.today_tokens / (stats.total_tokens || 1)) *
                      stats.total_time_minutes,
                  ),
                )}
              />
            </div>
          </div>

          {/* 本月统计 */}
          <div>
            <h3 className="text-sm font-medium mb-3">本月</h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              <StatCard
                icon={MessageSquare}
                label="对话"
                value={stats.monthly_conversations.toString()}
                subvalue={`${stats.monthly_messages} 条消息`}
              />
              <StatCard
                icon={Coins}
                label="Token"
                value={formatNumber(stats.monthly_tokens)}
              />
              <StatCard
                icon={Timer}
                label="时长"
                value={formatTime(
                  Math.round(
                    (stats.monthly_tokens / (stats.total_tokens || 1)) *
                      stats.total_time_minutes,
                  ),
                )}
              />
            </div>
          </div>

          {/* 总计 */}
          <div>
            <h3 className="text-sm font-medium mb-3">总计</h3>
            <div className="flex gap-3 overflow-x-auto pb-2">
              <StatCard
                icon={MessageSquare}
                label="对话"
                value={stats.total_conversations.toString()}
                subvalue={`${stats.total_messages} 条消息`}
              />
              <StatCard
                icon={Coins}
                label="Token"
                value={formatNumber(stats.total_tokens)}
              />
              <StatCard
                icon={Timer}
                label="时长"
                value={formatTime(stats.total_time_minutes)}
              />
            </div>
          </div>

          {/* 模型使用排行 */}
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-medium mb-4">模型使用排行</h3>
            {modelUsage.length > 0 ? (
              <div className="space-y-3">
                {modelUsage.map((model, index) => (
                  <div key={model.model} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          #{index + 1}
                        </span>
                        <span className="font-medium">{model.model}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>{model.conversations} 次对话</span>
                        <span>{formatNumber(model.tokens)} Token</span>
                        <span className="text-primary font-medium">
                          {model.percentage}%
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.min(model.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                暂无模型使用数据
              </div>
            )}
          </div>

          {/* 每日使用趋势 */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">每日使用趋势</h3>
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Download className="h-3 w-3" />
                导出
              </button>
            </div>
            <div className="h-40 flex items-end gap-1">
              {dailyUsage.map((day, _index) => {
                const height =
                  maxDailyTokens > 0 ? (day.tokens / maxDailyTokens) * 100 : 0;
                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center gap-1 group"
                  >
                    <div
                      className="w-full bg-primary/60 hover:bg-primary rounded-t transition-colors relative"
                      style={{ height: `${Math.max(height, 4)}%` }}
                    >
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-popover border px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {formatNumber(day.tokens)} Token
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate w-full text-center">
                      {new Date(day.date).toLocaleDateString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 使用日历热力图（简化版） */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">活跃度日历</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>少</span>
                <div className="flex gap-0.5">
                  <div className="w-3 h-3 rounded-sm bg-primary/10" />
                  <div className="w-3 h-3 rounded-sm bg-primary/30" />
                  <div className="w-3 h-3 rounded-sm bg-primary/50" />
                  <div className="w-3 h-3 rounded-sm bg-primary/70" />
                  <div className="w-3 h-3 rounded-sm bg-primary" />
                </div>
                <span>多</span>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
                <div
                  key={day}
                  className="text-xs text-muted-foreground text-center py-1"
                >
                  {day}
                </div>
              ))}
              {Array.from({ length: 35 }).map((_, index) => {
                const dayData = dailyUsage[index];
                const getIntensity = (tokens: number) => {
                  if (!dayData) return "bg-muted";
                  if (maxDailyTokens <= 0) return "bg-primary/10";
                  const max = maxDailyTokens;
                  const ratio = tokens / max;
                  if (ratio < 0.2) return "bg-primary/10";
                  if (ratio < 0.4) return "bg-primary/30";
                  if (ratio < 0.6) return "bg-primary/50";
                  if (ratio < 0.8) return "bg-primary/70";
                  return "bg-primary";
                };
                return (
                  <div
                    key={index}
                    className={cn(
                      "aspect-square rounded-sm",
                      dayData ? getIntensity(dayData.tokens) : "bg-muted",
                    )}
                    title={
                      dayData ? `${dayData.date}: ${dayData.tokens} Token` : ""
                    }
                  />
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default StatsSettings;
