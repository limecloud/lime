/**
 * 统一记忆系统 API
 *
 * 提供统一的记忆 CRUD 操作，支持对话记忆和项目记忆的统一管理
 * 更新：添加语义搜索和混合搜索 API
 */

import { safeInvoke } from "@/lib/dev-bridge";

// ==================== 类型定义 ====================

/** 记忆类型 */
export type MemoryType =
  | "conversation" // 对话记忆
  | "project"; // 项目记忆

/** 记忆分类（5层架构） */
export type MemoryCategory =
  | "identity" // 身份信息
  | "context" // 背景信息
  | "preference" // 偏好信息
  | "experience" // 经验信息
  | "activity"; // 活动信息

/** 记忆来源 */
export type MemorySource =
  | "auto_extracted" // 自动从对话历史提取
  | "manual" // 手动创建
  | "imported"; // 从外部导入

/** 记忆元数据 */
export interface MemoryMetadata {
  /** 置信度 (0.0 - 1.0) */
  confidence: number;

  /** 重要性 (0-10) */
  importance: number;

  /** 访问次数 */
  access_count: number;

  /** 上次访问时间（毫秒时间戳） */
  last_accessed_at: number | null;

  /** 来源 */
  source: MemorySource;

  /** 向量嵌入（可选，用于语义搜索） */
  embedding: number[] | null;
}

/** 统一记忆条目 */
export interface UnifiedMemory {
  /** 统一标识符 */
  id: string;

  /** 所属会话 ID */
  session_id: string;

  /** 记忆类型 */
  memory_type: MemoryType;

  /** 记忆分类 */
  category: MemoryCategory;

  /** 记忆标题 */
  title: string;

  /** 记忆内容（详细） */
  content: string;

  /** 记忆摘要（简短描述） */
  summary: string;

  /** 标签列表 */
  tags: string[];

  /** 元数据 */
  metadata: MemoryMetadata;

  /** 创建时间（毫秒时间戳） */
  created_at: number;

  /** 更新时间（毫秒时间戳） */
  updated_at: number;

  /** 是否已归档 */
  archived: boolean;
}

// ==================== 请求类型 ====================

/** 创建统一记忆请求 */
export interface CreateUnifiedMemoryRequest {
  /** 所属会话 ID */
  session_id: string;

  /** 记忆标题 */
  title: string;

  /** 记忆内容 */
  content: string;

  /** 记忆摘要 */
  summary: string;

  /** 记忆分类（可选，不传则由后端推断） */
  category?: MemoryCategory;

  /** 标签列表（可选） */
  tags?: string[];

  /** 置信度（可选） */
  confidence?: number;

  /** 重要性（可选） */
  importance?: number;
}

/** 更新统一记忆请求 */
export interface UpdateUnifiedMemoryRequest {
  /** 记忆标题（可选） */
  title?: string;

  /** 记忆内容（可选） */
  content?: string;

  /** 记忆摘要（可选） */
  summary?: string;

  /** 标签列表（可选） */
  tags?: string[];

  /** 置信度（可选） */
  confidence?: number;

  /** 重要性（可选） */
  importance?: number;
}

/** 记忆列表过滤条件 */
export interface MemoryListFilters {
  /** 会话 ID 过滤（可选） */
  session_id?: string;

  /** 记忆类型过滤（可选） */
  memory_type?: MemoryType;

  /** 记忆分类过滤（可选） */
  category?: MemoryCategory;

  /** 仅查询未归档的（默认 true） */
  archived?: boolean;

  /** 排序字段（默认 updated_at） */
  sort_by?: string;

  /** 排序方向（默认 desc） */
  order?: "asc" | "desc";

  /** 分页偏移（默认 0） */
  offset?: number;

  /** 分页大小（默认 50） */
  limit?: number;
}

/** 语义搜索选项 */
export interface SemanticSearchOptions {
  /** 搜索文本 */
  query: string;

  /** 分类过滤（可选） */
  category?: MemoryCategory;

