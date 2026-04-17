/**
 * 数据统计页面组件
 *
 * 采用设置首页一致的浅渐变摘要头图与信息面板布局，
 * 聚合使用强度、模型分布与趋势信息。
 */

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Brain,
  CalendarDays,
  Coins,
  RefreshCw,
} from "lucide-react";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { cn } from "@/lib/utils";
import {
  getDailyUsageTrends,
  getModelUsageRanking,
  getUsageStats,
  type DailyUsage,
  type ModelUsage,
  type UsageStatsResponse,
} from "@/lib/api/usageStats";

type TimeRange = "week" | "month" | "all";

interface TimeRangeOption {
  key: TimeRange;
  label: string;
  description: string;
}

interface SegmentCardProps {
  title: string;
  description: string;
  conversations: number;
  messages: number;
  tokens: number;
  minutes: number;
  accentClassName: string;
}

const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  {
    key: "week",
    label: "本周",
    description: "聚焦最近 7 天的使用波动。",
  },
  {
    key: "month",
    label: "本月",
    description: "观察近 30 天的日常使用节奏。",
  },
  {
    key: "all",
    label: "全部",
    description: "回看累计使用规模与长期趋势。",
  },
];

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const ACTIVE_TIME_RANGE_BUTTON_CLASS =
  "border-emerald-200 bg-[linear-gradient(135deg,rgba(240,253,250,0.98)_0%,rgba(236,253,245,0.96)_52%,rgba(224,242,254,0.95)_100%)] text-slate-800 shadow-sm shadow-emerald-950/10";
const PROGRESS_BAR_FILL_CLASS =
  "bg-[linear-gradient(90deg,#14b8a6_0%,#10b981_100%)]";

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function formatTime(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
}

function parseUsageDate(date: string) {
  return new Date(date.includes("T") ? date : `${date}T00:00:00`);
}

function formatShortDate(date: string) {
  return parseUsageDate(date).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}

function estimateMinutesFromTokens(
  tokens: number,
  totalTokens: number,
  totalMinutes: number,
) {
  if (tokens <= 0 || totalTokens <= 0 || totalMinutes <= 0) {
    return 0;
  }

  return Math.round((tokens / totalTokens) * totalMinutes);
}

function resolveHeatmapTone(tokens: number, maxTokens: number) {
  if (tokens <= 0 || maxTokens <= 0) {
    return "bg-slate-100";
  }

  const ratio = tokens / maxTokens;
  if (ratio < 0.2) return "bg-emerald-100";
  if (ratio < 0.4) return "bg-emerald-200";
  if (ratio < 0.6) return "bg-emerald-300";
  if (ratio < 0.8) return "bg-emerald-400";
  return "bg-emerald-500";
}

function SegmentCard({
  title,
  description,
  conversations,
  messages,
  tokens,
  minutes,
  accentClassName,
}: SegmentCardProps) {
  return (
    <article className="rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
              accentClassName,
            )}
          >
            {title}
          </span>
          <WorkbenchInfoTip
            ariaLabel={`${title}区段说明`}
            content={description}
            tone="slate"
          />
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
            {messages} 条消息
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            对话：{conversations}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            Token：{formatNumber(tokens)}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            时长：{formatTime(minutes)}
          </span>
        </div>
      </div>
    </article>
  );
}

