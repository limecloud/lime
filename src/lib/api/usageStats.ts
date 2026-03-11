import { safeInvoke } from "@/lib/dev-bridge";

export interface UsageStatsResponse {
  total_conversations: number;
  total_messages: number;
  total_tokens: number;
  total_time_minutes: number;
  monthly_conversations: number;
  monthly_messages: number;
  monthly_tokens: number;
  today_conversations: number;
  today_messages: number;
  today_tokens: number;
}

export interface ModelUsage {
  model: string;
  conversations: number;
  tokens: number;
  percentage: number;
}

export interface DailyUsage {
  date: string;
  conversations: number;
  tokens: number;
}

export async function getUsageStats(
  timeRange: string,
): Promise<UsageStatsResponse> {
  return safeInvoke("get_usage_stats", { timeRange });
}

export async function getModelUsageRanking(
  timeRange: string,
): Promise<ModelUsage[]> {
  return safeInvoke("get_model_usage_ranking", { timeRange });
}

export async function getDailyUsageTrends(
  timeRange: string,
): Promise<DailyUsage[]> {
  return safeInvoke("get_daily_usage_trends", { timeRange });
}