  /** 结果数量限制（默认 50） */
  limit?: number;
}

/** 混合搜索选项 */
export interface HybridSearchOptions {
  /** 搜索文本 */
  query: string;

  /** 分类过滤（可选） */
  category?: MemoryCategory;

  /** 语义搜索权重（0.0-1.0，默认 0.6） */
  semantic_weight: number;

  /** 关键词搜索权重（自动计算为 1.0 - semantic_weight） */
  keyword_weight?: number;

  /** 最小相似度（0.0-1.0，默认 0.5） */
  min_similarity?: number;

  /** 结果数量限制（默认 50） */
  limit?: number;
}

/** 统一记忆统计 */
export interface UnifiedMemoryStatsResponse {
  total_entries: number;
  storage_used: number;
  memory_count: number;
  categories: Array<{
    category: MemoryCategory;
    count: number;
  }>;
}

/** 统一记忆分析结果 */
export interface UnifiedMemoryAnalysisResult {
  analyzed_sessions: number;
  analyzed_messages: number;
  generated_entries: number;
  deduplicated_entries: number;
}

// ==================== API 函数 ====================

/**
 * 获取记忆列表
 *
 * @param filters - 过滤条件
 * @returns 记忆列表
 */
export async function listUnifiedMemories(
  filters?: MemoryListFilters,
): Promise<UnifiedMemory[]> {
  console.log("[记忆列表] Filters:", filters);

  const result = await safeInvoke<UnifiedMemory[]>("unified_memory_list", {
    filters: filters || null,
  });

  console.log("[记忆列表] Results:", result);
  return result;
}

/**
 * 搜索记忆（关键词搜索）
 *
 * @param query - 搜索关键词
 * @param category - 分类过滤（可选）
 * @param limit - 结果数量限制（可选）
 * @returns 匹配的记忆列表
 */
export async function searchUnifiedMemories(
  query: string,
  category?: MemoryCategory,
  limit?: number,
): Promise<UnifiedMemory[]> {
  console.log(
    "[关键词搜索] Query:",
    query,
    "category:",
    category,
    "limit:",
    limit,
  );

  const result = await safeInvoke<UnifiedMemory[]>("unified_memory_search", {
    query,
    category: category?.toString(),
    limit,
  });

  console.log("[关键词搜索] Results:", result);
  return result;
}

/**
 * 获取单条记忆详情
 *
 * @param id - 记忆 ID
 * @returns 记忆详情，不存在则返回 null
 */
export async function getUnifiedMemory(
  id: string,
): Promise<UnifiedMemory | null> {
  console.log("[获取记忆] ID:", id);

  const result = await safeInvoke<UnifiedMemory | null>("unified_memory_get", {
    id,
  });

  console.log("[获取记忆] Result:", result);
  return result;
}

/**
 * 创建新记忆
 *
 * @param request - 创建请求
 * @returns 创建的记忆
 */
export async function createUnifiedMemory(
  request: CreateUnifiedMemoryRequest,
): Promise<UnifiedMemory> {
  console.log("[创建记忆] Request:", request);

  const result = await safeInvoke<UnifiedMemory>("unified_memory_create", {
    request,
  });

  console.log("[创建记忆] Result:", result);
  return result;
}

/**
 * 更新记忆
 *
 * @param id - 记忆 ID
 * @param request - 更新请求
 * @returns 更新后的记忆
 */
export async function updateUnifiedMemory(
  id: string,
  request: UpdateUnifiedMemoryRequest,
): Promise<UnifiedMemory> {
  console.log("[更新记忆] ID:", id, "Request:", request);

  const result = await safeInvoke<UnifiedMemory>("unified_memory_update", {
    id,
    request,
  });

  console.log("[更新记忆] Result:", result);
  return result;
}

/**
 * 删除记忆（物理删除，不可恢复）
 *
 * @param id - 记忆 ID
 * @returns 是否成功
 */
export async function deleteUnifiedMemory(id: string): Promise<boolean> {
  console.log("[删除记忆] ID:", id);

  const result = await safeInvoke<boolean>("unified_memory_delete", { id });

  console.log("[删除记忆] Result:", result);
  return result;
}