export function StatsSettings() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("month");

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

  const maxDailyTokens =
    dailyUsage.length > 0
      ? Math.max(...dailyUsage.map((day) => day.tokens))
      : 0;
  const totalRangeTokens = dailyUsage.reduce((sum, day) => sum + day.tokens, 0);
  const totalRangeConversations = dailyUsage.reduce(
    (sum, day) => sum + day.conversations,
    0,
  );
  const activeDays = dailyUsage.filter(
    (day) => day.tokens > 0 || day.conversations > 0,
  ).length;
  const averageDailyTokens =
    activeDays > 0 ? Math.round(totalRangeTokens / activeDays) : 0;
  const peakDay = dailyUsage.reduce<DailyUsage | null>((currentPeak, day) => {
    if (!currentPeak || day.tokens > currentPeak.tokens) {
      return day;
    }
    return currentPeak;
  }, null);
  const topModel = modelUsage[0] || null;
  const secondaryModels = modelUsage.slice(1, 4);
  const selectedRange =
    TIME_RANGE_OPTIONS.find((option) => option.key === timeRange) ||
    TIME_RANGE_OPTIONS[1];
  const peakDayLabel = peakDay
    ? `${formatShortDate(peakDay.date)} · ${formatNumber(peakDay.tokens)} Token`
    : "暂无数据";
  const chartGuideValues =
    maxDailyTokens > 0
      ? [1, 0.75, 0.5, 0.25, 0].map((ratio) =>
          Math.round(maxDailyTokens * ratio),
        )
      : [0, 0, 0, 0, 0];
  const trendLabelStep =
    dailyUsage.length > 10 ? Math.ceil(dailyUsage.length / 7) : 1;
  const heatmapDays = dailyUsage.slice(-35);
  const heatmapRangeLabel =
    heatmapDays.length > 0
      ? `${formatShortDate(heatmapDays[0].date)} - ${formatShortDate(
          heatmapDays[heatmapDays.length - 1].date,
        )}`
      : "暂无活跃记录";
  const heatmapCells: Array<DailyUsage | null> = [
    ...Array.from({ length: Math.max(35 - heatmapDays.length, 0) }, () => null),
    ...heatmapDays,
  ];
  const isInitialLoading = loading && !stats && !error;

  if (isInitialLoading) {
    return (
      <div className="space-y-6 pb-8">
        <div className="h-[132px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
          <div className="h-[398px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="space-y-6">
            <div className="h-[260px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
            <div className="h-[220px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
          <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
          <div className="h-[320px] animate-pulse rounded-[26px] border border-slate-200/80 bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      {error && (
        <div className="flex items-center justify-between gap-4 rounded-[20px] border border-rose-200 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 shadow-sm shadow-slate-950/5">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadStats}
            className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-50"
          >
            重新加载
          </button>
        </div>
      )}

      <section className="rounded-[26px] border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-950/5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-semibold tracking-tight text-slate-900">
                数据统计
              </h1>
              <WorkbenchInfoTip
                ariaLabel="使用统计总览说明"
                content="管理当前区间的 Token 消耗、活跃天数、模型分布和趋势观察。"
                tone="mint"
              />
            </div>
            <p className="text-sm text-slate-500">
              查看当前区间的使用强度、模型分布和趋势。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {TIME_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTimeRange(option.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                  timeRange === option.key
                    ? ACTIVE_TIME_RANGE_BUTTON_CLASS
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900",
                )}
              >
                {option.label}
              </button>
            ))}

            <button
              type="button"
              onClick={loadStats}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新数据
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 rounded-[20px] border border-slate-200/80 bg-slate-50/60 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                当前统计口径：{selectedRange.label}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                活跃 {activeDays} 天
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                日均 {formatNumber(averageDailyTokens)} Token
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                当前区间 {formatNumber(totalRangeTokens)} Token
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-slate-500">
              <span>当前观察</span>
              <WorkbenchInfoTip
                ariaLabel="当前观察说明"
                content="用一个摘要面板快速查看这段时间的主要节奏。"
                tone="slate"
              />
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                主力模型：{topModel?.model || "暂无数据"}
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500">
                峰值：{peakDayLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs leading-5 text-slate-500">
            <span>当前统计口径说明已收纳</span>
            <WorkbenchInfoTip
              ariaLabel="当前统计口径说明"
              content={selectedRange.description}
              tone="slate"
            />
          </div>
        </div>
      </section>

      {stats ? (
        <>
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.72fr)_minmax(360px,0.82fr)]">
            <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <BarChart3 className="h-4 w-4 text-sky-600" />
                    阶段概览
                    <WorkbenchInfoTip
                      ariaLabel="阶段概览说明"
                      content="按今日、本月与累计三个区段拆解对话量、Token 消耗和估算时长。"
                      tone="slate"
                    />
                  </div>
                </div>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
                  3 个区段
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <SegmentCard
                  title="今日"
                  description="快速判断当前是否处于高频使用状态。"
                  conversations={stats.today_conversations}
                  messages={stats.today_messages}
                  tokens={stats.today_tokens}
                  minutes={estimateMinutesFromTokens(
                    stats.today_tokens,
                    stats.total_tokens,
                    stats.total_time_minutes,
                  )}
                  accentClassName="border-sky-200 bg-sky-50 text-sky-700"
                />
                <SegmentCard
                  title="本月"
                  description="观察最近一个月的常态使用节奏。"
                  conversations={stats.monthly_conversations}
                  messages={stats.monthly_messages}
                  tokens={stats.monthly_tokens}
                  minutes={estimateMinutesFromTokens(
                    stats.monthly_tokens,
                    stats.total_tokens,
                    stats.total_time_minutes,
                  )}
                  accentClassName="border-emerald-200 bg-emerald-50 text-emerald-700"
                />
                <SegmentCard
                  title="累计"
                  description="回看整体使用规模与长期投入。"
                  conversations={stats.total_conversations}
                  messages={stats.total_messages}
                  tokens={stats.total_tokens}
                  minutes={stats.total_time_minutes}
                  accentClassName="border-slate-200 bg-slate-100 text-slate-700"
                />
              </div>
            </article>

            <div className="space-y-6">
              <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Brain className="h-4 w-4 text-emerald-600" />
                      模型使用排行
                      <WorkbenchInfoTip
                        ariaLabel="模型使用排行说明"
                        content="查看当前区间内最常使用的模型与使用占比。"
                        tone="slate"
                      />
                    </div>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    {modelUsage.length} 个模型
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  {modelUsage.length > 0 ? (
                    <>
                      <article className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                                #1 主力模型
                              </span>
                              <p className="truncate text-base font-semibold text-slate-900">
                                {topModel?.model}
                              </p>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-500">
                              {topModel?.conversations || 0} 次对话 ·{" "}
                              {formatNumber(topModel?.tokens || 0)} Token
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                              使用占比：{topModel?.percentage || 0}%
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                              排名：#1
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              PROGRESS_BAR_FILL_CLASS,
                            )}
                            style={{
                              width: `${Math.min(topModel?.percentage || 0, 100)}%`,
                            }}
                          />
                        </div>
                      </article>

                      {secondaryModels.length > 0 ? (
                        <div className="space-y-3">
                          {secondaryModels.map((model, index) => (
                            <div
                              key={model.model}
                              className="rounded-[20px] border border-slate-200/80 bg-slate-50/60 p-4"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                      #{index + 2}
                                    </span>
                                    <p className="truncate text-sm font-semibold text-slate-900">
                                      {model.model}
                                    </p>
                                  </div>
                                  <p className="mt-2 text-xs leading-5 text-slate-500">
                                    {model.conversations} 次对话 ·{" "}
                                    {formatNumber(model.tokens)} Token
                                  </p>
                                </div>
                                <span className="text-sm font-semibold text-slate-900">
                                  {model.percentage}%
                                </span>
                              </div>
                              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    PROGRESS_BAR_FILL_CLASS,
                                  )}
                                  style={{
                                    width: `${Math.min(model.percentage, 100)}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-sm leading-6 text-slate-500">
                      当前区间还没有模型使用数据。
                    </div>
                  )}
                </div>
              </article>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.72fr)_minmax(360px,0.82fr)]">
            <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Coins className="h-4 w-4 text-emerald-600" />
                    每日使用趋势
                    <WorkbenchInfoTip
                      ariaLabel="每日使用趋势说明"
                      content={`观察 ${selectedRange.label} 内每日 Token 波动，识别高峰与低谷。`}
                      tone="slate"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    {formatNumber(totalRangeTokens)} Token
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                    {totalRangeConversations} 次对话
                  </span>
                </div>
              </div>

              {dailyUsage.length > 0 ? (
                <div className="mt-6 rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                      峰值日：{peakDayLabel}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                      活跃天数：{activeDays}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                      区间均值：{formatNumber(averageDailyTokens)}
                    </span>
                  </div>

                  <div className="mt-6 grid grid-cols-[44px_minmax(0,1fr)] gap-3">
                    <div className="relative h-64">
                      {chartGuideValues.map((value, index) => (
                        <div
                          key={`${value}-${index}`}
                          className="absolute right-0 translate-y-1/2 text-[10px] font-medium text-slate-400"
                          style={{
                            bottom: `${(index / (chartGuideValues.length - 1)) * 100}%`,
                          }}
                        >
                          {formatNumber(value)}
                        </div>
                      ))}
                    </div>

                    <div className="relative h-64">
                      <div className="pointer-events-none absolute inset-0">
                        {chartGuideValues.map((_, index) => (
                          <div
                            key={index}
                            className="absolute inset-x-0 border-t border-dashed border-slate-200"
                            style={{
                              bottom: `${(index / (chartGuideValues.length - 1)) * 100}%`,
                            }}
                          />
                        ))}
                      </div>

                      <div className="relative flex h-full items-end gap-2">
                        {dailyUsage.map((day, index) => {
                          const height =
                            maxDailyTokens > 0
                              ? (day.tokens / maxDailyTokens) * 100
                              : 0;
                          const showLabel =
                            index % trendLabelStep === 0 ||
                            index === dailyUsage.length - 1;

                          return (
                            <div
                              key={day.date}
                              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                            >
                              <div className="relative flex w-full flex-1 items-end rounded-[16px] border border-white/90 bg-white/80 px-1.5 pb-1.5 shadow-sm">
                                <div
                                  className="w-full rounded-[12px] bg-[linear-gradient(180deg,rgba(15,23,42,0.72)_0%,rgba(15,23,42,0.96)_100%)] transition-all group-hover:brightness-105"
                                  style={{ height: `${Math.max(height, 6)}%` }}
                                >
                                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 whitespace-nowrap">
                                    {formatNumber(day.tokens)} Token
                                  </div>
                                </div>
                              </div>
                              <div className="h-4 text-[10px] text-slate-400">
                                {showLabel ? formatShortDate(day.date) : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center text-sm leading-6 text-slate-500">
                  当前区间还没有每日趋势数据。
                </div>
              )}
            </article>

            <article className="rounded-[26px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <CalendarDays className="h-4 w-4 text-sky-600" />
                    活跃度日历
                    <WorkbenchInfoTip
                      ariaLabel="活跃度日历说明"
                      content="以最近 35 天的活跃热度查看调用分布，颜色越深表示 Token 越多。"
                      tone="slate"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>少</span>
                  <div className="flex gap-1">
                    <div className="h-3 w-3 rounded-sm bg-emerald-100" />
                    <div className="h-3 w-3 rounded-sm bg-emerald-200" />
                    <div className="h-3 w-3 rounded-sm bg-emerald-300" />
                    <div className="h-3 w-3 rounded-sm bg-emerald-400" />
                    <div className="h-3 w-3 rounded-sm bg-emerald-500" />
                  </div>
                  <span>多</span>
                </div>
              </div>

              <div className="mt-6 rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    覆盖范围：{heatmapRangeLabel}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                    有效活跃格：{activeDays}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-7 gap-2">
                  {WEEKDAY_LABELS.map((day) => (
                    <div
                      key={day}
                      className="pb-1 text-center text-[11px] font-medium text-slate-400"
                    >
                      {day}
                    </div>
                  ))}
                  {heatmapCells.map((day, index) => (
                    <div
                      key={`${day?.date || "empty"}-${index}`}
                      className={cn(
                        "group relative aspect-square rounded-[10px] border border-white/80 shadow-sm transition-transform hover:-translate-y-0.5",
                        day
                          ? resolveHeatmapTone(day.tokens, maxDailyTokens)
                          : "bg-slate-100",
                      )}
                      title={
                        day
                          ? `${day.date}: ${formatNumber(day.tokens)} Token`
                          : ""
                      }
                    >
                      {day ? (
                        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 whitespace-nowrap">
                          {formatShortDate(day.date)} ·{" "}
                          {formatNumber(day.tokens)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>
        </>
      ) : (
        <article className="rounded-[26px] border border-dashed border-slate-300 bg-white/80 px-6 py-12 text-center text-sm leading-6 text-slate-500 shadow-sm shadow-slate-950/5">
          还没有可展示的统计数据。
        </article>
      )}
    </div>
  );
}