/**
 * 获取统一记忆统计
 */
export async function getUnifiedMemoryStats(): Promise<UnifiedMemoryStatsResponse> {
  console.log("[记忆统计] 获取统一记忆统计");
  return safeInvoke<UnifiedMemoryStatsResponse>("unified_memory_stats");
}

/**
 * 请求统一记忆分析（LLM 优先，失败时规则回退）
 */
export async function analyzeUnifiedMemories(
  fromTimestamp?: number,
  toTimestamp?: number,
): Promise<UnifiedMemoryAnalysisResult> {
  console.log("[记忆分析] 请求统一记忆分析", {
    fromTimestamp,
    toTimestamp,
  });

  return safeInvoke<UnifiedMemoryAnalysisResult>("unified_memory_analyze", {
    fromTimestamp,
    toTimestamp,
  });
}

/**
 * 语义搜索（向量相似度搜索）
 *
 * @param query - 搜索文本
 * @param category - 分类过滤（可选）
 * @param minSimilarity - 最小相似度（0.0-1.0，默认 0.5）
 * @param limit - 结果数量限制（可选）
 * @returns 匹配的记忆列表，按相似度排序
 */
export async function semanticSearch(
  query: string,
  category?: MemoryCategory,
  minSimilarity: number = 0.5,
  limit?: number,
): Promise<UnifiedMemory[]> {
  console.log(
    "[语义搜索] Query:",
    query,
    "Category:",
    category,
    "MinSimilarity:",
    minSimilarity,
  );

  const result = await safeInvoke<UnifiedMemory[]>(
    "unified_memory_semantic_search",
    {
      options: {
        query,
        category,
        min_similarity: minSimilarity,
        limit,
      },
    },
  );

  console.log("[语义搜索] Results:", result);
  return result;
}

/**
 * 混合搜索（语义 + 关键词）
 *
 * @param query - 搜索文本
 * @param category - 分类过滤（可选）
 * @param semanticWeight - 语义搜索权重（0.0-1.0，默认 0.6）
 * @param minSimilarity - 最小相似度（0.0-1.0，默认 0.5）
 * @param limit - 结果数量限制（可选）
 * @returns 匹配的记忆列表，混合排序
 */
export async function hybridSearch(
  query: string,
  category?: MemoryCategory,
  semanticWeight: number = 0.6,
  minSimilarity: number = 0.5,
  limit?: number,
): Promise<UnifiedMemory[]> {
  console.log(
    "[混合搜索] Query:",
    query,
    "Category:",
    category,
    "SemanticWeight:",
    semanticWeight,
    "MinSimilarity:",
    minSimilarity,
  );

  const result = await safeInvoke<UnifiedMemory[]>(
    "unified_memory_hybrid_search",
    {
      options: {
        query,
        category,
        semantic_weight: semanticWeight,
        min_similarity: minSimilarity,
        limit,
      },
    },
  );

  console.log("[混合搜索] Results:", result);
  return result;
}

// ==================== 辅助函数 ====================

/**
 * 标准化时间戳（毫秒）
 */
function normalizeTimestampMs(timestampMs: number): number {
  if (!timestampMs) return 0;
  return timestampMs > 1_000_000_000 ? timestampMs : timestampMs * 1000;
}

/**
 * 格式化相对时间
 */
export function formatRelativeTimestamp(timestampMs: number): string {
  const normalized = normalizeTimestampMs(timestampMs);
  if (!normalized) return "未知时间";

  const now = Date.now();
  const diffMs = now - normalized;
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "刚刚";
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 1) return `${diffMinutes} 分钟前`;
  return `${diffHours} 小时前`;
}

/**
 * 格式化绝对时间
 */
export function formatAbsoluteTimestamp(timestampMs: number): string {
  const normalized = normalizeTimestampMs(timestampMs);
  if (!normalized) return "未知时间";

  const date = new Date(normalized);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}
